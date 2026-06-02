from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def image_files(folder: Path) -> list[Path]:
    return sorted(
        path for path in folder.iterdir()
        if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".avif"}
    )


def load_font(size: int) -> ImageFont.ImageFont:
    for name in ("arial.ttf", "segoeui.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def fit_image(image: Image.Image, size: int) -> Image.Image:
    image = image.convert("RGB")
    image.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (size, size), "white")
    x = (size - image.width) // 2
    y = (size - image.height) // 2
    canvas.paste(image, (x, y))
    return canvas


def build_sheet(files: list[Path], output: Path, columns: int = 4, thumb: int = 210) -> None:
    label_height = 54
    gap = 16
    rows = math.ceil(len(files) / columns)
    width = columns * thumb + (columns + 1) * gap
    height = rows * (thumb + label_height) + (rows + 1) * gap
    sheet = Image.new("RGB", (width, height), "#f7f3ee")
    draw = ImageDraw.Draw(sheet)
    font = load_font(15)
    small = load_font(12)

    for index, file_path in enumerate(files):
        row, col = divmod(index, columns)
        x = gap + col * (thumb + gap)
        y = gap + row * (thumb + label_height + gap)
        try:
            with Image.open(file_path) as source:
                image = fit_image(source, thumb)
        except OSError:
            image = Image.new("RGB", (thumb, thumb), "#eadfd4")
        sheet.paste(image, (x, y))
        draw.rectangle((x, y, x + thumb, y + thumb), outline="#d5c9bd")
        stem = file_path.stem
        number, _, name = stem.partition("-")
        draw.text((x, y + thumb + 8), f"{number} {name[:24]}", fill="#241b15", font=font)
        draw.text((x, y + thumb + 30), file_path.suffix.lower().lstrip("."), fill="#74675c", font=small)

    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, quality=90)


def main() -> None:
    folder = Path(sys.argv[1])
    batch_size = int(sys.argv[2]) if len(sys.argv) > 2 else 24
    files = image_files(folder)
    out_dir = folder / "contact-sheets"
    for start in range(0, len(files), batch_size):
        batch = files[start:start + batch_size]
        output = out_dir / f"contact-{start // batch_size + 1:02d}.jpg"
        build_sheet(batch, output)
        print(output)


if __name__ == "__main__":
    main()
