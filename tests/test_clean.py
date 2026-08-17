import subprocess
import tempfile
import unittest
from pathlib import Path


TOOL_DIR = Path(__file__).resolve().parents[1]
PAPER_MAKEFILE = TOOL_DIR / "Paper Folder TEMPLATE" / "Makefile"


def run_clean(paper_dir: Path) -> None:
    subprocess.run(
        [
            "make",
            "-C",
            str(paper_dir),
            "-f",
            str(PAPER_MAKEFILE),
            f"FCKTAPS={TOOL_DIR}",
            "clean",
        ],
        check=True,
        capture_output=True,
        text=True,
    )


class CleanTargetTests(unittest.TestCase):
    def test_clean_removes_the_build_directory_and_preserves_persistent_inputs(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paper_dir = Path(directory)
            build_dir = paper_dir / "build"
            media_dir = build_dir / "figures" / "media"
            override_dir = paper_dir / "figures" / "override"
            frontmatter_dir = paper_dir / "frontmatter"
            media_dir.mkdir(parents=True)
            override_dir.mkdir(parents=True)
            frontmatter_dir.mkdir()

            for name in (
                "paper.pdf",
                "paper.zip",
                "paper.tex",
                "paper.aux",
                "zotero.bib",
                "paper-compressed.pdf",
                ".paper.zip.tmp",
                ".fcktaps-warnings",
            ):
                (build_dir / name).write_bytes(b"generated")
            (media_dir / "image1.pdf").write_bytes(b"generated figure")

            persistent_override = override_dir / "figure1--overview.pdf"
            persistent_frontmatter = frontmatter_dir / "rights.tex"
            persistent_alt_text = paper_dir / "alt-text.txt"
            persistent_bibliography = paper_dir / "zotero.bib"
            persistent_override.write_bytes(b"override")
            persistent_frontmatter.write_text("rights", encoding="utf8")
            persistent_alt_text.write_text("Figure 1: overview", encoding="utf8")
            persistent_bibliography.write_text("@book{x}", encoding="utf8")

            run_clean(paper_dir)

            self.assertFalse(build_dir.exists())
            self.assertTrue(persistent_override.is_file())
            self.assertTrue(persistent_frontmatter.is_file())
            self.assertTrue(persistent_alt_text.is_file())
            self.assertTrue(persistent_bibliography.is_file())

    def test_clean_removes_artefacts_of_paper_directories_built_before_build_dir(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paper_dir = Path(directory)
            media_dir = paper_dir / "figures" / "media"
            override_dir = paper_dir / "figures" / "override"
            media_dir.mkdir(parents=True)
            override_dir.mkdir()

            legacy_outputs = [
                paper_dir / "paper.pdf",
                paper_dir / "paper.tex",
                paper_dir / "paper.zip",
                paper_dir / "paper-compressed.pdf",
                paper_dir / ".paper.zip.tmp",
                paper_dir / ".fcktaps-warnings",
            ]
            for output in legacy_outputs:
                output.write_bytes(b"generated")
            (media_dir / "image1.pdf").write_bytes(b"generated figure")
            persistent_override = override_dir / "figure1--overview.pdf"
            persistent_override.write_bytes(b"override")

            run_clean(paper_dir)

            for output in legacy_outputs:
                self.assertFalse(output.exists())
            self.assertFalse(media_dir.exists())
            self.assertTrue(persistent_override.is_file())


if __name__ == "__main__":
    unittest.main()
