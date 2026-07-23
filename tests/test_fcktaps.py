import importlib.machinery
import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


TOOL_PATH = Path(__file__).resolve().parents[1] / "fcktaps"
LOADER = importlib.machinery.SourceFileLoader("fcktaps_cli", str(TOOL_PATH))
SPEC = importlib.util.spec_from_loader(LOADER.name, LOADER)
assert SPEC is not None
FCKTAPS = importlib.util.module_from_spec(SPEC)
LOADER.exec_module(FCKTAPS)


class CompressPdfTests(unittest.TestCase):
    def test_compress_aliases(self) -> None:
        for alias in ("-c", "--compress"):
            with self.subTest(alias=alias):
                args = FCKTAPS.parser().parse_args([alias, "paper.docx"])
                self.assertTrue(args.compress)

    def test_compression_replaces_pdf_after_success(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paper_dir = Path(directory)
            paper_pdf = paper_dir / "paper.pdf"
            paper_pdf.write_bytes(b"original")

            def successful_run(command, *, cwd, check):
                self.assertEqual(
                    command,
                    [
                        "gs",
                        "-sDEVICE=pdfwrite",
                        "-dCompatibilityLevel=1.7",
                        "-dNOPAUSE",
                        "-dQUIET",
                        "-dBATCH",
                        "-dDetectDuplicateImages=true",
                        "-dCompressFonts=true",
                        "-dSubsetFonts=true",
                        "-sOutputFile=paper-compressed.pdf",
                        "paper.pdf",
                    ],
                )
                self.assertEqual(cwd, paper_dir)
                self.assertFalse(check)
                (paper_dir / "paper-compressed.pdf").write_bytes(b"compressed")
                return subprocess.CompletedProcess(command, 0)

            with patch.object(FCKTAPS.subprocess, "run", side_effect=successful_run):
                FCKTAPS.compress_pdf(paper_dir)

            self.assertEqual(paper_pdf.read_bytes(), b"compressed")
            self.assertFalse((paper_dir / "paper-compressed.pdf").exists())

    def test_failed_compression_preserves_original_pdf(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paper_dir = Path(directory)
            paper_pdf = paper_dir / "paper.pdf"
            paper_pdf.write_bytes(b"original")

            def failed_run(command, *, cwd, check):
                (paper_dir / "paper-compressed.pdf").write_bytes(b"partial")
                return subprocess.CompletedProcess(command, 1)

            with patch.object(FCKTAPS.subprocess, "run", side_effect=failed_run):
                with self.assertRaisesRegex(
                    RuntimeError, "compression failed with exit code 1"
                ):
                    FCKTAPS.compress_pdf(paper_dir)

            self.assertEqual(paper_pdf.read_bytes(), b"original")
            self.assertFalse((paper_dir / "paper-compressed.pdf").exists())


if __name__ == "__main__":
    unittest.main()
