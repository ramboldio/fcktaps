#!/usr/bin/env python3
"""Local HTTPS server behind the fcktaps Word add-in.

Word loads the add-in's task pane from this server, and the task pane asks it to
convert the open manuscript. Word itself is sandboxed and cannot run pandoc or
LaTeX, so the build runs here, as the user, through the fcktaps command. Only
one build runs at a time; the task pane polls its progress.

A manuscript's paper directory is the "paper" folder next to it.
"""

import json
import re
import ssl
import subprocess
import sys
import threading
import time
import uuid
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


TOOL_DIR = Path(__file__).resolve().parent
ASSETS_DIR = TOOL_DIR / "word"
PORT = 3417
PAPER_DIR_NAME = "paper"
# fcktaps prints one of these prefixes before every message in its summary.
MESSAGE = re.compile(r"^(ERROR|WARNING|DEBUG) -- (.+)$")
MAX_REQUEST_BYTES = 64 * 1024


def document_path(url: str) -> Path:
    """Return the local manuscript behind Office.context.document.url."""
    url = url.strip()
    if not url:
        raise ValueError("Save the manuscript before converting it.")
    parsed = urlparse(url)
    if parsed.scheme in {"http", "https"}:
        raise ValueError(
            "The manuscript is stored online. Save a copy to a local folder "
            "and convert that copy."
        )
    path = Path(unquote(parsed.path) if parsed.scheme == "file" else url)
    if not path.is_absolute():
        raise ValueError(f"Word reported no local path for the manuscript: {url}")
    if path.suffix.lower() != ".docx":
        raise ValueError(f"fcktaps converts .docx manuscripts, not {path.name}.")
    if not path.is_file():
        raise ValueError(f"Manuscript not found: {path}")
    return path


def paper_dir_for(document: Path) -> Path:
    return document.parent / PAPER_DIR_NAME


def parse_messages(lines: list[str]) -> list[dict[str, str]]:
    """Return the warning summary fcktaps printed, in order."""
    messages = []
    for line in lines:
        match = MESSAGE.match(line.rstrip())
        if match:
            messages.append({"level": match.group(1).lower(), "text": match.group(2)})
    return messages


class Job:
    def __init__(self, document: Path, paper_dir: Path) -> None:
        self.id = uuid.uuid4().hex
        self.document = document
        self.paper_dir = paper_dir
        self.started = time.time()
        self.finished: float | None = None
        self.return_code: int | None = None
        self.lines: list[str] = []

    @property
    def pdf(self) -> Path:
        return self.paper_dir / "build" / "paper.pdf"

    def state(self) -> str:
        if self.return_code is None:
            return "running"
        return "succeeded" if self.return_code == 0 else "failed"

    def as_json(self) -> dict:
        end = self.finished or time.time()
        messages = parse_messages(self.lines)
        if self.return_code not in (None, 0) and not any(
            message["level"] == "error" for message in messages
        ):
            messages.insert(0, {
                "level": "error",
                "text": f"fcktaps exited with code {self.return_code}.",
            })
        return {
            "id": self.id,
            "state": self.state(),
            "document": str(self.document),
            "paperDir": str(self.paper_dir),
            "elapsed": round(end - self.started, 1),
            "messages": messages,
            "log": "".join(self.lines),
            "pdf": str(self.pdf) if self.state() == "succeeded" else None,
        }


class Builder:
    """Run fcktaps builds one at a time and remember the latest."""

    def __init__(self, command=None, open_pdf=None) -> None:
        self.command = command or self.fcktaps_command
        self.open_pdf = open_pdf or (lambda pdf: subprocess.run(["open", str(pdf)], check=False))
        self.lock = threading.Lock()
        self.jobs: dict[str, Job] = {}
        self.current: Job | None = None

    @staticmethod
    def fcktaps_command(document: Path, paper_dir: Path) -> list[str]:
        return [
            sys.executable,
            str(TOOL_DIR / "fcktaps"),
            "--paper-dir",
            str(paper_dir),
            str(document),
        ]

    def start(self, document: Path) -> Job:
        paper_dir = paper_dir_for(document)
        if not paper_dir.is_dir():
            raise ValueError(f"Paper folder not found: {paper_dir}")
        with self.lock:
            if self.current and self.current.state() == "running":
                raise RuntimeError("A conversion is already running.")
            job = Job(document, paper_dir)
            self.jobs = {job.id: job}
            self.current = job
        threading.Thread(target=self.run, args=(job,), daemon=True).start()
        return job

    def run(self, job: Job) -> None:
        try:
            with subprocess.Popen(
                self.command(job.document, job.paper_dir),
                cwd=TOOL_DIR,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                errors="replace",
                bufsize=1,
            ) as process:
                assert process.stdout is not None
                for line in process.stdout:
                    job.lines.append(line)
                return_code = process.wait()
        except OSError as error:
            job.lines.append(f"ERROR -- could not run fcktaps: {error}\n")
            return_code = 1
        job.finished = time.time()
        job.return_code = return_code
        if return_code == 0 and job.pdf.is_file():
            self.open_pdf(job.pdf)


class Handler(SimpleHTTPRequestHandler):
    server: "AddinServer"

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, directory=str(ASSETS_DIR), **kwargs)

    def log_message(self, format: str, *args) -> None:
        if self.path.startswith("/api/jobs/"):
            return
        super().log_message(format, *args)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def allowed_host(self) -> bool:
        # Refuse requests addressed to another name, which a DNS rebinding
        # page would send while resolving to this machine.
        host = self.headers.get("Host", "")
        return host in {f"localhost:{self.server.port}", f"127.0.0.1:{self.server.port}"}

    def allowed_origin(self) -> bool:
        # Only the task pane, served from this origin, may start builds. A JSON
        # body keeps other origins behind a CORS preflight this server refuses.
        origin = self.headers.get("Origin")
        content_type = self.headers.get("Content-Type", "")
        return (
            origin in self.server.origins
            and content_type.split(";")[0].strip() == "application/json"
        )

    def send_json(self, status: HTTPStatus, body: dict) -> None:
        data = json.dumps(body).encode("utf8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_REQUEST_BYTES:
            raise ValueError("Request too large.")
        body = json.loads(self.rfile.read(length) or b"{}")
        if not isinstance(body, dict):
            raise ValueError("Expected a JSON object.")
        return body

    def do_GET(self) -> None:
        if not self.allowed_host():
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        path = urlparse(self.path).path
        if path.startswith("/api/jobs/"):
            job = self.server.builder.jobs.get(path.removeprefix("/api/jobs/"))
            if job is None:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "Unknown conversion."})
            else:
                self.send_json(HTTPStatus.OK, job.as_json())
            return
        if path.startswith("/api/"):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        if not self.allowed_host():
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        super().do_HEAD()

    def do_POST(self) -> None:
        if not self.allowed_host() or not self.allowed_origin():
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        path = urlparse(self.path).path
        try:
            body = self.read_json()
            if path == "/api/paper":
                self.describe_paper(body)
            elif path == "/api/init":
                self.init_paper(body)
            elif path == "/api/convert":
                job = self.server.builder.start(document_path(str(body.get("url", ""))))
                self.send_json(HTTPStatus.ACCEPTED, job.as_json())
            elif path == "/api/open":
                self.open_pdf(body)
            else:
                self.send_error(HTTPStatus.NOT_FOUND)
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except RuntimeError as error:
            self.send_json(HTTPStatus.CONFLICT, {"error": str(error)})

    def describe_paper(self, body: dict) -> None:
        document = document_path(str(body.get("url", "")))
        paper_dir = paper_dir_for(document)
        current = self.server.builder.current
        self.send_json(HTTPStatus.OK, {
            "document": str(document),
            "paperDir": str(paper_dir),
            "exists": paper_dir.is_dir(),
            "running": current.as_json() if current and current.state() == "running" else None,
        })

    def init_paper(self, body: dict) -> None:
        paper_dir = paper_dir_for(document_path(str(body.get("url", ""))))
        result = subprocess.run(
            [sys.executable, str(TOOL_DIR / "fcktaps"), "init", str(paper_dir)],
            cwd=TOOL_DIR,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise ValueError(result.stderr.strip() or "Could not create the paper folder.")
        self.send_json(HTTPStatus.OK, {"paperDir": str(paper_dir), "exists": True})

    def open_pdf(self, body: dict) -> None:
        job = self.server.builder.jobs.get(str(body.get("id", "")))
        if job is None or job.state() != "succeeded" or not job.pdf.is_file():
            raise ValueError("No PDF to open.")
        self.server.builder.open_pdf(job.pdf)
        self.send_json(HTTPStatus.OK, {"pdf": str(job.pdf)})


class AddinServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port: int, builder: Builder, scheme: str = "https") -> None:
        super().__init__(("127.0.0.1", port), Handler)
        self.port = self.server_address[1]
        self.builder = builder
        self.origins = {
            f"{scheme}://localhost:{self.port}",
            f"{scheme}://127.0.0.1:{self.port}",
        }


def serve(certificate: Path, key: Path, port: int = PORT) -> None:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certificate, key)
    server = AddinServer(port, Builder())
    server.socket = context.wrap_socket(server.socket, server_side=True)
    print(f"fcktaps Word add-in: https://localhost:{server.port}/taskpane.html", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
