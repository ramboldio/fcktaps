#!/usr/bin/env python3
"""Copy figure-numbered overrides onto the corresponding extracted assets."""

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


NAME_PATTERN = re.compile(
    r"^(?P<target>figure(?P<number>[1-9]\d*)(?:-(?P<placement>h))?)"
    r"--(?P<description>[a-z0-9]+(?:[-+][a-z0-9]+)*)"
    r"(?P<extension>\.[A-Za-z0-9]+)$"
)

SINGLE_COLUMN_WIDTH_IN = 3.33
DOUBLE_COLUMN_WIDTH_IN = 7.0
SIZE_TOLERANCE_IN = 0.05


def warn(message: str) -> None:
    warnings_file = os.environ.get("FCKTAPS_WARNINGS_FILE")
    if warnings_file:
        with Path(warnings_file).open("a", encoding="utf8") as output:
            output.write(f"{message}\n")
    else:
        print(f"WARNING -- {message}\n", file=sys.stderr)


def pdf_size_inches(path: Path):
    """Return the first PDF page's width and height in inches when possible."""
    try:
        try:
            from pypdf import PdfReader
        except ImportError:
            from PyPDF2 import PdfReader
        box = PdfReader(str(path)).pages[0].cropbox
        return float(box.width) / 72, float(box.height) / 72
    except (ImportError, OSError, ValueError):
        pass

    sips = shutil.which("sips")
    if not sips:
        return None
    result = subprocess.run(
        [sips, "-g", "pixelWidth", "-g", "pixelHeight", "-g", "dpiWidth", "-g", "dpiHeight", str(path)],
        capture_output=True,
        text=True,
    )
    values = dict(re.findall(r"\s+(pixelWidth|pixelHeight|dpiWidth|dpiHeight):\s+([0-9.]+)", result.stdout))
    if len(values) != 4:
        return None
    return (
        float(values["pixelWidth"]) / float(values["dpiWidth"]),
        float(values["pixelHeight"]) / float(values["dpiHeight"]),
    )


def raster_size_inches(path: Path):
    try:
        from PIL import Image
        with Image.open(path) as image:
            dpi = image.info.get("dpi")
            if not dpi or not dpi[0] or not dpi[1]:
                return None
            return image.width / dpi[0], image.height / dpi[1]
    except (ImportError, OSError, ValueError):
        return None


def warn_about_format_and_size(source: Path, figure_number: int) -> None:
    is_pdf = source.suffix.lower() == ".pdf"
    if not is_pdf:
        warn(f"{source.name} is {source.suffix.lstrip('.').upper()}, not PDF; override figures should be PDF for maximum quality")

    size = pdf_size_inches(source) if is_pdf else raster_size_inches(source)
    if not size:
        warn(f"could not determine the template width of {source.name}")
        return

    width, _ = size
    target_width = DOUBLE_COLUMN_WIDTH_IN if figure_number == 1 else SINGLE_COLUMN_WIDTH_IN
    if abs(width - target_width) > SIZE_TOLERANCE_IN:
        role = "teaser" if figure_number == 1 else "single-column"
        warn(
            f"{source.name} is {width:.2f} in wide; the {role} template width is "
            f"{target_width:.2f} in (tolerance ±{SIZE_TOLERANCE_IN:.2f} in)"
        )


def collect_images(node, images=None):
    """Return image paths nested anywhere below a Pandoc AST node."""
    if images is None:
        images = []
    if isinstance(node, list):
        for child in node:
            collect_images(child, images)
    elif isinstance(node, dict):
        if node.get("t") == "Image":
            images.append(node["c"][2][0])
        for child in node.values():
            collect_images(child, images)
    return images


def figure_images(document_path: Path):
    """Return the sole image path selected for each top-level figure."""
    with document_path.open(encoding="utf8") as source:
        document = json.load(source)

    result = []
    for block in document.get("blocks", []):
        if block.get("t") != "Figure":
            continue
        images = collect_images(block)
        if not images:
            raise ValueError(f"Figure {len(result) + 1} contains no image")
        result.append(images[0])
    return result


def main() -> None:
    if len(sys.argv) != 4:
        print(
            "Usage: apply_figure_overrides.py <override-dir> <media-dir> <indexed-json>",
            file=sys.stderr,
        )
        sys.exit(2)

    override_dir = Path(sys.argv[1])
    media_dir = Path(sys.argv[2])
    indexed_json = Path(sys.argv[3])

    if not override_dir.is_dir():
        print(f"No figure overrides found at {override_dir}")
        return

    figures = figure_images(indexed_json)
    seen_targets = set()
    for source in sorted(path for path in override_dir.iterdir() if path.is_file()):
        # Finder and other file managers may leave metadata files in this folder.
        # They are not figure overrides and should not fail the build.
        if source.name == "README.md" or source.name.startswith("."):
            continue

        match = NAME_PATTERN.fullmatch(source.name)
        if not match:
            print(
                f"Invalid override name: {source.name}\n"
                "Expected: figure<number>[-h]--<descriptive-slug>.<extension>",
                file=sys.stderr,
            )
            sys.exit(1)

        figure_number = int(match.group("number"))
        if figure_number > len(figures):
            print(
                f"Override {source.name} targets missing Figure {figure_number}; "
                f"the document contains {len(figures)} figures",
                file=sys.stderr,
            )
            sys.exit(1)

        image_id = Path(figures[figure_number - 1]).stem
        extension = match.group("extension")
        target = media_dir / f"{image_id}{extension}"
        if figure_number in seen_targets:
            print(f"Multiple overrides target Figure {figure_number}", file=sys.stderr)
            sys.exit(1)
        extracted_candidates = list(media_dir.glob(f"{image_id}.*"))
        if not extracted_candidates:
            print(
                f"Override {source.name} targets missing extracted image {image_id} "
                f"for Figure {figure_number}",
                file=sys.stderr,
            )
            sys.exit(1)
        if extension.lower() != ".pdf" and not target.is_file():
            print(
                f"Override {source.name} does not match extracted file extension for {image_id}",
                file=sys.stderr,
            )
            sys.exit(1)

        warn_about_format_and_size(source, figure_number)
        shutil.copy2(source, target)
        seen_targets.add(figure_number)
        print(f"  override: {source.name} → Figure {figure_number} ({target.name})")


if __name__ == "__main__":
    main()
