DOCX ?=
FCKTAPS ?= $(if $(wildcard ../patch_latex_things.js),$(abspath ..),$(abspath ../fcktaps))
FIGURE_OVERRIDES ?= figures/override
OVERRIDE_FILES := $(wildcard $(FIGURE_OVERRIDES)/*)
FRONTMATTER_DIR ?= frontmatter
FRONTMATTER_FILES := $(addprefix $(FRONTMATTER_DIR)/,authors.tex ccs.tex rights.tex)
WARNINGS_FILE ?= .fcktaps-warnings

.PHONY: all clean check-input check-packages paper_indexed.json figure-overrides

all: check-packages paper.pdf

check-input:
	@test -n "$(DOCX)" || { \
		echo 'Usage: make DOCX="/path/to/manuscript.docx"' >&2; \
		exit 2; \
	}
	@test -f "$(DOCX)" || { \
		echo 'Document not found: $(DOCX)' >&2; \
		exit 2; \
	}

paper.json: | check-input
	pandoc "$(DOCX)" \
		--from=docx+styles --to=json --output=$@ \
		--extract-media=figures

figures-converted: paper.json
	python3 "$(FCKTAPS)/convert_figures.py" figures/media
	@touch $@

paper_indexed.json: paper.json figures-converted zotero.bib reference_keys.csv
	FCKTAPS_WARNINGS_FILE="$(WARNINGS_FILE)" \
	FCKTAPS_FIGURE_OVERRIDES="$(FIGURE_OVERRIDES)" \
		pandoc paper.json --from=json --to=json --output=$@ \
		--filter="$(FCKTAPS)/validate_references.js" \
		--filter="$(FCKTAPS)/link_refs_to_bibliography.js" \
		--filter="$(FCKTAPS)/index.js"

figure-overrides: paper_indexed.json $(OVERRIDE_FILES)
	FCKTAPS_WARNINGS_FILE="$(WARNINGS_FILE)" \
		python3 "$(FCKTAPS)/apply_figure_overrides.py" \
		"$(FIGURE_OVERRIDES)" figures/media paper_indexed.json
	@touch $@

paper_filtered.json: paper_indexed.json figure-overrides $(FRONTMATTER_FILES)
	FCKTAPS_WARNINGS_FILE="$(WARNINGS_FILE)" \
	FCKTAPS_FRONTMATTER_DIR="$(FRONTMATTER_DIR)" \
		pandoc paper_indexed.json --from=json --to=json --output=$@ \
		--filter="$(FCKTAPS)/rewrite_paths_as_pdf_images.js" \
		--filter="$(FCKTAPS)/patch_latex_things.js"

paper_unpatched.tex: paper_filtered.json
	pandoc $< --from=json --to=latex --natbib --output=$@

paper.tex: paper_unpatched.tex
	cp $< $@

check-packages: paper.tex
	FCKTAPS_WARNINGS_FILE="$(WARNINGS_FILE)" \
		python3 "$(FCKTAPS)/check_latex_packages.py" paper.tex

paper.pdf: paper.tex zotero.bib
	-pdflatex -interaction=nonstopmode paper.tex
	-bibtex paper
	-pdflatex -interaction=nonstopmode paper.tex
	pdflatex -interaction=nonstopmode paper.tex

clean:
	rm -f paper.json paper_indexed.json paper_filtered.json paper.tex paper_unpatched.tex
	rm -f paper.pdf paper.zip paper-compressed.pdf .paper.zip.tmp
	rm -f paper.bbl paper.blg paper.aux paper.log paper.out comment.cut figures-converted figure-overrides
	# Persistent figure overrides and frontmatter live outside generated media.
	rm -rf figures/media
	python3 "$(FCKTAPS)/report_warnings.py" clear "$(WARNINGS_FILE)"
