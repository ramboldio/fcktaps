#!/usr/bin/env python3
"""
Convert figures to PDF for pdflatex.
- SVG → PDF via cairosvg  (pip install cairosvg; also needs libcairo)
- EMF → PNG via LibreOffice headless
- JPG/PNG/JPEG: left as-is (pdflatex includes them natively)

Usage: python3 convert_figures.py <figures_dir>
"""

import os
import sys
import subprocess
from pathlib import Path

# Framework Python does not automatically search Homebrew's library directory.
# CairoSVG's cairocffi dependency needs this path to locate libcairo on macOS.
homebrew_lib = Path("/opt/homebrew/lib")
if sys.platform == "darwin" and homebrew_lib.is_dir():
    fallback_paths = os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", "").split(":")
    if str(homebrew_lib) not in fallback_paths:
        os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = ":".join(
            path for path in [str(homebrew_lib), *fallback_paths] if path
        )

def has_output(dst: Path) -> bool:
    """Return true for an existing, non-empty converted figure."""
    return dst.is_file() and dst.stat().st_size > 0

def convert_svg(src: Path, dst: Path) -> bool:
    if has_output(dst):
        print(f"  reuse existing: {dst.name}")
        return True

    try:
        import cairosvg
    except ModuleNotFoundError:
        print(
            f"  ERROR: cannot convert {src.name} — install CairoSVG "
            "(python3 -m pip install cairosvg)",
            file=sys.stderr,
        )
        return False

    # A filesystem path may contain URL-significant characters such as '#'.
    # CairoSVG treats its url argument as a URL, so pass an encoded file URI.
    cairosvg.svg2pdf(url=src.resolve().as_uri(), write_to=str(dst))
    print(f"  SVG → PDF: {src.name} → {dst.name}")
    return True

def convert_emf(src: Path, dst: Path) -> bool:
    """Convert EMF to PNG (pdflatex can include PNG directly)."""
    if has_output(dst):
        print(f"  reuse existing: {dst.name}")
        return True

    for soffice in ("libreoffice", "soffice"):
        if subprocess.run(["which", soffice], capture_output=True).returncode != 0:
            continue
        result = subprocess.run(
            [soffice, "--headless", "--convert-to", "png", "--outdir", str(dst.parent), str(src)],
            capture_output=True
        )
        if result.returncode == 0:
            lo_out = dst.parent / (src.stem + ".png")
            if lo_out.exists():
                lo_out.rename(dst)
            print(f"  EMF → PNG (LibreOffice): {src.name} → {dst.name}")
            return True

    print(f"  ERROR: could not convert {src.name} — install LibreOffice for EMF support", file=sys.stderr)
    return False

def main():
    figures_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("figures/media")
    if not figures_dir.exists():
        print(f"Directory not found: {figures_dir}", file=sys.stderr)
        sys.exit(1)

    failures = []
    for src in sorted(figures_dir.iterdir()):
        ext = src.suffix.lower()
        if ext == ".svg":
            if not convert_svg(src, src.with_suffix(".pdf")):
                failures.append(src.name)
        elif ext == ".emf":
            if not convert_emf(src, src.with_suffix(".png")):
                failures.append(src.name)

    if failures:
        print(f"Could not convert: {', '.join(failures)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
