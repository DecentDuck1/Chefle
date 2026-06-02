const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const USDA_CACHE_PATH = path.join(ROOT, "data", "nutrition", "usda-fndds-foods.json");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value) {
  const stop = new Set(["and", "with", "in", "a", "an", "the", "classic", "southern"]);
  return normalize(value).split(/\s+/).filter((token) => token && !stop.has(token));
}

function score(query, food) {
  const queryTokens = tokens(query);
  const foodName = normalize(food.description);
  const desc = normalize(`${food.description} ${food.category}`);
  const descTokens = new Set(tokens(desc));
  let value = 0;
  for (const token of queryTokens) {
    if (descTokens.has(token)) value += 12;
    else if (desc.includes(token)) value += 4;
    else value -= 5;
  }
  if (desc.includes(normalize(query))) value += 40;
  if (foodName.includes(normalize(query))) value += 30;
  return value;
}

function bestPortion(food) {
  return [...food.portions]
    .filter((portion) => Number(portion.gramWeight) > 0)
    .sort((a, b) => (a.sequenceNumber || 999) - (b.sequenceNumber || 999))[0];
}

const query = process.argv.slice(2).join(" ");
if (!query) {
  console.error("Usage: node scripts/search-usda-foods.js <query>");
  process.exit(1);
}

const foods = JSON.parse(fs.readFileSync(USDA_CACHE_PATH, "utf8"));
foods
  .map((food) => ({ food, score: score(query, food) }))
  .filter((candidate) => candidate.score > 0)
  .sort((a, b) => b.score - a.score || a.food.description.localeCompare(b.food.description))
  .slice(0, 30)
  .forEach(({ food, score: matchScore }) => {
    const portion = bestPortion(food);
    const calories = portion ? Math.round(food.kcalPer100g * portion.gramWeight / 100) : Math.round(food.kcalPer100g);
    console.log(`${matchScore}\t${food.fdcId}\t${food.description}\t${food.category}\t${food.kcalPer100g} kcal/100g\t${portion ? portion.description : "100 g"}\t${portion ? portion.gramWeight : 100}g\t${calories} kcal`);
  });
