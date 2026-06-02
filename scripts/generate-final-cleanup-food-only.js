const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "food-photo-review-specific-only-v3");
const MANIFEST_PATH = path.join(OUT_DIR, "sources.json");
const BACKUP_DIR = path.join(OUT_DIR, "rejected", "final-cleanup-old");

const PROMPTS = {
  26: ["French Fries", "golden French fries on a plain white plate"],
  28: ["Onion Rings", "crispy onion rings stacked on a plain white plate"],
  35: ["Fried Spring Rolls", "fried spring rolls on a plain white plate"],
  36: ["Steamed Dumplings", "steamed dumplings in a plain white bowl"],
  37: ["Fried Calamari", "fried calamari rings on a plain white plate"],
  52: ["Fried Pickles", "fried pickle spears on a plain white plate"],
  71: ["Beef Goulash", "beef goulash stew in a plain white bowl, no rice or noodles"],
  84: ["Beef Barley Soup", "beef barley soup in a plain white bowl"],
  115: ["Pan-Seared Pork Chops", "two pan-seared pork chops on a plain white plate"],
  116: ["Roast Pork Tenderloin", "sliced roast pork tenderloin on a plain white plate"],
  129: ["Braised Lamb Shank", "one braised lamb shank in a plain white bowl"],
  139: ["Chicken Piccata", "chicken piccata cutlets with lemon caper sauce on a plain white plate, no pasta"],
  154: ["Chicken Satay", "chicken satay skewers on a plain white plate, no sauce cup"],
  170: ["Fried Butterfly Shrimp", "fried butterfly shrimp on a plain white plate, no sauce or lemon"],
  174: ["Shrimp Fried Rice", "shrimp fried rice in a plain white bowl"],
  175: ["Baja Fish Tacos", "Baja fish tacos on a plain white plate, no limes or side dishes"],
  181: ["Cioppino", "cioppino seafood stew in a plain white bowl"],
  184: ["Pan-Seared Scallops", "three browned sea scallop medallions on a plain white plate, no shells"],
  191: ["Penne alla Vodka", "penne alla vodka pasta in a plain white bowl"],
  192: ["Macaroni and Cheese", "creamy macaroni and cheese in a plain white bowl"],
  196: ["Vegetable Fried Rice", "vegetable fried rice in a plain white bowl"],
  200: ["Chana Masala", "chana masala chickpea curry in a plain white bowl"],
  205: ["Spinach and Ricotta Ravioli", "spinach and ricotta ravioli on a plain white plate, no utensils"],
  210: ["Bibimbap", "bibimbap in one plain white bowl, no side dishes or chopsticks"],
  230: ["Poutine", "poutine fries with cheese curds and gravy in a plain white bowl"],
  232: ["Pork Belly Bao Buns", "pork belly bao buns on a plain white plate"],
  238: ["Pupusas", "pupusas on a plain white plate, no sauce cup"],
  249: ["Crème Brûlée", "one crème brûlée ramekin with caramelized sugar top"],
  256: ["Lemon Meringue Tart", "one slice of lemon meringue tart with tall toasted meringue on a plain white plate"],
  268: ["Peach Cobbler", "peach cobbler with visible peach filling and golden crumb topping in a plain white baking dish"]
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
    "The image must contain only that exact finished food, centered and fully visible.",
    "Plain pure white background.",
    "No table, no counter, no restaurant scene, no other foods, no side dishes, no sauce cups, no drinks, no utensils, no hands, no people, no packaging, no labels, no watermark, no text.",
    "Use only the simplest plain white plate, bowl, ramekin, or baking dish if needed to hold the food."
  ].join(" ");
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "ChefleFinalCleanupFoodOnly/1.0",
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
    seed: String(91000 + index)
  }).toString();
  const response = await fetchWithTimeout(url, 120_000);
  if (!response.ok) throw new Error(`${dishName}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const file = `${String(index).padStart(3, "0")}-${slugify(dishName)}.jpg`;
  const target = path.join(OUT_DIR, file);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (fs.existsSync(target)) {
    const backup = path.join(BACKUP_DIR, file);
    if (!fs.existsSync(backup)) fs.renameSync(target, backup);
  }
  fs.writeFileSync(target, buffer);
  return { file, imageUrl: url.toString(), query: promptFor(subject) };
}

async function generateWithRetries(index, dishName, subject) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await generate(index, dishName, subject);
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        console.warn(`${index}: ${dishName} failed attempt ${attempt}, retrying`);
        await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
      }
    }
  }
  throw lastError;
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  for (const [indexText, [dishName, subject]] of Object.entries(PROMPTS)) {
    const index = Number(indexText);
    const entry = manifest.find((item) => item.index === index);
    if (
      entry &&
      entry.reason === "generated final strict cleanup replacement" &&
      entry.file &&
      fs.existsSync(path.join(OUT_DIR, entry.file))
    ) {
      console.log(`${index}: ${dishName} already generated, skipping`);
      continue;
    }
    const result = await generateWithRetries(index, dishName, subject);
    if (entry) {
      Object.assign(entry, {
        dishName,
        file: result.file,
        status: "downloaded",
        query: result.query,
        title: `${dishName} generated isolated food photo`,
        pageUrl: "",
        imageUrl: result.imageUrl,
        reason: "generated final strict cleanup replacement"
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
