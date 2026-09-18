DOCX ?=
FCKTAPS ?= $(if $(wildcard ../patch_latex_things.js),$(abspath ..),$(abspath ../fcktaps))
# Optional paper-local settings, such as CITE_STYLE. Read here so that they
# apply to both `make` in the paper directory and the fcktaps command.
-include fcktaps.mk
# Every generated file lives below $(BUILD_DIR); `make clean` removes it whole.
# Persistent inputs stay in the paper directory: zotero.bib, reference_keys.csv,
# $(ALT_TEXT_FILE), $(FRONTMATTER_DIR), and $(FIGURE_OVERRIDES).
BUILD_DIR ?= build
FIGURE_OVERRIDES ?= figures/override
OVERRIDE_FILES := $(wildcard $(FIGURE_OVERRIDES)/*)
FRONTMATTER_DIR ?= frontmatter
FRONTMATTER_FILES := $(addprefix $(FRONTMATTER_DIR)/,authors.tex ccs.tex rights.tex)
ALT_TEXT_FILE ?= alt-text.txt
ALT_TEXT_DEPENDENCY := $(wildcard $(ALT_TEXT_FILE))
# acmnumeric (CHI/UIST) or acmauthoryear (SIGGRAPH)
CITE_STYLE ?= acmnumeric
# float (full-width float after the ACM frontmatter) or teaser (acmart's teaser
# slot on the first page)
FIGURE_ONE_PLACEMENT ?= float
# Short title for the running head; empty lets acmart truncate the full title
SHORT_TITLE ?=
# Figure numbers to set across both columns, for example "2 5"
WIDE_FIGURES ?=
# acmart's review option (line numbers for reviewers): true or false
REVIEW ?= false
# acmart's anonymous option: true, false, or empty to leave it out
ANONYMOUS ?=
# Name of the TAPS submission archive, without the .zip suffix. The TAPS
# dashboard supplies it as ProceedingAcronym-PaperID.
PACKAGE_NAME ?= paper
WARNINGS_FILE ?= $(BUILD_DIR)/.fcktaps-warnings
MEDIA_DIR := $(BUILD_DIR)/figures/media

# LaTeX runs inside $(BUILD_DIR), which holds every file the generated
# paper.tex references, so the build directory is also the TAPS source tree.
define latex_passes
	-cd $(BUILD_DIR) && pdflatex -interaction=nonstopmode paper.tex
	-cd $(BUILD_DIR) && bibtex paper
	-cd $(BUILD_DIR) && pdflatex -interaction=nonstopmode paper.tex
	cd $(BUILD_DIR) && pdflatex -interaction=nonstopmode paper.tex
endef

.PHONY: all prepare compile package clean check-input check-packages \
	$(BUILD_DIR)/paper_indexed.json $(BUILD_DIR)/figure-overrides

all: prepare $(BUILD_DIR)/paper.pdf

# The bibliography copy belongs to source preparation: --compress validates
# every file the generated LaTeX references before the LaTeX passes run.
prepare: check-packages $(BUILD_DIR)/zotero.bib

check-input:
	@test -n "$(DOCX)" || { \
		echo 'Usage: make DOCX="/path/to/manuscript.docx"' >&2; \
		exit 2; \
	}
	@test -f "$(DOCX)" || { \
		echo 'Document not found: $(DOCX)' >&2; \
		exit 2; \
	}

$(BUILD_DIR):
	@mkdir -p $(BUILD_DIR)

$(BUILD_DIR)/paper.json: | check-input $(BUILD_DIR)
	pandoc "$(DOCX)" \
		--from=docx+styles --to=json --output=$@ \
		--extract-media=$(BUILD_DIR)/figures

$(BUILD_DIR)/figures-converted: $(BUILD_DIR)/paper.json
	python3 "$(FCKTAPS)/convert_figures.py" $(MEDIA_DIR)
	@touch $@

$(BUILD_DIR)/paper_indexed.json: $(BUILD_DIR)/paper.json $(BUILD_DIR)/figures-converted zotero.bib reference_keys.csv
	FCKTAPS_WARNINGS_FILE="$(WARNINGS_FILE)" \
	FCKTAPS_FIGURE_OVERRIDES="$(FIGURE_OVERRIDES)" \
		pandoc $(BUILD_DIR)/paper.json --from=json --to=json --output=$@ \
		--filter="$(FCKTAPS)/validate_references.js" \
		--filter="$(FCKTAPS)/link_refs_to_bibliography.js" \
		--filter="$(FCKTAPS)/index.js"

$(BUILD_DIR)/figure-overrides: $(BUILD_DIR)/paper_indexed.json $(OVERRIDE_FILES)
	FCKTAPS_WARNINGS_FILE="$(WARNINGS_FILE)" \
	FCKTAPS_WIDE_FIGURES="$(WIDE_FIGURES)" \
		python3 "$(FCKTAPS)/apply_figure_overrides.py" \
		"$(FIGURE_OVERRIDES)" $(MEDIA_DIR) $(BUILD_DIR)/paper_indexed.json
	@touch $@

$(BUILD_DIR)/paper_filtered.json: $(BUILD_DIR)/paper_indexed.json $(BUILD_DIR)/figure-overrides $(FRONTMATTER_FILES) $(ALT_TEXT_DEPENDENCY)
	FCKTAPS_WARNINGS_FILE="$(WARNINGS_FILE)" \
	FCKTAPS_FRONTMATTER_DIR="$(FRONTMATTER_DIR)" \
	FCKTAPS_ALT_TEXT_FILE="$(ALT_TEXT_FILE)" \
	FCKTAPS_CITE_STYLE="$(CITE_STYLE)" \
	FCKTAPS_FIGURE_ONE_PLACEMENT="$(FIGURE_ONE_PLACEMENT)" \
	FCKTAPS_SHORT_TITLE="$(SHORT_TITLE)" \
	FCKTAPS_WIDE_FIGURES="$(WIDE_FIGURES)" \
	FCKTAPS_REVIEW="$(REVIEW)" \
	FCKTAPS_ANONYMOUS="$(ANONYMOUS)" \
	FCKTAPS_BUILD_DIR="$(BUILD_DIR)" \
		pandoc $(BUILD_DIR)/paper_indexed.json --from=json --to=json --output=$@ \
		--filter="$(FCKTAPS)/rewrite_paths_as_pdf_images.js" \
		--filter="$(FCKTAPS)/patch_latex_things.js"

$(BUILD_DIR)/paper_unpatched.tex: $(BUILD_DIR)/paper_filtered.json
	pandoc $< --from=json --to=latex --natbib --output=$@

$(BUILD_DIR)/paper.tex: $(BUILD_DIR)/paper_unpatched.tex
	cp $< $@

check-packages: $(BUILD_DIR)/paper.tex
	FCKTAPS_WARNINGS_FILE="$(WARNINGS_FILE)" \
		python3 "$(FCKTAPS)/check_latex_packages.py" $(BUILD_DIR)/paper.tex

# The generated LaTeX cites \bibliography{zotero}, so the build directory keeps
# its own copy of the persistent bibliography.
$(BUILD_DIR)/zotero.bib: zotero.bib | $(BUILD_DIR)
	cp $< $@

$(BUILD_DIR)/paper.pdf: $(BUILD_DIR)/paper.tex $(BUILD_DIR)/zotero.bib
	$(latex_passes)

# The build directory is the TAPS source tree, so packaging archives it as is.
package: $(BUILD_DIR)/paper.pdf
	python3 "$(FCKTAPS)/taps_package.py" $(BUILD_DIR) "$(PACKAGE_NAME)"

compile:
	@mkdir -p $(BUILD_DIR)
	cp zotero.bib $(BUILD_DIR)/zotero.bib
	$(latex_passes)

clean:
	rm -rf $(BUILD_DIR)
	python3 "$(FCKTAPS)/report_warnings.py" clear "$(WARNINGS_FILE)"
	# Artefacts of paper directories built before the build directory existed.
	rm -f paper.json paper_indexed.json paper_filtered.json paper.tex paper_unpatched.tex
	rm -f paper.pdf paper.zip paper-compressed.pdf .paper.zip.tmp .fcktaps-warnings
	rm -f paper.bbl paper.blg paper.aux paper.log paper.out comment.cut figures-converted figure-overrides
	rm -rf figures/media
