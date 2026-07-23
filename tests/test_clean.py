import subprocess
import tempfile
import unittest
from pathlib import Path


TOOL_DIR = Path(__file__).resolve().parents[1]
PAPER_MAKEFILE = TOOL_DIR / "Paper Folder TEMPLATE" / "Makefile"


class CleanTargetTests(unittest.TestCase):
    def test_clean_removes_final_outputs_and_preserves_persistent_inputs(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paper_dir = Path(directory)
            media_dir = paper_dir / "figures" / "media"
            override_dir = paper_dir / "figures" / "override"
            frontmatter_dir = paper_dir / "frontmatter"
            media_dir.mkdir(parents=True)
            override_dir.mkdir()
            frontmatter_dir.mkdir()

            generated_outputs = [
                paper_dir / "paper.pdf",
                paper_dir / "paper.zip",
                paper_dir / "paper-compressed.pdf",
                paper_dir / ".paper.zip.tmp",
            ]
            for output in generated_outputs:
                output.write_bytes(b"generated")
            (media_dir / "image1.pdf").write_bytes(b"generated figure")
            persistent_override = override_dir / "figure1--overview.pdf"
            persistent_frontmatter = frontmatter_dir / "rights.tex"
            persistent_override.write_bytes(b"override")
            persistent_frontmatter.write_text("rights", encoding="utf8")

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

            for output in generated_outputs:
                self.assertFalse(output.exists())
            self.assertFalse(media_dir.exists())
            self.assertTrue(persistent_override.is_file())
            self.assertTrue(persistent_frontmatter.is_file())


if __name__ == "__main__":
    unittest.main()
