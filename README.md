# fcktaps – File Conversion Kit for TAPS

fcktaps is a command-line tool that converts Microsoft Word (.docx) manuscripts into ACM-compatible LaTeX suitable for the ACM TAPS (The ACM Publishing System) pipeline.
It automates the tedious steps required for preparing a submission-ready LaTeX package from a .docx source.

## Requirements

- pandoc 3.8
- python with PyPDF2
- node
- make
- pdflatex

## Usage

Create a new paper directory by copying every file from
`Paper Folder TEMPLATE`:

```sh
./fcktaps init
```

This creates the default `../paper` directory. Pass a destination to create
the paper elsewhere:

```sh
./fcktaps init "/path/to/new-paper"
```

Initialization refuses to overwrite an existing file or directory.

The default layout expects the working paper directory at `../paper`, containing
that paper's `zotero.bib` and `reference_keys.csv`. From the `fcktaps` repository
directory, pass the Word document to the `fcktaps` command:

```sh
./fcktaps "../YOUR PAPER.docx"
```

The default display hides the verbose LaTeX transcript behind a spinner and
then forwards fcktaps and ACM class warnings in the warning summary. To stream
the complete Pandoc, BibTeX, and LaTeX output, use `-V` or `--verbose`:

Repeated ACM missing-description messages are consolidated and mapped from
generated LaTeX line numbers back to publication figure numbers.

```sh
./fcktaps --verbose "../YOUR PAPER.docx"
```

For a paper directory elsewhere, pass it separately:

```sh
./fcktaps --paper-dir "/path/to/paper-directory" "/path/to/manuscript.docx"
```

The default target converts the `.docx` to Pandoc JSON, extracts and converts
figures, applies the fcktaps filters, emits ACM LaTeX, and builds
`build/paper.pdf`.
Pass `-c` or `--compress` to prepare the generated sources, compress every
referenced PDF figure in the generated `build/figures/media` tree, build
`build/paper.pdf` from those compressed figures, and then compress the final
PDF. Each compressed result atomically replaces its generated PDF only after
Ghostscript succeeds; persistent source files in `figures/override` are never
modified.

```sh
./fcktaps --compress "/path/to/manuscript.docx"
```

Pass `-cf` or `--compress-figures` to compress the referenced PDF figures before
building `build/paper.pdf`, without applying a second compression pass to the
final document:

```sh
./fcktaps --compress-figures "/path/to/manuscript.docx"
```

Pass `-p`, `--publish`, or `--package` to create `build/paper.zip` after a
successful build. These three flags are aliases. The ZIP follows the ACM TAPS
directory layout: `Source/` contains `paper.tex`, the bibliography, and exactly
the figures referenced by the generated LaTeX; `pdf/` contains `paper.pdf`.

```sh
./fcktaps --publish "/path/to/manuscript.docx"
```

The TAPS dashboard supplies the required final archive name in the form
`ProceedingAcronym-PaperID.zip`; rename `build/paper.zip` to that value before
upload. Use `-c -p` together to compress the PDF before it is added to the package.
Use `-cf -p` to package compressed figure sources with the original final PDF.
Both compression modes are independent and work without any publishing flag.

Use `make clean` from either the toolkit or paper directory to remove the whole
`build` directory, along with the artefacts of paper directories built before
that directory existed. Cleaning preserves every persistent file: `zotero.bib`,
`reference_keys.csv`, `figures/override`, `alt-text.txt`, `fcktaps.mk`, and the
paper-local `frontmatter` directory. Every `fcktaps` build runs this cleanup
before rebuilding. If the paper directory is not next to this repository, also
pass the checkout path, for example `FCKTAPS=/path/to/fcktaps`.

The build warns when the paper title or a section heading is not in title case.
Structural labels such as `ACKNOWLEDGMENTS` and `REFERENCES` are excluded, and
technical acronyms and digit-containing names such as `SVG`, `UIST`, and `3D`
are preserved.

The generated LaTeX is also checked against ACM's TAPS accepted-package list.
The warning summary contains one warning for each explicitly loaded
`\usepackage` or `\RequirePackage` package that is not accepted.

Courier New text using Word's `code`, `In-text code`, or `Inline code`
character style is converted to ACM SIGCHI inline code. Each affected text
segment is reported by default as a `DEBUG --` message, with only `DEBUG`
rendered in bold bright cyan.

## Build directory

Every generated file lives in the paper directory's `build/`, which keeps them
apart from the persistent files that a paper is edited through. Nothing outside
`build/` is generated, and nothing inside it is edited by hand:

```text
paper/                   persistent, edited by you
├── zotero.bib
├── reference_keys.csv
├── alt-text.txt
├── fcktaps.mk           optional paper-local settings
├── frontmatter/
├── figures/override/
└── build/               generated, removed by `make clean`
    ├── paper.tex        the generated LaTeX
    ├── paper.pdf        the built document
    ├── paper.zip        the TAPS package, with -p
    ├── zotero.bib       copy of the persistent bibliography
    └── figures/media/   extracted and converted artwork
```

LaTeX runs inside `build/`, so the generated `paper.tex` refers to its figures
and bibliography by paths relative to that directory, and `build/` is itself
the source tree that `--publish` packages. Set `BUILD_DIR` to use a different
directory name.

## Figure overrides

Persistent replacements live in `paper/figures/override`, outside the build
directory, and use names such as `figure5--material+machine-calibration.pdf`.
Descriptive slugs may separate words with hyphens or plus signs. On every build, the portion before `--`
maps the readable override name to the publication figure number and the
generated LaTeX prefers the override PDF. `make clean` preserves this directory.
Add `-h` after the figure number, as in
`figure5-h--calibration-patterns.pdf`, to force that figure's LaTeX placement
from `[h]` to `[H]` using the `float` package.
Add `-u`, as in `figure5-u--calibration-patterns.pdf`, to leave that override's
generated PDF copy uncompressed when `-c` is used. The flags may be combined in
either order, for example `figure5-h-u--calibration-patterns.pdf`.

Each LaTeX figure contains exactly one artwork file. If a Word figure contains
multiple embedded images, the build selects its first image and warns unless a
valid override for that figure already exists; it never creates a multi-image
LaTeX figure. Float barriers at section and subsection boundaries keep queued
figures within the subsection where they occur.

The build warns for every non-PDF override and for artwork that differs from
the `acmart` publication width (7.0 inches for Figure 1, 3.33 inches for
single-column figures, ±0.05-inch tolerance). Figure height is not validated.

## Paper-local settings

Optional per-paper build settings live in the paper directory's `fcktaps.mk`,
which the build reads before its own defaults. Both `make` in the paper
directory and the `fcktaps` command honour it:

```make
# Citation style: acmnumeric (CHI, UIST) or acmauthoryear (SIGGRAPH).
CITE_STYLE := acmauthoryear
```

`acmnumeric` is the default and cites as `[1]`; `acmauthoryear` cites as
`[Kovacs et al. 2018]` and prints an unnumbered, alphabetical reference list.
Both styles use `ACM-Reference-Format.bst`. A `CITE_STYLE=` value passed on the
`make` command line overrides the file.

`FIGURE_ONE_PLACEMENT` chooses where the title image goes. The default `float`
sets Figure 1 as a full-width float after the rendered ACM frontmatter, so it
lands at the top of a later page. `teaser` puts it in acmart's teaser slot,
between the author block and the abstract on the first page:

```make
FIGURE_ONE_PLACEMENT := teaser
```

`WIDE_FIGURES` lists the figures that span both columns instead of one. Figure 1
is always full width and needs no entry:

```make
WIDE_FIGURES := 2 5
```

A two-column float can only be set at the top of a page, and never on the page
its text appears on, so a wide figure is placed at the top of a following page
and ignores an override's `-h` flag. The `acmart` publication width warning
follows this list: figures named here are checked against 7.0 inches rather
than 3.33.

`SHORT_TITLE` sets the running head that `acmart` prints on every page after the
first. The manuscript's full title stays in the frontmatter:

```make
SHORT_TITLE := Demonstrating AirForce
```

Left empty, `acmart` truncates the full title for the running head itself and
warns while doing so.

## Figure descriptions

Persistent figure descriptions live in the paper directory's `alt-text.txt`.
Use one entry per publication figure:

```text
Figure 1: A concise description of the figure's meaningful visual content.

Figure 2: A description of the second figure.
```

Descriptions may continue on following lines. Blank entries are ignored, so
they can be filled progressively. A nonblank file entry overrides alt text
stored on the corresponding image in Word; when no file entry is present, the
Word alt text remains the fallback. The converter emits the selected text as
ACM's `\Description{...}` command. Changes to `alt-text.txt` trigger a rebuild,
and `make clean` never removes it. Set `ALT_TEXT_FILE` to use a different
paper-local file.

## Paper-specific frontmatter

Paper-specific LaTeX lives in the paper directory under `frontmatter/`:

- `authors.tex` contains authors, affiliations, and the short-author label.
- `ccs.tex` contains the ACM Computing Classification System metadata.
- `rights.tex` contains the ACM rights, conference, DOI, and ISBN commands.

The converter reads these fragments on every build in the same way that it
reads persistent figure overrides, and changes to any fragment trigger a
rebuild of the generated LaTeX. `make clean` never removes them. Set
`FRONTMATTER_DIR` to use a different paper-local directory.

The rendered abstract, CCS concepts, keywords, rights banner, and ACM reference
format precede the full-width Figure 1, unless `FIGURE_ONE_PLACEMENT := teaser`
moves it into the first-page teaser slot.

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

If LaTeX fails, the quiet summary reports its first actionable diagnostic and
nearby input-line context as `ERROR -- ...`, with only `ERROR` rendered in bold
bright red. Use `-V` or `--verbose` when the complete build transcript is needed.

`reference_keys.csv` contains one BibTeX key per Word bibliography entry, in
document order. If Word assigns multiple anchors to a merged duplicate entry,
the converter maps every anchor to that one key; the CSV must not repeat it.
