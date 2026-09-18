#!/usr/bin/env python3
"""Build the ACM TAPS submission ZIP from a paper's build directory.

Usage: taps_package.py <build-dir> [archive-name]

The build directory is the TAPS source tree: LaTeX runs inside it, so the
generated paper.tex refers to its bibliography and figures by paths relative to
it. The archive name defaults to "paper"; TAPS supplies the required final name
in the form ProceedingAcronym-PaperID.
"""

import re
import sys
import zipfile
from pathlib import Path


INCLUDE_GRAPHICS = re.compile(
    r"\\includegraphics\*?(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}"
)
BIBLIOGRAPHY = re.compile(r"\\bibliography\s*\{([^}]+)\}")
TAPS_FILENAME = re.compile(r"^[A-Za-z0-9._/-]+$")
ARCHIVE_NAME = re.compile(r"^[A-Za-z0-9._-]+$")
# TAPS expects the manuscript sources under "Source" and the built document
# under "pdf".
PACKAGE_SOURCE_DIR = "Source"
PACKAGE_PDF_DIR = "pdf"


def package_source_files(build_dir: Path, tex_path: Path) -> list[Path]:
    """Return the generated TeX and every local resource it references."""
    tex = tex_path.read_text(encoding="utf8")
    relative_paths = {Path("paper.tex")}

    for bibliography_group in BIBLIOGRAPHY.findall(tex):
        for bibliography in bibliography_group.split(","):
            bibliography_path = Path(bibliography.strip())
            if not bibliography_path.suffix:
                bibliography_path = bibliography_path.with_suffix(".bib")
            relative_paths.add(bibliography_path)

    for graphic in INCLUDE_GRAPHICS.findall(tex):
        relative_paths.add(Path(graphic.strip()))

    build_root = build_dir.resolve()
    source_files = []
    for relative_path in sorted(relative_paths, key=lambda path: path.as_posix()):
        if relative_path.is_absolute():
            raise RuntimeError(
                f"TAPS source path must be relative to the build directory: {relative_path}"
            )
        source_path = (build_dir / relative_path).resolve()
        try:
            archive_path = source_path.relative_to(build_root)
        except ValueError as error:
            raise RuntimeError(
                f"TAPS source path escapes the build directory: {relative_path}"
            ) from error
        if not source_path.is_file():
            raise RuntimeError(f"TAPS source file not found: {relative_path}")
        if not TAPS_FILENAME.fullmatch(archive_path.as_posix()):
            raise RuntimeError(
                "TAPS source filenames may contain only letters, numbers, "
                f"periods, dashes, underscores, and directories: {archive_path}"
            )
        source_files.append(source_path)
    return source_files


def create_taps_package(build_dir: Path, name: str = "paper") -> Path:
    """Create Source/ and pdf/ trees in a ZIP suitable for ACM TAPS."""
    archive_name = name.removesuffix(".zip")
    if not ARCHIVE_NAME.fullmatch(archive_name):
        raise RuntimeError(
            "TAPS archive names may contain only letters, numbers, periods, "
            f"dashes, and underscores: {name}"
        )

    tex_path = build_dir / "paper.tex"
    paper_pdf = build_dir / "paper.pdf"
    if not tex_path.is_file():
        raise RuntimeError(f"generated LaTeX not found after build: {tex_path}")
    if not paper_pdf.is_file():
        raise RuntimeError(f"PDF not found after build: {paper_pdf}")

    source_files = package_source_files(build_dir, tex_path)
    package_path = build_dir / f"{archive_name}.zip"
    temporary_path = build_dir / f".{archive_name}.zip.tmp"
    temporary_path.unlink(missing_ok=True)
    try:
        with zipfile.ZipFile(
            temporary_path,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=9,
        ) as package:
            package.writestr(f"{PACKAGE_SOURCE_DIR}/", b"")
            package.writestr(f"{PACKAGE_PDF_DIR}/", b"")
            for source_file in source_files:
                relative_path = source_file.resolve().relative_to(build_dir.resolve())
                package.write(source_file, Path(PACKAGE_SOURCE_DIR) / relative_path)
            package.write(paper_pdf, f"{PACKAGE_PDF_DIR}/paper.pdf")
        temporary_path.replace(package_path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise

    print(f"TAPS package: {package_path}")
    return package_path


def main() -> None:
    if not 2 <= len(sys.argv) <= 3:
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        sys.exit(2)

    try:
        create_taps_package(Path(sys.argv[1]), *sys.argv[2:3])
    except RuntimeError as error:
        print(f"ERROR -- {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
