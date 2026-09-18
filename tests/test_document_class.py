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


class DocumentClassTests(unittest.TestCase):
    def run_filter(self, review=None, anonymous=None):
        with tempfile.TemporaryDirectory() as directory:
            frontmatter = Path(directory) / "frontmatter"
            frontmatter.mkdir()
            for name in ("authors", "ccs", "rights"):
                (frontmatter / f"{name}.tex").write_text(f"% {name}", encoding="utf8")

            environment = {
                **os.environ,
                "FCKTAPS_FRONTMATTER_DIR": str(frontmatter),
            }
            for name, value in (("FCKTAPS_REVIEW", review), ("FCKTAPS_ANONYMOUS", anonymous)):
                environment.pop(name, None)
                if value is not None:
                    environment[name] = value

            return subprocess.run(
                ["node", str(FILTER)],
                input=json.dumps(document()),
                capture_output=True,
                text=True,
                env=environment,
            )

    def document_class(self, **settings) -> str:
        result = self.run_filter(**settings)
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.dumps(json.loads(result.stdout))
        start = output.index(r"\\documentclass[")
        return output[start:output.index("{acmart}", start)]

    def test_camera_ready_options_are_the_default(self) -> None:
        self.assertEqual(self.document_class(), r"\\documentclass[sigconf,screen]")

    def test_empty_settings_are_the_same_as_none(self) -> None:
        self.assertEqual(
            self.document_class(review="", anonymous=" "),
            r"\\documentclass[sigconf,screen]",
        )

    def test_review_submission_with_named_authors(self) -> None:
        self.assertEqual(
            self.document_class(review="true", anonymous="false"),
            r"\\documentclass[sigconf,screen,review,anonymous=false]",
        )

    def test_anonymous_review_submission(self) -> None:
        self.assertEqual(
            self.document_class(review="true", anonymous="true"),
            r"\\documentclass[sigconf,screen,review,anonymous=true]",
        )

    def test_review_false_leaves_the_option_out(self) -> None:
        self.assertEqual(
            self.document_class(review="false"), r"\\documentclass[sigconf,screen]",
        )

    def test_values_ignore_case(self) -> None:
        self.assertEqual(
            self.document_class(review="True", anonymous="FALSE"),
            r"\\documentclass[sigconf,screen,review,anonymous=false]",
        )

    def test_other_values_are_rejected(self) -> None:
        result = self.run_filter(anonymous="yes")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("FCKTAPS_ANONYMOUS must be true or false", result.stderr)


if __name__ == "__main__":
    unittest.main()
