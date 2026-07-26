import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


TOOL_DIR = Path(__file__).resolve().parents[1]
FILTER = TOOL_DIR / "patch_latex_things.js"


def paragraph(text):
    words = text.split()
    inlines = []
    for index, word in enumerate(words):
        if index:
            inlines.append({"t": "Space"})
        inlines.append({"t": "Str", "c": word})
    return {"t": "Para", "c": inlines}


def figure(path, caption, word_alt=""):
    image = {
        "t": "Image",
        "c": [
            ["", [], []],
            paragraph(word_alt)["c"],
            [path, ""],
        ],
    }
    return {
        "t": "Figure",
        "c": [
            ["", [], []],
            [[], [paragraph(caption)]],
            [{"t": "Para", "c": [image]}],
        ],
    }


def raw_latex_strings(value):
    if isinstance(value, list):
        for child in value:
            yield from raw_latex_strings(child)
    elif isinstance(value, dict):
        if value.get("t") == "RawInline" and value.get("c", [None])[0] == "latex":
            yield value["c"][1]
        for child in value.values():
            yield from raw_latex_strings(child)


class AltTextTests(unittest.TestCase):
    def run_filter(self, alt_text):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            frontmatter = root / "frontmatter"
            frontmatter.mkdir()
            for name in ("authors", "ccs", "rights"):
                (frontmatter / f"{name}.tex").write_text(f"% {name}", encoding="utf8")
            alt_text_file = root / "alt-text.txt"
            alt_text_file.write_text(alt_text, encoding="utf8")

            document = {
                "pandoc-api-version": [1, 23, 1],
                "meta": {
                    "title": {"t": "MetaInlines", "c": [{"t": "Str", "c": "Title"}]},
                    "abstract": {"t": "MetaInlines", "c": [{"t": "Str", "c": "Abstract"}]},
                    "keywords": {"t": "MetaList", "c": [{"t": "MetaString", "c": "test"}]},
                    "acknoledgements": {
                        "t": "MetaInlines",
                        "c": [{"t": "Str", "c": "Thanks"}],
                    },
                },
                "blocks": [
                    figure("figure1.pdf", "First caption", "Word fallback one"),
                    figure("figure2.pdf", "Second caption", "Word fallback two"),
                ],
            }
            environment = {
                **os.environ,
                "FCKTAPS_FRONTMATTER_DIR": str(frontmatter),
                "FCKTAPS_ALT_TEXT_FILE": str(alt_text_file),
            }
            result = subprocess.run(
                ["node", str(FILTER)],
                input=json.dumps(document),
                capture_output=True,
                check=True,
                text=True,
                env=environment,
            )
            return "\n".join(raw_latex_strings(json.loads(result.stdout)))

    def test_file_descriptions_override_word_alt_text_and_may_wrap(self):
        latex = self.run_filter(
            "Figure 1: File description with 50% & detail.\n"
            "\n"
            "Figure 2: A wrapped\n"
            "description.\n"
        )
        self.assertIn(
            r"\Description{File description with 50\% \& detail.}",
            latex,
        )
        self.assertIn(r"\Description{A wrapped description.}", latex)
        self.assertNotIn("Word fallback", latex)

    def test_blank_entry_uses_word_alt_text_fallback(self):
        latex = self.run_filter("Figure 1:\n\nFigure 2: File description.\n")
        self.assertIn(r"\Description{Word fallback one}", latex)
        self.assertIn(r"\Description{File description.}", latex)


if __name__ == "__main__":
    unittest.main()
