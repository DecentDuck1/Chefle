const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "food-photo-review-specific-only-v3");
const MANIFEST_PATH = path.join(OUT_DIR, "sources.json");

const PROMPTS = {
  53: ["Cheese Fondue", "melted cheese fondue in a simple black fondue pot, cheese only"],
  131: ["Mongolian Beef", "Mongolian beef strips with scallions in a plain white bowl"],
  146: ["Sweet and Sour Chicken", "sweet and sour chicken pieces coated in glossy red orange sauce on a plain white plate"],
  171: ["Baked Cod", "one baked cod fillet with light herb seasoning on a plain white plate"],
  172: ["Lobster Thermidor", "lobster thermidor in a lobster shell with creamy baked cheese topping"],
  180: ["Seared Ahi Tuna", "sliced seared ahi tuna steak with pink center on a plain white plate"],
  183: ["Mussels in White Wine Sauce", "mussels in white wine sauce in a plain white bowl"],
  184: ["Pan-Seared Scallops", "three pan seared scallops on a plain white plate"],
  187: ["Salmon Teriyaki", "one grilled salmon fillet glazed with teriyaki sauce on a plain white plate"],
  198: ["Eggplant Parmigiana", "eggplant parmigiana casserole portion with tomato sauce and melted cheese"],
  208: ["Vegetable Chow Mein", "vegetable chow mein noodles in a plain white bowl"],
  228: ["Beef Taquitos", "three beef taquitos on a plain white plate"],
  229: ["Potato and Pea Samosas", "three potato and pea samosas on a plain white plate"],
  250: ["Chocolate Lava Cake", "one chocolate lava cake with molten chocolate center on a plain white plate"],
  256: ["Lemon Meringue Tart", "one lemon meringue tart slice on a plain white plate"],
  258: ["Chocolate Mousse", "chocolate mousse in one plain clear dessert cup"],
  268: ["Peach Cobbler", "peach cobbler in a simple white baking dish"],
  271: ["Waffles with Ice Cream", "one waffle with one scoop of vanilla ice cream on a plain white plate"]
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
    "The image must contain only that finished dish, centered and fully visible.",
    "Plain pure white background, no table, no counter, no restaurant scene.",
    "No other foods, no side dishes, no drinks, no utensils, no hands, no people, no packaging, no labels, no watermark, no text.",
    "Use only the simplest plain white plate, bowl, baking dish, or pot if needed to hold the dish."
  ].join(" ");
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "ChefleVisualRejectGeneratedFoodReview/1.0",
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
    seed: String(81000 + index)
  }).toString();
  const response = await fetchWithTimeout(url, 120_000);
  if (!response.ok) throw new Error(`${dishName}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const file = `${String(index).padStart(3, "0")}-${slugify(dishName)}.jpg`;
  fs.writeFileSync(path.join(OUT_DIR, file), buffer);
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
      entry.reason === "generated replacement for visual reject" &&
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
        reason: "generated replacement for visual reject"
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
