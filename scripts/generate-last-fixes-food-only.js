const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "food-photo-review-specific-only-v3");
const MANIFEST_PATH = path.join(OUT_DIR, "sources.json");
const BACKUP_DIR = path.join(OUT_DIR, "rejected", "last-fixes-old");

const PROMPTS = {
  35: ["Fried Spring Rolls", "four golden brown fried spring rolls, cylindrical crispy wrappers, on a plain white plate"],
  36: ["Steamed Dumplings", "six steamed Chinese dumplings with pleated wrappers on a plain white plate"],
  116: ["Roast Pork Tenderloin", "sliced cooked roast pork tenderloin medallions, browned outside and pale cooked inside, on a plain white plate"]
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

function promptFor(subject) {
  return [
    `Photorealistic studio product photo of ${subject}.`,
    "Only that exact food is visible, centered and fully visible.",
    "Plain pure white background.",
    "No table, no counter, no restaurant scene, no other foods, no sauces, no side dishes, no drinks, no utensils, no hands, no people, no packaging, no labels, no watermark, no text."
  ].join(" ");
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "ChefleLastFixesFoodOnly/1.0",
        "Accept": "image/*"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function generate(index, dishName, subject) {
  const url = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(promptFor(subject))}`);
  url.search = new URLSearchParams({
    width: "900",
    height: "900",
    model: "flux",
    nologo: "true",
    private: "true",
    seed: String(99000 + index)
  }).toString();
  const response = await fetchWithTimeout(url, 120_000);
  if (!response.ok) throw new Error(`${dishName}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const file = `${String(index).padStart(3, "0")}-${slugify(dishName)}.jpg`;
  const target = path.join(OUT_DIR, file);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (fs.existsSync(target)) {
    const backup = path.join(BACKUP_DIR, `${Date.now()}-${file}`);
    fs.renameSync(target, backup);
  }
  fs.writeFileSync(target, buffer);
  return { file, imageUrl: url.toString(), query: promptFor(subject) };
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  for (const [indexText, [dishName, subject]] of Object.entries(PROMPTS)) {
    const index = Number(indexText);
    const result = await generate(index, dishName, subject);
    const entry = manifest.find((item) => item.index === index);
    if (entry) {
      Object.assign(entry, {
        dishName,
        file: result.file,
        status: "downloaded",
        query: result.query,
        title: `${dishName} generated isolated food photo`,
        pageUrl: "",
        imageUrl: result.imageUrl,
        reason: "generated final last-fix replacement"
      });
    }
    fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`${index}: ${dishName} -> ${result.file}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
