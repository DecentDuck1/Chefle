const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_MANIFEST = path.join(ROOT, "food-photo-review-specific-only-v3", "sources.json");
const OUT_DIR = path.join(ROOT, "food-photo-review-specific-only-v3", "wikimedia-hardcase-candidates");
const USER_AGENT = "ChefleHardcaseReview/1.0";

const TERMS = {
  49: "macaroni salad",
  80: "Italian wedding soup",
  118: "cottage pie",
  128: "Salisbury steak",
  153: "duck a l'orange",
  166: "paella valenciana",
  173: "linguine with clams",
  209: "Singapore noodles",
  214: "vegetarian chili",
  233: "chimichanga"
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

function apiUrl(params) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({ format: "json", origin: "*", ...params }).toString();
  return url;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchImage(url) {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function tokenVariants(token) {
  const variants = new Set([token]);
  if (token.endsWith("s") && token.length > 4) variants.add(token.slice(0, -1));
  return Array.from(variants);
}

function score(page, term) {
  const title = String(page.title || "").toLowerCase().replace(/file:/, "").replace(/[_-]/g, " ");
  const tokens = term.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 2);
  let value = 0;
  for (const token of tokens) {
    if (tokenVariants(token).some((variant) => title.includes(variant))) value += 5;
  }
  if (/\b(food|dish|plate|bowl|soup|pie|steak|paella|noodles|chili)\b/.test(title)) value += 2;
  if (/\b(raw|ingredient|logo|map|restaurant|menu|person|people|poster|illustration|drawing)\b/.test(title)) value -= 10;
  return value;
}

async function candidatesFor(term) {
  const url = apiUrl({
    action: "query",
    generator: "search",
    gsrnamespace: "6",
    gsrlimit: "10",
    gsrsearch: `${term} food dish`,
    prop: "imageinfo|info",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: "900",
    inprop: "url"
  });
  const json = await fetchJson(url);
  return Object.values(json.query?.pages || {})
    .filter((page) => /^image\/(jpeg|png|webp)$/i.test(page.imageinfo?.[0]?.mime || ""))
    .map((page) => ({
      title: page.title,
      pageUrl: page.fullurl,
      imageUrl: page.imageinfo[0].thumburl || page.imageinfo[0].url,
      score: score(page, term)
    }))
    .sort((a, b) => b.score - a.score);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(SOURCE_MANIFEST, "utf8"));
  const outManifest = [];
  for (const [indexText, term] of Object.entries(TERMS)) {
    const index = Number(indexText);
    const dish = manifest.find((entry) => entry.index === index)?.dishName || term;
    const candidates = await candidatesFor(term);
    let saved = 0;
    for (const candidate of candidates.slice(0, 3)) {
      try {
        const buffer = await fetchImage(candidate.imageUrl);
        const suffix = candidate.imageUrl.includes(".png") ? ".png" : ".jpg";
        const file = `${String(index).padStart(3, "0")}-${slugify(dish)}-candidate-${saved + 1}${suffix}`;
        fs.writeFileSync(path.join(OUT_DIR, file), buffer);
        outManifest.push({ index, dishName: dish, file, ...candidate });
        saved += 1;
      } catch {}
    }
    console.log(`${index}: ${dish} -> ${saved}`);
  }
  fs.writeFileSync(path.join(OUT_DIR, "sources.json"), `${JSON.stringify(outManifest, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
