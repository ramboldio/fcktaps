DOCX ?=
PAPER_DIR ?= ../paper
BUILD_DIR ?= build
# Optional overrides of paper-local settings; the paper's own fcktaps.mk
# applies to each of these that is left empty.
CITE_STYLE ?=
PACKAGE_NAME ?=
PAPER_SETTINGS := $(if $(CITE_STYLE),CITE_STYLE="$(CITE_STYLE)") \
	$(if $(PACKAGE_NAME),PACKAGE_NAME="$(PACKAGE_NAME)")
WARNINGS_FILE := $(BUILD_DIR)/.fcktaps-warnings

.PHONY: all prepare pdf package clean clear check-input

all: check-input
	@python3 "$(CURDIR)/report_warnings.py" clear "$(PAPER_DIR)/$(WARNINGS_FILE)"
	@DOCX_PATH="$$(cd "$$(dirname "$(DOCX)")" && pwd)/$$(basename "$(DOCX)")"; \
	$(MAKE) -C "$(PAPER_DIR)" \
		-f "$(CURDIR)/Paper Folder TEMPLATE/Makefile" \
		DOCX="$$DOCX_PATH" \
		FCKTAPS="$(CURDIR)" \
		BUILD_DIR="$(BUILD_DIR)" \
		WARNINGS_FILE="$(WARNINGS_FILE)" \
		$(PAPER_SETTINGS) \
		all; \
	status=$$?; \
	if [ -z "$$FCKTAPS_SUPPRESS_WARNING_DISPLAY" ]; then \
		python3 "$(CURDIR)/report_warnings.py" show "$(PAPER_DIR)/$(WARNINGS_FILE)"; \
	fi; \
	exit $$status

prepare: check-input
	@python3 "$(CURDIR)/report_warnings.py" clear "$(PAPER_DIR)/$(WARNINGS_FILE)"
	@DOCX_PATH="$$(cd "$$(dirname "$(DOCX)")" && pwd)/$$(basename "$(DOCX)")"; \
	$(MAKE) -C "$(PAPER_DIR)" \
		-f "$(CURDIR)/Paper Folder TEMPLATE/Makefile" \
		DOCX="$$DOCX_PATH" \
		FCKTAPS="$(CURDIR)" \
		BUILD_DIR="$(BUILD_DIR)" \
		WARNINGS_FILE="$(WARNINGS_FILE)" \
		$(PAPER_SETTINGS) \
		prepare

pdf: check-input
	@DOCX_PATH="$$(cd "$$(dirname "$(DOCX)")" && pwd)/$$(basename "$(DOCX)")"; \
	$(MAKE) -C "$(PAPER_DIR)" \
		-f "$(CURDIR)/Paper Folder TEMPLATE/Makefile" \
		DOCX="$$DOCX_PATH" \
		FCKTAPS="$(CURDIR)" \
		BUILD_DIR="$(BUILD_DIR)" \
		WARNINGS_FILE="$(WARNINGS_FILE)" \
		$(PAPER_SETTINGS) \
		compile

package: check-input
	@DOCX_PATH="$$(cd "$$(dirname "$(DOCX)")" && pwd)/$$(basename "$(DOCX)")"; \
	$(MAKE) -C "$(PAPER_DIR)" \
		-f "$(CURDIR)/Paper Folder TEMPLATE/Makefile" \
		DOCX="$$DOCX_PATH" \
		FCKTAPS="$(CURDIR)" \
		BUILD_DIR="$(BUILD_DIR)" \
		WARNINGS_FILE="$(WARNINGS_FILE)" \
		$(PAPER_SETTINGS) \
		package

check-input:
	@test -n "$(DOCX)" || { \
		echo 'Usage: make DOCX="/path/to/manuscript.docx"' >&2; \
		exit 2; \
	}
	@test -f "$(DOCX)" || { \
		echo 'Document not found: $(DOCX)' >&2; \
		exit 2; \
	}
	@test -d "$(PAPER_DIR)" || { \
		echo 'Paper directory not found: $(PAPER_DIR)' >&2; \
		echo 'Pass it with PAPER_DIR=/path/to/paper-directory' >&2; \
		exit 2; \
	}

clean:
	$(MAKE) -C "$(PAPER_DIR)" \
		-f "$(CURDIR)/Paper Folder TEMPLATE/Makefile" \
		FCKTAPS="$(CURDIR)" \
		BUILD_DIR="$(BUILD_DIR)" \
		WARNINGS_FILE="$(WARNINGS_FILE)" \
		$(PAPER_SETTINGS) \
		clean

clear: clean
