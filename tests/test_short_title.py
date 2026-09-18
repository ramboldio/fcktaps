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


class ShortTitleTests(unittest.TestCase):
    def latex(self, short_title=None) -> str:
        with tempfile.TemporaryDirectory() as directory:
            frontmatter = Path(directory) / "frontmatter"
            frontmatter.mkdir()
            for name in ("authors", "ccs", "rights"):
                (frontmatter / f"{name}.tex").write_text(f"% {name}", encoding="utf8")

            environment = {
                **os.environ,
                "FCKTAPS_FRONTMATTER_DIR": str(frontmatter),
            }
            environment.pop("FCKTAPS_SHORT_TITLE", None)
            if short_title is not None:
                environment["FCKTAPS_SHORT_TITLE"] = short_title

            result = subprocess.run(
                ["node", str(FILTER)],
                input=json.dumps(document()),
                capture_output=True,
                text=True,
                env=environment,
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        return json.dumps(json.loads(result.stdout))

    def test_no_short_title_leaves_the_running_head_to_acmart(self) -> None:
        self.assertIn(r"\\title{", self.latex())
        self.assertNotIn(r"\\title[", self.latex())

    def test_a_short_title_becomes_the_optional_argument(self) -> None:
        self.assertIn(r"\\title[{Demonstrating AirForce}]{", self.latex("Demonstrating AirForce"))

    def test_an_empty_short_title_is_the_same_as_none(self) -> None:
        self.assertNotIn(r"\\title[", self.latex("   "))

    def test_special_characters_are_escaped(self) -> None:
        # Braces also keep a "]" from closing the optional argument early.
        self.assertIn(r"\\title[{A \\& B [ ] 50\\%}]{", self.latex("A & B [ ] 50%"))


if __name__ == "__main__":
    unittest.main()
