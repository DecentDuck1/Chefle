const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "food-photo-review-generated-test");
const DISHES = [
  "Scrambled Eggs",
  "Eggs Benedict",
  "Pancakes",
  "Oatmeal",
  "Chicken Tortilla Soup",
  "Beef Goulash"
];

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function promptFor(dish) {
  return [
    `Photorealistic studio product photo of ${dish} only.`,
    `The image must contain only the finished dish ${dish}, centered and fully visible.`,
    "Plain pure white background.",
    "No other foods, no side dishes, no drinks, no utensils, no hands, no people, no table setting, no packaging, no labels, no watermark, no text.",
    "Use a simple plain white plate or bowl only if needed to hold the dish."
  ].join(" ");
}

async function download(dish, index) {
  const seed = 9000 + index;
  const url = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(promptFor(dish))}`);
  url.search = new URLSearchParams({
    width: "900",
    height: "900",
    model: "flux",
    nologo: "true",
    private: "true",
    seed: String(seed)
  }).toString();
  const response = await fetch(url, {
    headers: {
      "User-Agent": "ChefleGeneratedFoodReview/1.0",
      "Accept": "image/*"
    }
  });
  if (!response.ok) throw new Error(`${dish}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const file = `${String(index + 1).padStart(3, "0")}-${slugify(dish)}.jpg`;
  fs.writeFileSync(path.join(OUT, file), buffer);
  console.log(file);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (let index = 0; index < DISHES.length; index += 1) {
    await download(DISHES[index], index);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
