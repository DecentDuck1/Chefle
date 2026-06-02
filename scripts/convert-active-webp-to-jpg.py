import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PHOTO_DIR = ROOT / "food-photo-review-specific-only-v3"
SOURCES_PATH = PHOTO_DIR / "sources.json"
BACKUP_DIR = PHOTO_DIR / "rejected" / "converted-webp-old"


def main():
    manifest = json.loads(SOURCES_PATH.read_text(encoding="utf-8"))
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    converted = 0

    for entry in manifest:
        file_name = entry.get("file", "")
        if not file_name.lower().endswith(".webp"):
            continue

        source = PHOTO_DIR / file_name
        if not source.exists():
            raise FileNotFoundError(source)

        target_name = f"{source.stem}.jpg"
        target = PHOTO_DIR / target_name
        if target.exists():
            raise FileExistsError(target)

        with Image.open(source) as image:
            image.convert("RGB").save(target, "JPEG", quality=92, optimize=True)

        source.rename(BACKUP_DIR / file_name)
        entry["file"] = target_name
        converted += 1
        print(f"{file_name} -> {target_name}")

    SOURCES_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"converted {converted} active webp images")


if __name__ == "__main__":
    main()
