#!/usr/bin/env python3
"""Install, run, and remove the fcktaps Word add-in on macOS.

Usage: fcktaps word <install|serve|uninstall>

Word loads add-ins only over trusted HTTPS, so installing creates a self-signed
certificate for localhost and trusts it in the login keychain. It then sideloads
the add-in manifest into Word and registers a launch agent that keeps the local
server running.
"""

import argparse
import os
import plistlib
import secrets
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from word_server import ASSETS_DIR, PORT, TOOL_DIR, serve


LABEL = "io.github.ramboldio.fcktaps.word"
CERTIFICATE_NAME = "fcktaps Word add-in (localhost)"
SUPPORT_DIR = Path.home() / "Library" / "Application Support" / "fcktaps"
CERTIFICATE = SUPPORT_DIR / "localhost.crt"
KEY = SUPPORT_DIR / "localhost.key"
LOGIN_KEYCHAIN = Path.home() / "Library" / "Keychains" / "login.keychain-db"
WORD_ADDIN_DIR = (
    Path.home() / "Library" / "Containers" / "com.microsoft.Word"
    / "Data" / "Documents" / "wef"
)
MANIFEST = ASSETS_DIR / "manifest.xml"
INSTALLED_MANIFEST = WORD_ADDIN_DIR / "fcktaps.manifest.xml"
LAUNCH_AGENT = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
LOG_FILE = Path.home() / "Library" / "Logs" / "fcktaps-word.log"
# Apple rejects TLS server certificates valid for longer than 825 days.
CERTIFICATE_DAYS = 825
OPENSSL_CONFIG = f"""\
[req]
distinguished_name = dn
prompt = no
x509_extensions = server
[dn]
CN = {CERTIFICATE_NAME}
[server]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:localhost,IP:127.0.0.1
"""


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        prog="fcktaps word",
        description="Trigger fcktaps conversions from inside Microsoft Word.",
    )
    commands = result.add_subparsers(dest="command", required=True)
    install = commands.add_parser("install", help="set up the add-in and its local server")
    install.add_argument(
        "--no-agent",
        action="store_true",
        help="do not start the server at login; run `fcktaps word serve` yourself",
    )
    commands.add_parser("serve", help="run the add-in server in the foreground")
    commands.add_parser("uninstall", help="remove the add-in, its server, and its certificate")
    return result


def run(command: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(command, check=True, **kwargs)


def remove_trusted_certificate() -> None:
    # Delete every copy, including those left by earlier installs.
    while subprocess.run(
        ["security", "delete-certificate", "-c", CERTIFICATE_NAME, "-t", str(LOGIN_KEYCHAIN)],
        capture_output=True,
    ).returncode == 0:
        pass


def create_certificate() -> None:
    """Create a self-signed localhost certificate and trust it for TLS."""
    SUPPORT_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as directory:
        config = Path(directory) / "openssl.cnf"
        config.write_text(OPENSSL_CONFIG, encoding="utf8")
        run([
            "openssl", "req", "-x509", "-new", "-nodes",
            "-newkey", "rsa:2048",
            "-keyout", str(KEY),
            "-out", str(CERTIFICATE),
            "-days", str(CERTIFICATE_DAYS),
            "-set_serial", f"0x{secrets.token_hex(16)}",
            "-config", str(config),
        ], capture_output=True)
    KEY.chmod(0o600)

    remove_trusted_certificate()
    print("Trusting the localhost certificate; macOS asks for your password.")
    run([
        "security", "add-trusted-cert",
        "-r", "trustRoot",
        "-p", "ssl",
        "-k", str(LOGIN_KEYCHAIN),
        str(CERTIFICATE),
    ])


def install_manifest() -> None:
    WORD_ADDIN_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(MANIFEST, INSTALLED_MANIFEST)


def stop_launch_agent() -> None:
    subprocess.run(
        ["launchctl", "bootout", f"gui/{os.getuid()}/{LABEL}"],
        capture_output=True,
    )


def install_launch_agent() -> None:
    LAUNCH_AGENT.parent.mkdir(parents=True, exist_ok=True)
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    agent = {
        "Label": LABEL,
        "ProgramArguments": [sys.executable, str(TOOL_DIR / "fcktaps"), "word", "serve"],
        "WorkingDirectory": str(TOOL_DIR),
        # launchd starts agents with a minimal PATH; builds need pandoc, node,
        # make, and pdflatex from wherever this shell finds them.
        "EnvironmentVariables": {"PATH": os.environ.get("PATH", "/usr/bin:/bin")},
        "RunAtLoad": True,
        "KeepAlive": True,
        "StandardOutPath": str(LOG_FILE),
        "StandardErrorPath": str(LOG_FILE),
    }
    stop_launch_agent()
    with LAUNCH_AGENT.open("wb") as file:
        plistlib.dump(agent, file)
    run(["launchctl", "bootstrap", f"gui/{os.getuid()}", str(LAUNCH_AGENT)])


def install(args: argparse.Namespace) -> None:
    if sys.platform != "darwin":
        sys.exit("fcktaps word install supports macOS only.")
    if not shutil.which("openssl"):
        sys.exit("openssl is required to create the localhost certificate.")

    create_certificate()
    print(f"Certificate: {CERTIFICATE}")
    install_manifest()
    print(f"Add-in manifest: {INSTALLED_MANIFEST}")
    if args.no_agent:
        print("Start the server with: ./fcktaps word serve")
    else:
        install_launch_agent()
        print(f"Server: https://localhost:{PORT} (log: {LOG_FILE})")
    print(
        "\nRestart Word, then choose Insert > Add-ins > My Add-ins and pick "
        "fcktaps.\nAfterwards the Home tab shows a Convert to TAPS button."
    )


def uninstall() -> None:
    stop_launch_agent()
    LAUNCH_AGENT.unlink(missing_ok=True)
    INSTALLED_MANIFEST.unlink(missing_ok=True)
    remove_trusted_certificate()
    CERTIFICATE.unlink(missing_ok=True)
    KEY.unlink(missing_ok=True)
    print("Removed the fcktaps Word add-in. Restart Word to drop it from the ribbon.")


def main(arguments: list[str]) -> None:
    args = parser().parse_args(arguments)
    if args.command == "install":
        install(args)
    elif args.command == "serve":
        if not CERTIFICATE.is_file() or not KEY.is_file():
            sys.exit("No localhost certificate found. Run: ./fcktaps word install")
        serve(CERTIFICATE, KEY)
    else:
        uninstall()


if __name__ == "__main__":
    main(sys.argv[1:])
