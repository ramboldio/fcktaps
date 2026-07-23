import importlib.machinery
import importlib.util
import subprocess
import tempfile
import unittest
import zipfile
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

    def test_compress_figures_aliases_do_not_enable_final_pdf_compression(
        self,
    ) -> None:
        for alias in ("-cf", "--compress-figures"):
            with self.subTest(alias=alias):
                args = FCKTAPS.parser().parse_args([alias, "paper.docx"])
                self.assertTrue(args.compress_figures)
                self.assertFalse(args.compress)

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
                    RuntimeError, "with exit code 1"
                ):
                    FCKTAPS.compress_pdf(paper_dir)

            self.assertEqual(paper_pdf.read_bytes(), b"original")
            self.assertFalse((paper_dir / "paper-compressed.pdf").exists())

    def test_only_referenced_pdf_figures_are_compressed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paper_dir = Path(directory)
            media_dir = paper_dir / "figures" / "media"
            media_dir.mkdir(parents=True)
            (paper_dir / "paper.tex").write_text(
                "\\includegraphics{figures/media/image1.pdf}\n"
                "\\includegraphics{figures/media/image2.png}\n",
                encoding="utf8",
            )
            (media_dir / "image1.pdf").write_bytes(b"pdf figure")
            (media_dir / "image2.png").write_bytes(b"png figure")
            (media_dir / "unused.pdf").write_bytes(b"unused")

            def successful_run(command, *, cwd, check):
                self.assertEqual(command[-2:], [
                    "-sOutputFile=image1-compressed.pdf",
                    "image1.pdf",
                ])
                self.assertEqual(cwd, media_dir.resolve())
                self.assertFalse(check)
                (media_dir / "image1-compressed.pdf").write_bytes(b"compressed")
                return subprocess.CompletedProcess(command, 0)

            with patch.object(FCKTAPS.subprocess, "run", side_effect=successful_run):
                count = FCKTAPS.compress_figure_pdfs(paper_dir)

            self.assertEqual(count, 1)
            self.assertEqual((media_dir / "image1.pdf").read_bytes(), b"compressed")
            self.assertEqual((media_dir / "image2.png").read_bytes(), b"png figure")
            self.assertEqual((media_dir / "unused.pdf").read_bytes(), b"unused")

    def test_u_override_flag_skips_figure_compression(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paper_dir = Path(directory)
            media_dir = paper_dir / "figures" / "media"
            override_dir = paper_dir / "figures" / "override"
            media_dir.mkdir(parents=True)
            override_dir.mkdir()
            (paper_dir / "paper.tex").write_text(
                "\\includegraphics{figures/media/image1.pdf}\n"
                "\\includegraphics{figures/media/image2.pdf}\n",
                encoding="utf8",
            )
            (media_dir / "image1.pdf").write_bytes(b"keep original")
            (media_dir / "image2.pdf").write_bytes(b"compress me")
            (override_dir / "figure1-u--detailed-artwork.pdf").write_bytes(
                b"override"
            )

            def successful_run(command, *, cwd, check):
                self.assertEqual(command[-1], "image2.pdf")
                (media_dir / "image2-compressed.pdf").write_bytes(b"compressed")
                return subprocess.CompletedProcess(command, 0)

            with patch.object(FCKTAPS.subprocess, "run", side_effect=successful_run):
                count = FCKTAPS.compress_figure_pdfs(paper_dir)

            self.assertEqual(count, 1)
            self.assertEqual(
                (media_dir / "image1.pdf").read_bytes(), b"keep original"
            )
            self.assertEqual((media_dir / "image2.pdf").read_bytes(), b"compressed")


class TapsPackageTests(unittest.TestCase):
    def test_publish_aliases(self) -> None:
        for alias in ("-p", "--publish", "--package"):
            with self.subTest(alias=alias):
                args = FCKTAPS.parser().parse_args([alias, "paper.docx"])
                self.assertTrue(args.publish)

    def test_package_contains_required_taps_layout_and_referenced_sources(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paper_dir = Path(directory)
            media_dir = paper_dir / "figures" / "media"
            media_dir.mkdir(parents=True)
            (paper_dir / "paper.tex").write_text(
                "\\includegraphics{figures/media/image1.pdf}\n"
                "\\bibliography{zotero}\n",
                encoding="utf8",
            )
            (paper_dir / "paper.pdf").write_bytes(b"pdf")
            (paper_dir / "zotero.bib").write_text("@book{x}", encoding="utf8")
            (media_dir / "image1.pdf").write_bytes(b"figure")
            (media_dir / "unused.pdf").write_bytes(b"unused")

            package_path = FCKTAPS.create_taps_package(paper_dir)

            with zipfile.ZipFile(package_path) as package:
                self.assertEqual(
                    set(package.namelist()),
                    {
                        "source/",
                        "pdf/",
                        "source/paper.tex",
                        "source/zotero.bib",
                        "source/figures/media/image1.pdf",
                        "pdf/paper.pdf",
                    },
                )
                self.assertEqual(
                    package.read("source/figures/media/image1.pdf"), b"figure"
                )
                self.assertEqual(package.read("pdf/paper.pdf"), b"pdf")

    def test_package_rejects_a_missing_referenced_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paper_dir = Path(directory)
            (paper_dir / "paper.tex").write_text(
                "\\includegraphics{figures/media/missing.pdf}\n",
                encoding="utf8",
            )
            (paper_dir / "paper.pdf").write_bytes(b"pdf")

            with self.assertRaisesRegex(RuntimeError, "source file not found"):
                FCKTAPS.create_taps_package(paper_dir)

            self.assertFalse((paper_dir / "paper.zip").exists())

    def test_compression_modes_are_independent_and_run_before_packaging(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paper_dir = root / "paper"
            paper_dir.mkdir()
            document = root / "paper.docx"
            document.write_bytes(b"docx")

            def run_cli(*flags: str) -> list[str]:
                events = []
                arguments = [
                    "fcktaps",
                    *flags,
                    "--paper-dir",
                    str(paper_dir),
                    str(document),
                ]
                with (
                    patch.object(FCKTAPS.sys, "argv", arguments),
                    patch.object(FCKTAPS, "run_build", return_value=0),
                    patch.object(
                        FCKTAPS,
                        "compress_figure_pdfs",
                        side_effect=lambda _: events.append("figures"),
                    ),
                    patch.object(
                        FCKTAPS,
                        "compress_pdf",
                        side_effect=lambda _: events.append("compress"),
                    ),
                    patch.object(
                        FCKTAPS,
                        "create_taps_package",
                        side_effect=lambda _: events.append("package"),
                    ),
                    self.assertRaises(SystemExit) as exit_context,
                ):
                    FCKTAPS.main()
                self.assertEqual(exit_context.exception.code, 0)
                return events

            self.assertEqual(run_cli("-c"), ["figures", "compress"])
            self.assertEqual(run_cli("-cf"), ["figures"])
            self.assertEqual(
                run_cli("--compress-figures", "-p"), ["figures", "package"]
            )
            self.assertEqual(
                run_cli("-c", "-p"), ["figures", "compress", "package"]
            )
            self.assertEqual(
                run_cli("-c", "-cf"), ["figures", "compress"]
            )


if __name__ == "__main__":
    unittest.main()
