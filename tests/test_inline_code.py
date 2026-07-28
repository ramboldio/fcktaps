import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


TOOL_DIR = Path(__file__).resolve().parents[1]
FILTER = TOOL_DIR / "patch_latex_things.js"


def walk(value):
    if isinstance(value, list):
        for child in value:
            yield from walk(child)
    elif isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)


class InlineCodeTests(unittest.TestCase):
    def run_filter(self):
        with tempfile.TemporaryDirectory() as directory:
            frontmatter = Path(directory) / "frontmatter"
            frontmatter.mkdir()
            for name in ("authors", "ccs", "rights"):
                (frontmatter / f"{name}.tex").write_text(
                    f"% {name}", encoding="utf8"
                )

            document = {
                "pandoc-api-version": [1, 23, 1],
                "meta": {
                    "title": {
                        "t": "MetaInlines",
                        "c": [{"t": "Str", "c": "Title"}],
                    },
                    "abstract": {
                        "t": "MetaInlines",
                        "c": [{"t": "Str", "c": "Abstract"}],
                    },
                    "keywords": {
                        "t": "MetaList",
                        "c": [{"t": "MetaString", "c": "test"}],
                    },
                    "acknoledgements": {
                        "t": "MetaInlines",
                        "c": [{"t": "Str", "c": "Thanks"}],
                    },
                },
                "blocks": [
                    {
                        "t": "Para",
                        "c": [
                            {
                                "t": "Code",
                                "c": [
                                    ["", [], []],
                                    r"gain=foo_bar%25=done",
                                ],
                            },
                            {"t": "Space"},
                            {
                                "t": "Code",
                                "c": [["", [], []], "unchanged"],
                            },
                        ],
                    },
                    {
                        "t": "CodeBlock",
                        "c": [["", [], []], "block=value"],
                    },
                ],
            }
            environment = {
                **os.environ,
                "FCKTAPS_FRONTMATTER_DIR": str(frontmatter),
            }
            result = subprocess.run(
                ["node", str(FILTER)],
                input=json.dumps(document),
                capture_output=True,
                check=True,
                text=True,
                env=environment,
            )
            return json.loads(result.stdout)

    def test_inline_code_can_break_after_each_equals_sign(self):
        nodes = list(walk(self.run_filter()))

        self.assertIn(
            {
                "t": "RawInline",
                "c": [
                    "latex",
                    r"\texttt{gain=\allowbreak{}foo\_bar\%25="
                    r"\allowbreak{}done}",
                ],
            },
            nodes,
        )

    def test_code_without_equals_and_code_blocks_are_unchanged(self):
        nodes = list(walk(self.run_filter()))

        self.assertIn(
            {"t": "Code", "c": [["", [], []], "unchanged"]},
            nodes,
        )
        self.assertIn(
            {"t": "CodeBlock", "c": [["", [], []], "block=value"]},
            nodes,
        )


if __name__ == "__main__":
    unittest.main()
