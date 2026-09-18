import json
import subprocess
import tempfile
import unittest
from pathlib import Path


FILTER_PATH = Path(__file__).resolve().parents[1] / "link_refs_to_bibliography.js"


def str_inline(text):
    return {"t": "Str", "c": text}


def citation_link(number, anchor):
    return {
        "t": "Link",
        "c": [["", [], []], [str_inline(f"[{number}]")], [f"#{anchor}", ""]],
    }


def anchor_span(anchor, content=None):
    return {
        "t": "Span",
        "c": [[anchor, ["anchor"], []], content if content is not None else []],
    }


def bibliography_entry(anchor):
    return [
        {
            "t": "Para",
            "c": [anchor_span(anchor, [str_inline("Reference")])],
        }
    ]


def bibliography_entry_with_inlines(inlines):
    return [{"t": "Para", "c": inlines}]


class ReferenceFormattingTests(unittest.TestCase):
    def run_filter(self, inlines, keys, entries=None):
        anchors = [f"ref{index}" for index in range(len(keys))]
        if entries is None:
            entries = [bibliography_entry(anchor) for anchor in anchors]
        document = {
            "pandoc-api-version": [1, 23, 1],
            "meta": {},
            "blocks": [
                {"t": "Para", "c": inlines},
                {
                    "t": "OrderedList",
                    "c": [
                        [1, {"t": "Decimal"}, {"t": "Period"}],
                        entries,
                    ],
                },
            ],
        }

        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "reference_keys.csv").write_text(
                "\n".join(keys) + "\n", encoding="utf8"
            )
            result = subprocess.run(
                ["node", str(FILTER_PATH)],
                cwd=directory,
                input=json.dumps(document),
                capture_output=True,
                text=True,
                check=True,
            )

        return json.loads(result.stdout)

    def to_latex(self, document):
        result = subprocess.run(
            ["pandoc", "--from=json", "--to=latex", "--natbib"],
            input=json.dumps(document),
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()

    def test_multi_reference_run_uses_one_non_breaking_citation(self):
        inlines = [
            str_inline("Text"),
            {"t": "Space"},
            citation_link(47, "ref0"),
            citation_link(60, "ref1"),
            {"t": "Space"},
            citation_link(61, "ref2"),
            str_inline("."),
        ]

        filtered = self.run_filter(inlines, ["ref47", "ref60", "ref61"])
        paragraph = filtered["blocks"][0]["c"]

        self.assertEqual(paragraph[1], {"t": "RawInline", "c": ["latex", "~"]})
        self.assertEqual([inline["t"] for inline in paragraph], [
            "Str",
            "RawInline",
            "Cite",
            "Str",
        ])
        self.assertEqual(
            [citation["citationId"] for citation in paragraph[2]["c"][0]],
            ["ref47", "ref60", "ref61"],
        )
        self.assertEqual(
            self.to_latex(filtered),
            r"Text~\citep{ref47, ref60, ref61}.",
        )

    def test_separate_reference_groups_remain_separate(self):
        inlines = [
            str_inline("One"),
            {"t": "Space"},
            citation_link(1, "ref0"),
            {"t": "Space"},
            str_inline("and"),
            {"t": "Space"},
            citation_link(2, "ref1"),
            str_inline("."),
        ]

        filtered = self.run_filter(inlines, ["first", "second"])

        self.assertEqual(
            self.to_latex(filtered),
            r"One~\citep{first} and~\citep{second}.",
        )


    def test_bookmark_at_an_entry_boundary_belongs_to_the_following_entry(self):
        # Word stores a bookmark that starts at the paragraph boundary as an
        # empty span Pandoc reports at the end of the preceding entry.
        entries = [
            bibliography_entry_with_inlines(
                [
                    anchor_span("own0", [str_inline("First")]),
                    str_inline(" reference"),
                    anchor_span("boundary1"),
                ]
            ),
            bibliography_entry_with_inlines(
                [str_inline("Second reference"), anchor_span("boundary2")]
            ),
            bibliography_entry_with_inlines([str_inline("Third reference")]),
        ]

        filtered = self.run_filter(
            [
                citation_link(1, "own0"),
                {"t": "Space"},
                str_inline("and"),
                {"t": "Space"},
                citation_link(2, "boundary1"),
                {"t": "Space"},
                str_inline("and"),
                {"t": "Space"},
                citation_link(3, "boundary2"),
            ],
            ["first", "second", "third"],
            entries=entries,
        )

        self.assertEqual(
            self.to_latex(filtered),
            r"\citep{first} and~\citep{second} and~\citep{third}",
        )

    def test_an_anchor_before_text_stays_with_its_own_entry(self):
        entries = [
            bibliography_entry_with_inlines(
                [anchor_span("own0"), str_inline("First reference")]
            ),
            bibliography_entry_with_inlines(
                [anchor_span("own1"), str_inline("Second reference")]
            ),
        ]

        filtered = self.run_filter(
            [
                citation_link(1, "own0"),
                {"t": "Space"},
                str_inline("and"),
                {"t": "Space"},
                citation_link(2, "own1"),
            ],
            ["first", "second"],
            entries=entries,
        )

        self.assertEqual(
            self.to_latex(filtered),
            r"\citep{first} and~\citep{second}",
        )


if __name__ == "__main__":
    unittest.main()
