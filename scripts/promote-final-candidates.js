const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "food-photo-review-specific-only-v3");
const CANDIDATE_DIR = path.join(OUT_DIR, "final-candidates");
const BACKUP_DIR = path.join(OUT_DIR, "rejected", "promoted-candidate-old");
const MANIFEST_PATH = path.join(OUT_DIR, "sources.json");

const selections = {
  124: "124-wiener-schnitzel-candidate-2.jpg",
  125: "125-pork-schnitzel-candidate-1.jpg",
  129: "129-braised-lamb-shank-candidate-3.jpg",
  184: "184-pan-seared-scallops-candidate-6.jpg",
  191: "191-penne-alla-vodka-candidate-1.jpg"
};

const dishNames = {
  124: "Wiener Schnitzel",
  125: "Pork Schnitzel",
  129: "Braised Lamb Shank",
  184: "Pan-Seared Scallops",
  191: "Penne alla Vodka"
};

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

  for (const [indexText, candidateFile] of Object.entries(selections)) {
    const index = Number(indexText);
    const dishName = dishNames[indexText];
    const targetFile = `${String(index).padStart(3, "0")}-${slugify(dishName)}.jpg`;
    const source = path.join(CANDIDATE_DIR, candidateFile);
    const target = path.join(OUT_DIR, targetFile);

    if (!fs.existsSync(source)) throw new Error(`Missing candidate: ${source}`);
    if (fs.existsSync(target)) {
      fs.renameSync(target, path.join(BACKUP_DIR, `${Date.now()}-${targetFile}`));
    }

    fs.copyFileSync(source, target);

    const entry = manifest.find((item) => item.index === index);
    if (entry) {
      Object.assign(entry, {
        dishName,
        file: targetFile,
        status: "downloaded",
        query: "promoted manually selected strict isolated candidate",
        title: `${dishName} selected isolated food photo`,
        pageUrl: "",
        imageUrl: "",
        reason: "promoted final strict candidate"
      });
    }

    console.log(`${index}: ${targetFile} <= ${candidateFile}`);
  }

  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

main();
