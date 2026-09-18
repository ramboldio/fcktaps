import http.client
import json
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

from word_server import AddinServer, Builder, document_path, paper_dir_for, parse_messages


# Stands in for fcktaps: prints a warning summary like the real command and
# builds the PDF unless told to fail.
STUB_BUILD = """
import sys
from pathlib import Path
paper_dir = Path(sys.argv[1])
print("LaTeX is running...")
print("WARNING -- Section heading is not in title case: Related work")
print()
if sys.argv[2] == "fail":
    print("ERROR -- Undefined control sequence (input line 12)")
    sys.exit(2)
(paper_dir / "build").mkdir(exist_ok=True)
(paper_dir / "build" / "paper.pdf").write_bytes(b"pdf")
print("LaTeX finished.")
"""


class DocumentPathTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.document = self.root / "My Paper.docx"
        self.document.write_bytes(b"docx")

    def tearDown(self) -> None:
        self.directory.cleanup()

    def test_accepts_a_posix_path(self) -> None:
        self.assertEqual(document_path(str(self.document)), self.document)

    def test_accepts_a_file_url(self) -> None:
        self.assertEqual(document_path(self.document.as_uri()), self.document)

    def test_rejects_an_unsaved_document(self) -> None:
        with self.assertRaisesRegex(ValueError, "Save the manuscript"):
            document_path("")

    def test_rejects_an_online_document(self) -> None:
        with self.assertRaisesRegex(ValueError, "stored online"):
            document_path("https://d.docs.live.net/abc/Paper.docx")

    def test_rejects_other_formats(self) -> None:
        other = self.root / "paper.doc"
        other.write_bytes(b"doc")
        with self.assertRaisesRegex(ValueError, ".docx"):
            document_path(str(other))

    def test_paper_directory_sits_next_to_the_manuscript(self) -> None:
        self.assertEqual(paper_dir_for(self.document), self.root / "paper")


class ParseMessagesTests(unittest.TestCase):
    def test_reads_the_warning_summary(self) -> None:
        lines = [
            "LaTeX is running...\n",
            "ERROR -- Undefined control sequence\n",
            "\n",
            "WARNING -- ACM: Figure 2 may be missing descriptions.\n",
            "DEBUG -- Inline code: foo()\n",
        ]
        self.assertEqual(parse_messages(lines), [
            {"level": "error", "text": "Undefined control sequence"},
            {"level": "warning", "text": "ACM: Figure 2 may be missing descriptions."},
            {"level": "debug", "text": "Inline code: foo()"},
        ])


class AddinServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        self.document = root / "paper.docx"
        self.document.write_bytes(b"docx")
        self.paper_dir = root / "paper"
        self.paper_dir.mkdir()
        self.outcome = "succeed"
        self.opened: list[Path] = []
        builder = Builder(
            command=lambda document, paper_dir: [
                sys.executable, "-c", STUB_BUILD, str(paper_dir), self.outcome,
            ],
            open_pdf=self.opened.append,
        )
        self.server = AddinServer(0, builder, scheme="http")
        self.origin = f"http://localhost:{self.server.port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.directory.cleanup()

    def request(self, method: str, path: str, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.port, timeout=10)
        all_headers = {"Host": f"localhost:{self.server.port}"}
        if body is not None:
            all_headers.update({"Origin": self.origin, "Content-Type": "application/json"})
        all_headers.update(headers or {})
        connection.request(
            method, path, body=None if body is None else json.dumps(body), headers=all_headers,
        )
        response = connection.getresponse()
        data = response.read()
        connection.close()
        return response.status, data

    def convert(self) -> dict:
        status, data = self.request("POST", "/api/convert", {"url": str(self.document)})
        self.assertEqual(status, 202, data)
        job_id = json.loads(data)["id"]
        deadline = time.time() + 10
        while time.time() < deadline:
            _, data = self.request("GET", f"/api/jobs/{job_id}")
            job = json.loads(data)
            if job["state"] != "running":
                return job
            time.sleep(0.05)
        self.fail("conversion did not finish")

    def test_serves_the_task_pane(self) -> None:
        status, data = self.request("GET", "/taskpane.html")
        self.assertEqual(status, 200)
        self.assertIn(b"Convert to TAPS", data)

    def test_describes_the_paper_directory(self) -> None:
        status, data = self.request("POST", "/api/paper", {"url": str(self.document)})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)["paperDir"], str(self.paper_dir))
        self.assertTrue(json.loads(data)["exists"])

    def test_successful_conversion_reports_warnings_and_opens_the_pdf(self) -> None:
        job = self.convert()

        self.assertEqual(job["state"], "succeeded")
        self.assertEqual(job["messages"], [{
            "level": "warning",
            "text": "Section heading is not in title case: Related work",
        }])
        pdf = self.paper_dir / "build" / "paper.pdf"
        self.assertEqual(job["pdf"], str(pdf))
        self.assertEqual(self.opened, [pdf])

    def test_failed_conversion_reports_the_error_and_opens_nothing(self) -> None:
        self.outcome = "fail"

        job = self.convert()

        self.assertEqual(job["state"], "failed")
        self.assertEqual(job["messages"][-1], {
            "level": "error", "text": "Undefined control sequence (input line 12)",
        })
        self.assertIsNone(job["pdf"])
        self.assertEqual(self.opened, [])

    def test_missing_paper_directory_is_refused(self) -> None:
        self.paper_dir.rmdir()

        status, data = self.request("POST", "/api/convert", {"url": str(self.document)})

        self.assertEqual(status, 400)
        self.assertIn("Paper folder not found", json.loads(data)["error"])

    def test_refuses_requests_from_other_origins(self) -> None:
        status, _ = self.request(
            "POST", "/api/convert", {"url": str(self.document)},
            headers={"Origin": "https://example.com"},
        )
        self.assertEqual(status, 403)

    def test_refuses_form_posts(self) -> None:
        status, _ = self.request(
            "POST", "/api/convert", {"url": str(self.document)},
            headers={"Content-Type": "text/plain"},
        )
        self.assertEqual(status, 403)

    def test_refuses_other_host_names(self) -> None:
        status, _ = self.request(
            "GET", "/taskpane.html", headers={"Host": f"attacker.example:{self.server.port}"},
        )
        self.assertEqual(status, 403)


if __name__ == "__main__":
    unittest.main()
