import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

from taps_package import create_taps_package


TOOL_DIR = Path(__file__).resolve().parents[1]
PAPER_MAKEFILE = TOOL_DIR / "Paper Folder TEMPLATE" / "Makefile"


def build_directory(root: Path) -> Path:
    """Populate a build directory that looks like a finished build."""
    build_dir = root / "build"
    media_dir = build_dir / "figures" / "media"
    media_dir.mkdir(parents=True)
    (build_dir / "paper.tex").write_text(
        "\\includegraphics{figures/media/image1.pdf}\n\\bibliography{zotero}\n",
        encoding="utf8",
    )
    (build_dir / "paper.pdf").write_bytes(b"pdf")
    (build_dir / "zotero.bib").write_text("@book{x}", encoding="utf8")
    (media_dir / "image1.pdf").write_bytes(b"figure")
    (media_dir / "unused.pdf").write_bytes(b"unused")
    return build_dir


class TapsPackageModuleTests(unittest.TestCase):
    def test_archive_name_defaults_to_paper(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            build_dir = build_directory(Path(directory))

            self.assertEqual(create_taps_package(build_dir).name, "paper.zip")

    def test_archive_can_be_named_for_the_taps_dashboard(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            build_dir = build_directory(Path(directory))

            package_path = create_taps_package(build_dir, "saemergingtechnologies26-14")

            self.assertEqual(package_path.name, "saemergingtechnologies26-14.zip")
            with zipfile.ZipFile(package_path) as package:
                self.assertEqual(
                    set(package.namelist()),
                    {
                        "Source/",
                        "pdf/",
                        "Source/paper.tex",
                        "Source/zotero.bib",
                        "Source/figures/media/image1.pdf",
                        "pdf/paper.pdf",
                    },
                )

    def test_a_zip_suffix_in_the_name_is_not_doubled(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            build_dir = build_directory(Path(directory))

            package_path = create_taps_package(build_dir, "proceedings-7.zip")

            self.assertEqual(package_path.name, "proceedings-7.zip")

    def test_an_unusable_archive_name_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            build_dir = build_directory(Path(directory))

            with self.assertRaisesRegex(RuntimeError, "archive names"):
                create_taps_package(build_dir, "../escape")

            self.assertEqual(list(build_dir.glob("*.zip")), [])

    def test_the_command_line_entry_point_writes_the_archive(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            build_dir = build_directory(Path(directory))

            result = subprocess.run(
                ["python3", str(TOOL_DIR / "taps_package.py"), str(build_dir), "acm-9"],
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((build_dir / "acm-9.zip").is_file())

    def test_the_command_line_entry_point_reports_a_missing_build(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                ["python3", str(TOOL_DIR / "taps_package.py"), directory],
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 1)
            self.assertIn("ERROR --", result.stderr)


class PackageTargetTests(unittest.TestCase):
    def test_the_make_target_packages_under_the_configured_name(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paper_dir = Path(directory)
            build_directory(paper_dir)
            # Keep the finished build: the target's prerequisite is already met.
            (paper_dir / "zotero.bib").write_text("@book{x}", encoding="utf8")
            (paper_dir / "reference_keys.csv").write_text("x\n", encoding="utf8")

            result = subprocess.run(
                [
                    "make",
                    "-C",
                    str(paper_dir),
                    "-f",
                    str(PAPER_MAKEFILE),
                    f"FCKTAPS={TOOL_DIR}",
                    "PACKAGE_NAME=saemergingtechnologies26-14",
                    "-o",
                    "build/paper.pdf",
                    "package",
                ],
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(
                (paper_dir / "build" / "saemergingtechnologies26-14.zip").is_file()
            )


if __name__ == "__main__":
    unittest.main()
