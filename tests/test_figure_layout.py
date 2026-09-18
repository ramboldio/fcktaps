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


def figure(path, caption):
    image = {
        "t": "Image",
        "c": [["", [], []], [], [path, ""]],
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


class FigureLayoutTests(unittest.TestCase):
    def run_filter(self, **settings):
        with tempfile.TemporaryDirectory() as directory:
            frontmatter = Path(directory) / "frontmatter"
            frontmatter.mkdir()
            for name in ("authors", "ccs", "rights"):
                (frontmatter / f"{name}.tex").write_text(f"% {name}", encoding="utf8")

            document = {
                "pandoc-api-version": [1, 23, 1],
                "meta": {
                    "title": {"t": "MetaInlines", "c": [{"t": "Str", "c": "Title"}]},
                    "abstract": {
                        "t": "MetaInlines",
                        "c": [{"t": "Str", "c": "Abstract"}],
                    },
                    "keywords": {"t": "MetaList", "c": [{"t": "MetaString", "c": "t"}]},
                },
                "blocks": [
                    figure("figure1.pdf", "First caption"),
                    paragraph("Body text."),
                    figure("figure2.pdf", "Second caption"),
                    figure("figure3.pdf", "Third caption"),
                ],
            }

            environment = {
                **os.environ,
                "FCKTAPS_FRONTMATTER_DIR": str(frontmatter),
            }
            for name in ("FCKTAPS_FIGURE_ONE_PLACEMENT", "FCKTAPS_WIDE_FIGURES"):
                environment.pop(name, None)
            environment.update(settings)

            return subprocess.run(
                ["node", str(FILTER)],
                input=json.dumps(document),
                capture_output=True,
                text=True,
                env=environment,
            )

    def latex(self, **settings) -> str:
        result = self.run_filter(**settings)
        self.assertEqual(result.returncode, 0, result.stderr)
        return "\n".join(raw_latex_strings(json.loads(result.stdout)))

    def test_figure_one_floats_after_the_frontmatter_by_default(self) -> None:
        latex = self.latex()

        self.assertIn(r"\begin{figure*}[t]", latex)
        self.assertNotIn("teaserfigure", latex)
        self.assertLess(latex.index(r"\maketitle"), latex.index(r"\begin{figure*}[t]"))

    def test_figure_one_can_fill_the_first_page_teaser_slot(self) -> None:
        latex = self.latex(FCKTAPS_FIGURE_ONE_PLACEMENT="teaser")

        self.assertIn(r"\begin{teaserfigure}", latex)
        self.assertIn(r"\end{teaserfigure}", latex)
        # acmart requires the teaser before \maketitle.
        self.assertLess(
            latex.index(r"\begin{teaserfigure}"), latex.index(r"\maketitle")
        )
        self.assertIn(r"\includegraphics[width=\textwidth]{figure1.pdf}", latex)

    def test_other_figures_are_single_column_unless_listed_as_wide(self) -> None:
        latex = self.latex()

        self.assertIn(r"\includegraphics[width=\columnwidth]{figure2.pdf}", latex)
        self.assertIn(r"\includegraphics[width=\columnwidth]{figure3.pdf}", latex)

    def test_listed_figures_span_both_columns(self) -> None:
        latex = self.latex(FCKTAPS_WIDE_FIGURES="2")

        self.assertIn(r"\includegraphics[width=\textwidth]{figure2.pdf}", latex)
        self.assertIn(r"\includegraphics[width=\columnwidth]{figure3.pdf}", latex)
        figure_two = latex[latex.index("figure2.pdf") - 200 : latex.index("figure2.pdf")]
        self.assertIn(r"\begin{figure*}[t]", figure_two)

    def test_several_wide_figures_may_be_listed_together(self) -> None:
        latex = self.latex(FCKTAPS_WIDE_FIGURES="2, 3")

        self.assertIn(r"\includegraphics[width=\textwidth]{figure2.pdf}", latex)
        self.assertIn(r"\includegraphics[width=\textwidth]{figure3.pdf}", latex)

    def test_an_unknown_figure_one_placement_fails_the_build(self) -> None:
        result = self.run_filter(FCKTAPS_FIGURE_ONE_PLACEMENT="banner")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("FCKTAPS_FIGURE_ONE_PLACEMENT", result.stderr)

    def test_a_non_numeric_wide_figure_fails_the_build(self) -> None:
        result = self.run_filter(FCKTAPS_WIDE_FIGURES="two")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("FCKTAPS_WIDE_FIGURES", result.stderr)


if __name__ == "__main__":
    unittest.main()
