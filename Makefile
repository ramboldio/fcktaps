DOCX ?=
PAPER_DIR ?= ../paper

.PHONY: all prepare pdf clean clear check-input

all: check-input
	@python3 "$(CURDIR)/report_warnings.py" clear "$(PAPER_DIR)/.fcktaps-warnings"
	@DOCX_PATH="$$(cd "$$(dirname "$(DOCX)")" && pwd)/$$(basename "$(DOCX)")"; \
	$(MAKE) -C "$(PAPER_DIR)" \
		-f "$(CURDIR)/Paper Folder TEMPLATE/Makefile" \
		DOCX="$$DOCX_PATH" \
		FCKTAPS="$(CURDIR)" \
		WARNINGS_FILE=".fcktaps-warnings" \
		all; \
	status=$$?; \
	if [ -z "$$FCKTAPS_SUPPRESS_WARNING_DISPLAY" ]; then \
		python3 "$(CURDIR)/report_warnings.py" show "$(PAPER_DIR)/.fcktaps-warnings"; \
	fi; \
	exit $$status

prepare: check-input
	@python3 "$(CURDIR)/report_warnings.py" clear "$(PAPER_DIR)/.fcktaps-warnings"
	@DOCX_PATH="$$(cd "$$(dirname "$(DOCX)")" && pwd)/$$(basename "$(DOCX)")"; \
	$(MAKE) -C "$(PAPER_DIR)" \
		-f "$(CURDIR)/Paper Folder TEMPLATE/Makefile" \
		DOCX="$$DOCX_PATH" \
		FCKTAPS="$(CURDIR)" \
		WARNINGS_FILE=".fcktaps-warnings" \
		prepare

pdf: check-input
	@DOCX_PATH="$$(cd "$$(dirname "$(DOCX)")" && pwd)/$$(basename "$(DOCX)")"; \
	$(MAKE) -C "$(PAPER_DIR)" \
		-f "$(CURDIR)/Paper Folder TEMPLATE/Makefile" \
		DOCX="$$DOCX_PATH" \
		FCKTAPS="$(CURDIR)" \
		WARNINGS_FILE=".fcktaps-warnings" \
		compile

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
		clean

clear: clean
