const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CANDIDATE_DIR = path.join(ROOT, "food-photo-review-specific-only-v3", "final-candidates");

const PROMPTS = [
  "three pan seared sea scallop meat medallions, round white cylindrical scallop discs with golden brown tops, no shells",
  "four diver scallops, cooked scallop meat only, round golden seared cylinders on a plain white plate, absolutely no seashells",
  "pan seared scallop meat pucks only, small round white seafood medallions with caramelized crust, no scallop shells",
  "three cooked sea scallops without shells, round thick white medallions with browned top and bottom, isolated on white plate",
  "restaurant studio photo of seared scallop meat only, circular golden scallop medallions, no shells, no garnish",
  "plain white plate holding only three golden seared scallop cylinders, shell removed, white scallop meat visible"
];

function fullPrompt(subject) {
  return [
    `Photorealistic studio product photo of ${subject}.`,
    "Only that exact finished food is visible, centered and fully visible.",
    "Plain pure white background.",
    "No shells, no shellfish shells, no side dishes, no sauces, no drinks, no utensils, no hands, no people, no packaging, no labels, no watermark, no text."
  ].join(" ");
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "ChefleScallopCandidates/1.0",
        "Accept": "image/*"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function generate(prompt, variant) {
  const url = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt(prompt))}`);
  url.search = new URLSearchParams({
    width: "900",
    height: "900",
    model: "flux",
    nologo: "true",
    private: "true",
    seed: String(184000 + variant)
  }).toString();
  const response = await fetchWithTimeout(url, 120_000);
  if (!response.ok) throw new Error(`scallop candidate ${variant}: HTTP ${response.status}`);
  const file = `184-pan-seared-scallops-candidate-${variant}.jpg`;
  fs.writeFileSync(path.join(CANDIDATE_DIR, file), Buffer.from(await response.arrayBuffer()));
  return file;
}

async function main() {
  fs.mkdirSync(CANDIDATE_DIR, { recursive: true });
  for (let i = 0; i < PROMPTS.length; i += 1) {
    const variant = i + 4;
    const file = `184-pan-seared-scallops-candidate-${variant}.jpg`;
    if (fs.existsSync(path.join(CANDIDATE_DIR, file))) {
      console.log(`${file} already exists`);
      continue;
    }
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        console.log(await generate(PROMPTS[i], variant));
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
      }
    }
    if (lastError) throw lastError;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
