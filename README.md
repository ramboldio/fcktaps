# fcktaps – File Conversion Kit for TAPS

fcktaps is a command-line tool that converts Microsoft Word (.docx) manuscripts into ACM-compatible LaTeX suitable for the ACM TAPS (The ACM Publishing System) pipeline.
It automates the tedious steps required for preparing a submission-ready LaTeX package from a .docx source.

## Requirements

- pandoc
- python with PyPDF2
- node
- make
- pdflatex

## Usage

The default layout expects the working paper directory at `../paper`, containing
that paper's `zotero.bib` and `reference_keys.csv`. From the `fcktaps` repository
directory, pass the Word document to the `fcktaps` command:

```sh
./fcktaps "../131 2026-Naumann-UIST26-five axis laser cutting AS SUBMITTED TO UIST.docx"
```

The default display hides the verbose LaTeX transcript behind a spinner and
then forwards fcktaps and ACM class warnings in the warning summary. To stream
the complete Pandoc, BibTeX, and LaTeX output, use `-V` or `--verbose`:

Repeated ACM missing-description messages are consolidated and mapped from
generated LaTeX line numbers back to publication figure numbers.

```sh
./fcktaps --verbose "../131 2026-Naumann-UIST26-five axis laser cutting AS SUBMITTED TO UIST.docx"
```

For a paper directory elsewhere, pass it separately:

```sh
./fcktaps --paper-dir "/path/to/paper-directory" "/path/to/manuscript.docx"
```

The default target converts the `.docx` to Pandoc JSON, extracts and converts
figures, applies the fcktaps filters, emits ACM LaTeX, and builds `paper.pdf`.
Use `make clean` from either the toolkit or paper directory to remove generated
files. Cleaning removes only `figures/media`; it preserves `figures/override`
and its README. If the paper directory is not next to this repository, also
pass the checkout path, for example
`FCKTAPS=/path/to/fcktaps`.

The build warns when the paper title or a section heading is not in title case.
Structural labels such as `ACKNOWLEDGMENTS` and `REFERENCES` are excluded, and
technical acronyms and digit-containing names such as `SVG`, `UIST`, and `5DOF`
are preserved.

Courier New text using Word's `code`, `In-text code`, or `Inline code`
character style is converted to ACM SIGCHI inline code. Each affected text
segment is reported by default as a `DEBUG --` message, with only `DEBUG`
rendered in bold bright cyan.

## Figure overrides

Persistent replacements live in `paper/figures/override` and use names such as
`figure5--material+machine-calibration.pdf`. Descriptive slugs may separate
words with hyphens or plus signs. On every build, the portion before `--`
maps the readable override name to the publication figure number and the
generated LaTeX prefers the override PDF. `make clean` preserves this directory.
Add `-h` after the figure number, as in
`figure5-h--calibration-patterns.pdf`, to force that figure's LaTeX placement
from `[h]` to `[H]` using the `float` package.

Each LaTeX figure contains exactly one artwork file. If a Word figure contains
multiple embedded images, the build selects its first image and warns unless a
valid override for that figure already exists; it never creates a multi-image
LaTeX figure.

The build warns for every non-PDF override and for artwork that differs from
the `acmart` publication width (7.0 inches for the teaser, 3.33 inches for
single-column figures, ±0.05-inch tolerance). Figure height is not validated.

## Reference validation

Before rewriting Word citations, the build compares every SIGCHI-formatted
Word bibliography item with its `reference_keys.csv` mapping and corresponding
`zotero.bib` entry. Warnings report missing mappings or BibTeX entries, missing
authors, author names represented only by initials, title and year mismatches,
DOI or link changes, unmapped citations, and unused BibTeX records. Initials are
accepted when at least one given name is spelled out, as in `R. Ian Campbell`.
DOI comparison ignores equivalent `doi.org` and `dx.doi.org` spellings; ordinary
links ignore scheme, `www.`, and a trailing slash. Formatting-only differences
in punctuation, capitalization, accents, and common LaTeX commands are ignored.
These checks are advisory and do not stop conversion. All fcktaps warnings are
buffered during conversion and shown after the LaTeX output as `WARNING -- ...`
lines, with only `WARNING` rendered in bold bright yellow.

`reference_keys.csv` contains one BibTeX key per Word bibliography entry, in
document order. If Word assigns multiple anchors to a merged duplicate entry,
the converter maps every anchor to that one key; the CSV must not repeat it.
