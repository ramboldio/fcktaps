import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


TOOL_DIR = Path(__file__).resolve().parents[1]
FILTER = TOOL_DIR / "patch_latex_things.js"


def document():
    return {
        "pandoc-api-version": [1, 23, 1],
        "meta": {
            "title": {"t": "MetaInlines", "c": [{"t": "Str", "c": "Title"}]},
            "abstract": {"t": "MetaInlines", "c": [{"t": "Str", "c": "Abstract"}]},
            "keywords": {"t": "MetaList", "c": [{"t": "MetaString", "c": "test"}]},
        },
        "blocks": [{"t": "Para", "c": [{"t": "Str", "c": "Body"}]}],
    }


class CiteStyleTests(unittest.TestCase):
    def run_filter(self, cite_style=None):
        with tempfile.TemporaryDirectory() as directory:
            frontmatter = Path(directory) / "frontmatter"
            frontmatter.mkdir()
            for name in ("authors", "ccs", "rights"):
                (frontmatter / f"{name}.tex").write_text(f"% {name}", encoding="utf8")

            environment = {
                **os.environ,
                "FCKTAPS_FRONTMATTER_DIR": str(frontmatter),
            }
            environment.pop("FCKTAPS_CITE_STYLE", None)
            if cite_style is not None:
                environment["FCKTAPS_CITE_STYLE"] = cite_style

            return subprocess.run(
                ["node", str(FILTER)],
                input=json.dumps(document()),
                capture_output=True,
                text=True,
                env=environment,
            )

    def preamble(self, cite_style=None) -> str:
        result = self.run_filter(cite_style)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.dumps(json.loads(result.stdout))

    def test_numeric_citations_are_the_default(self) -> None:
        self.assertIn(r"\\citestyle{acmnumeric}", self.preamble())

    def test_author_year_citations_can_be_selected(self) -> None:
        preamble = self.preamble("acmauthoryear")
        self.assertIn(r"\\citestyle{acmauthoryear}", preamble)
        self.assertNotIn(r"\\citestyle{acmnumeric}", preamble)

    def test_an_unknown_citation_style_fails_the_build(self) -> None:
        result = self.run_filter("apalike")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("FCKTAPS_CITE_STYLE", result.stderr)

    def test_acknowledgements_are_optional(self) -> None:
        # Extended abstracts frequently have no acknowledgements section.
        self.assertNotIn(r"begin{acks}", self.preamble())


if __name__ == "__main__":
    unittest.main()
