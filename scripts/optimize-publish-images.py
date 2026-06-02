import json
import sys
from pathlib import Path

from PIL import Image, ImageOps


def flatten_alpha(image):
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        background = Image.new("RGB", image.size, (255, 255, 255))
        if image.mode != "RGBA":
            image = image.convert("RGBA")
        background.paste(image, mask=image.getchannel("A"))
        return background
    return image.convert("RGB")


def optimize(entry):
    source = Path(entry["source"])
    target = Path(entry["target"])
    target.parent.mkdir(parents=True, exist_ok=True)
    max_size = int(entry.get("maxSize", 520))
    quality = int(entry.get("quality", 78))

    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image)
        if max(image.size) > max_size:
            image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

        suffix = target.suffix.lower()
        if suffix in (".jpg", ".jpeg"):
            flatten_alpha(image).save(target, "JPEG", quality=quality, optimize=True, progressive=True)
        elif suffix == ".png":
            image.save(target, "PNG", optimize=True)
        elif suffix == ".webp":
            flatten_alpha(image).save(target, "WEBP", quality=quality, method=6)
        else:
            target.write_bytes(source.read_bytes())


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: optimize-publish-images.py <manifest.json>")
    manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    for entry in manifest:
        optimize(entry)
    print(json.dumps({"optimized": len(manifest)}, indent=2))


if __name__ == "__main__":
    main()
