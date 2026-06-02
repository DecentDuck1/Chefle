const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "food-photo-review-specific-only-v3");
const CANDIDATE_DIR = path.join(OUT_DIR, "final-candidates");

const TARGETS = {
  124: {
    dishName: "Wiener Schnitzel",
    prompts: [
      "one thin oval golden breaded veal schnitzel cutlet only on a plain white plate",
      "single crispy breaded Wiener schnitzel cutlet, no garnish, no fries, no lemon, on plain white plate",
      "one flat golden fried veal cutlet for Wiener schnitzel, isolated on a plain white plate"
    ]
  },
  125: {
    dishName: "Pork Schnitzel",
    prompts: [
      "one thin golden breaded pork schnitzel cutlet only on a plain white plate",
      "single crispy fried pork cutlet for pork schnitzel, no garnish, no lemon, no potatoes",
      "one flat breaded pork schnitzel cutlet, isolated on plain white background on a white plate"
    ]
  },
  129: {
    dishName: "Braised Lamb Shank",
    prompts: [
      "one whole bone-in braised lamb shank with exposed shank bone on a plain white plate",
      "single browned braised lamb shank, long bone visible, no vegetables, no garnish, plain white plate",
      "one cooked lamb shank with bone and glossy braising sauce, isolated on plain white background"
    ]
  },
  184: {
    dishName: "Pan-Seared Scallops",
    prompts: [
      "three round sea scallop meat medallions with golden seared tops on a plain white plate, no shells",
      "four browned pan-seared scallop medallions only, cylindrical white scallop meat, no shells",
      "three golden crusted sea scallops without shells on a plain white plate"
    ]
  },
  191: {
    dishName: "Penne alla Vodka",
    prompts: [
      "penne pasta coated in orange pink vodka sauce in a plain white bowl, no fork",
      "penne alla vodka pasta only, creamy tomato vodka sauce, plain white plate, no utensils",
      "bowl of penne alla vodka with pink tomato cream sauce, no fork, no garnish, white background"
    ]
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

function fullPrompt(subject) {
  return [
    `Photorealistic studio product photo of ${subject}.`,
    "Only that exact finished food is visible, centered and fully visible.",
    "Plain pure white background.",
    "No other foods, no side dishes, no sauces in cups, no drinks, no utensils, no hands, no people, no packaging, no labels, no watermark, no text."
  ].join(" ");
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "ChefleTargetedCandidates/1.0",
        "Accept": "image/*"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function generateCandidate(index, dishName, prompt, variant) {
  const url = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt(prompt))}`);
  url.search = new URLSearchParams({
    width: "900",
    height: "900",
    model: "flux",
    nologo: "true",
    private: "true",
    seed: String(120000 + index * 10 + variant)
  }).toString();
  const response = await fetchWithTimeout(url, 120_000);
  if (!response.ok) throw new Error(`${dishName} variant ${variant}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const file = `${String(index).padStart(3, "0")}-${slugify(dishName)}-candidate-${variant}.jpg`;
  fs.writeFileSync(path.join(CANDIDATE_DIR, file), buffer);
  return file;
}

async function generateWithRetries(index, dishName, prompt, variant) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await generateCandidate(index, dishName, prompt, variant);
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        console.warn(`${index}: ${dishName} candidate ${variant} failed attempt ${attempt}, retrying`);
        await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
      }
    }
  }
  throw lastError;
}

async function main() {
  fs.mkdirSync(CANDIDATE_DIR, { recursive: true });
  for (const [indexText, target] of Object.entries(TARGETS)) {
    const index = Number(indexText);
    for (let i = 0; i < target.prompts.length; i += 1) {
      const variant = i + 1;
      const file = `${String(index).padStart(3, "0")}-${slugify(target.dishName)}-candidate-${variant}.jpg`;
      if (fs.existsSync(path.join(CANDIDATE_DIR, file))) {
        console.log(`${index}: ${target.dishName} candidate ${variant} already exists`);
        continue;
      }
      const generated = await generateWithRetries(index, target.dishName, target.prompts[i], variant);
      console.log(`${index}: ${target.dishName} -> ${generated}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
