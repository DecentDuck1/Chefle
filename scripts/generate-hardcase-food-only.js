const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "food-photo-review-specific-only-v3");
const MANIFEST_PATH = path.join(OUT_DIR, "sources.json");

const PROMPTS = {
  49: {
    dishName: "Macaroni Salad",
    subject: "macaroni salad in a plain white bowl, elbow macaroni coated in creamy dressing with tiny celery and carrot pieces"
  },
  80: {
    dishName: "Italian Wedding Soup",
    subject: "Italian wedding soup in a plain white bowl, clear broth with small meatballs, tiny pasta, and leafy greens"
  },
  118: {
    dishName: "Cottage Pie",
    subject: "cottage pie in a simple white oval baking dish, browned mashed potato topping with a small visible beef filling edge"
  },
  128: {
    dishName: "Salisbury Steak",
    subject: "one cooked Salisbury steak patty with brown gravy on a plain white plate"
  },
  153: {
    dishName: "Duck à l'Orange",
    subject: "sliced roast duck breast with glossy orange sauce on a plain white plate"
  },
  166: {
    dishName: "Paella Valenciana",
    subject: "paella valenciana rice in a shallow plain paella pan, saffron rice with chicken and green beans"
  },
  173: {
    dishName: "Linguine with Clams",
    subject: "linguine with clams on a plain white plate, pasta strands and opened clam shells"
  },
  209: {
    dishName: "Singapore Noodles",
    subject: "Singapore noodles in a plain white bowl, yellow curry rice vermicelli with small vegetables"
  },
  214: {
    dishName: "Vegetarian Chili",
    subject: "vegetarian chili in a plain white bowl, beans, tomatoes, corn, and peppers in red chili sauce"
  },
  233: {
    dishName: "Beef Chimichanga",
    subject: "one fried beef chimichanga on a plain white plate, golden crisp tortilla, slightly open end showing beef filling"
  }
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
    "The image must contain only the finished dish described above.",
    "Plain pure white background, centered, fully visible, high detail.",
    "No other foods, no side dishes, no drinks, no utensils, no hands, no people, no table setting, no packaging, no labels, no watermark, no text.",
    "Use only the simplest plain white plate, bowl, or pan if needed to hold the dish."
  ].join(" ");
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "ChefleHardcaseGeneratedFoodReview/1.0",
        "Accept": "image/*"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function generate(index, entry) {
  const file = `${String(index).padStart(3, "0")}-${slugify(entry.dishName)}.jpg`;
  if (fs.existsSync(path.join(OUT_DIR, file))) {
    return { file, imageUrl: "" };
  }
  const url = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(promptFor(entry.subject))}`);
  url.search = new URLSearchParams({
    width: "900",
    height: "900",
    model: "flux",
    nologo: "true",
    private: "true",
    seed: String(73000 + index)
  }).toString();
  const response = await fetchWithTimeout(url, 120_000);
  if (!response.ok) throw new Error(`${entry.dishName}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(OUT_DIR, file), buffer);
  return { file, imageUrl: url.toString() };
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  for (const [indexText, entry] of Object.entries(PROMPTS)) {
    const index = Number(indexText);
    const result = await generate(index, entry);
    const manifestEntry = manifest.find((item) => item.index === index);
    if (manifestEntry) {
      Object.assign(manifestEntry, {
        dishName: entry.dishName,
        file: result.file,
        status: "downloaded",
        query: promptFor(entry.subject),
        title: `${entry.dishName} generated isolated food photo`,
        pageUrl: "",
        imageUrl: result.imageUrl,
        reason: "generated fallback for hard-to-source isolated food-only photo"
      });
    }
    console.log(`${index}: ${entry.dishName} -> ${result.file}`);
    fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
