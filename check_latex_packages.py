#!/usr/bin/env python3
"""Warn about explicitly loaded LaTeX packages not accepted by ACM TAPS."""

import os
import re
import sys
from pathlib import Path


# https://authors.acm.org/proceedings/production-information/accepted-latex-packages
#
# Keep this local so package validation also works in offline builds.  The ACM
# page links a machine-readable JSON list; this set is the union of the names
# shown on the page and in that JSON file (consulted July 22, 2026).
TAPS_ACCEPTED_PACKAGES = frozenset(
    """
    abstract acronym algorithm algorithm2e algorithmic alltt amsbsy amscd
    amsfonts amsgen amsmath amsmidx amsopn amssymb amstext amsthm amsxtra
    apacite appendix auxhook balance bbding bbold bm bold-braces braket
    breakurl calc cancel ccicons centernot cgloss4e changes checkend CJK clean
    cleveref cmap color colortbl comma coollist coolstr crossreftools curves
    datenumber dcolumn decimal delarray dirtytalk draftwatermark enumitem
    epigraph epstopdf esdiff etex eucal eufrak fancybox fancyhdr fancyvrb
    fix-cm fixfoot fixltx2e fixme flafter float fontawesome fontawesome5
    fontenc forloop fp framed gb4e geometry glossaries graphics graphicx
    graphpap harmony html hyperref ifpdf ifthen index inputenc iopams keyval
    kvoptions listings lscape makecell makeidx maple2e mapleenv mapleplots
    maplestyle mapletab mapleutil mathabx mathptmx mathtool mathtools mciteplus
    microtype multirow natbib newlfont nicefrac nomencl nopageno oldlfont
    overword physics pifont rotating setspace shortvrb showidx SIunits siunitx
    stfloats stmaryrd soul subcaption subfig subfigure suffix svg tabular
    textcase textcomp textgreek tfrupee tipa tipx titlepage tloop totpages
    trimspaces units upmath url verbatim wrapfig xcolor xfrac xspace
    """.split()
)

PACKAGE_COMMAND = re.compile(
    r"\\(?:usepackage|RequirePackage)\s*"
    r"(?:\[[^\]]*\]\s*)?"
    r"\{([^{}]+)\}",
    re.MULTILINE,
)


def strip_comments(source: str) -> str:
    """Remove TeX comments while retaining escaped percent signs."""
    uncommented_lines = []
    for line in source.splitlines(keepends=True):
        for index, character in enumerate(line):
            if character != "%":
                continue
            backslashes = 0
            cursor = index - 1
            while cursor >= 0 and line[cursor] == "\\":
                backslashes += 1
                cursor -= 1
            if backslashes % 2 == 0:
                line = line[:index] + ("\n" if line.endswith("\n") else "")
                break
        uncommented_lines.append(line)
    return "".join(uncommented_lines)


def loaded_packages(source: str) -> list[str]:
    """Return explicitly loaded package names once, in source order."""
    packages = []
    seen = set()
    for match in PACKAGE_COMMAND.finditer(strip_comments(source)):
        for raw_name in match.group(1).split(","):
            name = raw_name.strip()
            if name and name not in seen:
                seen.add(name)
                packages.append(name)
    return packages


def unsupported_packages(source: str) -> list[str]:
    return [
        package
        for package in loaded_packages(source)
        if package not in TAPS_ACCEPTED_PACKAGES
    ]


def emit_warning(message: str) -> None:
    warnings_file = os.environ.get("FCKTAPS_WARNINGS_FILE")
    if warnings_file:
        with Path(warnings_file).open("a", encoding="utf8") as output:
            output.write(f"{message}\n")
    else:
        print(f"WARNING -- {message}", file=sys.stderr)


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: check_latex_packages.py <paper.tex>", file=sys.stderr)
        sys.exit(2)

    tex_path = Path(sys.argv[1])
    source = tex_path.read_text(encoding="utf8")
    for package in unsupported_packages(source):
        emit_warning(
            f'LaTeX package "{package}" is not on the ACM TAPS accepted-package list'
        )


if __name__ == "__main__":
    main()
