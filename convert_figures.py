#!/usr/bin/env python3
"""
Convert figures to PDF for pdflatex.
- SVG → PDF via cairosvg  (pip install cairosvg; also needs libcairo)
- EMF → PNG via LibreOffice headless
- JPG/PNG/JPEG: left as-is (pdflatex includes them natively)

Usage: python3 convert_figures.py <figures_dir>
"""

import sys
import subprocess
from pathlib import Path

def convert_svg(src: Path, dst: Path):
    import cairosvg
    cairosvg.svg2pdf(url=str(src), write_to=str(dst))
    print(f"  SVG → PDF: {src.name} → {dst.name}")

def convert_emf(src: Path, dst: Path):
    """Convert EMF to PNG (pdflatex can include PNG directly)."""
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
            return

    print(f"  WARNING: could not convert {src.name} — install LibreOffice for EMF support", file=sys.stderr)

def main():
    figures_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("figures/media")
    if not figures_dir.exists():
        print(f"Directory not found: {figures_dir}", file=sys.stderr)
        sys.exit(1)

    for src in sorted(figures_dir.iterdir()):
        ext = src.suffix.lower()
        if ext == ".svg":
            convert_svg(src, src.with_suffix(".pdf"))
        elif ext == ".emf":
            convert_emf(src, src.with_suffix(".png"))

if __name__ == "__main__":
    main()
