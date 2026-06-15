const fs = require("fs");
const path = require("path");
const {
  extractConstLiteral,
  parseJsonConst,
  parseJsonLiteral,
  parseJsonObjectConst,
  quoteObjectKeys
} = require("./chefle-constants");

const ROOT = path.resolve(__dirname, "..");
const HTML_PATH = path.join(ROOT, "chefle.html");
const JSON_PATH = path.join(ROOT, "chefle-dishes-with-images.json");
const EXPECTED_DISH_COUNT = 273;
const TARGET_SCHEDULE_SAMPLE_DAYS = 365;

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function parseStringConst(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*"([^"]+)";`));
  if (!match) throw new Error(`Could not find string constant ${name}.`);
  return match[1];
}

function parseNumberConst(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+);`));
  if (!match) throw new Error(`Could not find number constant ${name}.`);
  return Number(match[1]);
}

function parseArrayConstWithBareKeys(source, name) {
  const range = extractConstLiteral(source, name, "[", "]");
  return parseJsonLiteral(quoteObjectKeys(range.literal), name);
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2019']/g, "'")
    .replace(/-/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function singularize(value) {
  if (value === "potatoes") return "potato";
  if (value === "tomatoes") return "tomato";
  if (value.endsWith("ies") && value.length > 4) return value.slice(0, -3) + "y";
  if (value.endsWith("oes") && value.length > 4) return value.slice(0, -2);
  if (value.endsWith("s") && !value.endsWith("ss") && value.length > 3) return value.slice(0, -1);
  return value;
}

function categoryLookup(groups) {
  return Object.fromEntries(Object.entries(groups).map(([field, fieldGroups]) => [
    field,
    Object.fromEntries(Object.entries(fieldGroups).flatMap(([canonical, aliases]) => (
      aliases.map((alias) => [normalize(alias), canonical])
    )))
  ]));
}

function category(field, value, lookup, labels) {
  const fieldLookup = lookup[field] || {};
  const normalized = normalize(value);
  const canonical = fieldLookup[normalized] || fieldLookup[singularize(normalized)] || normalized;
  return labels[canonical] || String(value);
}

function addDaysToDateKey(key, days) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

function range(values) {
  return [Math.min(...values), Math.max(...values)];
}

function main() {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const registry = parseJsonConst(html, "chefleGlobalMasterRegistry");
  const jsonRegistry = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
  const calories = parseJsonConst(html, "CALORIE_ESTIMATES");
  const textures = parseJsonConst(html, "TEXTURE_ESTIMATES");
  const prepCookMinutes = parseJsonConst(html, "PREP_COOK_MINUTE_ESTIMATES");
  const regionGroups = parseArrayConstWithBareKeys(html, "REGION_GROUPS");
  const categoryGroups = parseJsonObjectConst(html, "CATEGORY_GROUPS");
  const labels = parseJsonObjectConst(html, "CATEGORY_FILTER_LABELS");
  const dataVersion = parseStringConst(html, "DATA_VERSION");
  const startDate = parseStringConst(html, "GAME_NUMBER_START_DATE");
  const recentTargetLookbackDays = parseNumberConst(html, "RECENT_TARGET_LOOKBACK_DAYS");
  const lookup = categoryLookup(categoryGroups);
  const regionGroupByRegion = Object.fromEntries(regionGroups.flatMap((group) => (
    group.regions.map((region) => [region, group.label])
  )));
  const failures = [];

  assert(registry.length === EXPECTED_DISH_COUNT, `Expected ${EXPECTED_DISH_COUNT} dishes, got ${registry.length}.`, failures);
  assert(jsonRegistry.length === registry.length, `JSON registry length ${jsonRegistry.length} does not match HTML ${registry.length}.`, failures);
  assert(calories.length === registry.length, `Calories length ${calories.length} does not match registry ${registry.length}.`, failures);
  assert(textures.length === registry.length, `Textures length ${textures.length} does not match registry ${registry.length}.`, failures);
  assert(prepCookMinutes.length === registry.length, `Prep/cook length ${prepCookMinutes.length} does not match registry ${registry.length}.`, failures);
  assert(recentTargetLookbackDays >= 9, `Recent target lookback should be at least 9 days, got ${recentTargetLookbackDays}.`, failures);

  const names = new Set();
  const images = new Set();
  const regionCounts = {};
  const proteinCounts = {};
  const carbCounts = {};
  const textureCounts = {};
  const noPrimaryMeatPattern = /\b(beef|chicken|pork|bacon|ham|turkey|duck|lamb|veal|shrimp|salmon|tuna|cod|fish|crab|lobster|clam|oyster|mussel|sausage|kebab|steak|meat|gyro|shawarma)\b/i;

  const masterRegistry = registry.map((dish, index) => {
    const jsonDish = jsonRegistry[index];
    const nameKey = normalize(dish.name);
    const imageUrl = dish.verifiedImageUrl || dish.imageUrl;
    const calorieValue = Number(calories[index]);
    const textureValue = textures[index];
    const prepValue = Number(prepCookMinutes[index]);
    const proteinLabel = category("protein", dish.protein, lookup, labels);
    const carbLabel = category("carb", dish.carb, lookup, labels);
    const textureLabel = category("texture", textureValue, lookup, labels);
    const tempLabel = category("temp", dish.temp, lookup, labels);
    const regionGroup = regionGroupByRegion[dish.cuisineRegion];

    assert(jsonDish && jsonDish.name === dish.name, `JSON mismatch at ${index + 1}: ${dish.name}`, failures);
    assert(dish.name && !/[<>]/.test(dish.name), `${dish.name || `Dish ${index + 1}`}: invalid dish name`, failures);
    assert(!names.has(nameKey), `${dish.name}: duplicate dish name`, failures);
    names.add(nameKey);

    assert(regionGroup, `${dish.name}: unknown cuisine region ${dish.cuisineRegion}`, failures);
    assert(["Cold", "Room Temperature", "Hot"].includes(tempLabel), `${dish.name}: unknown temperature ${dish.temp}`, failures);
    assert(Boolean(proteinLabel), `${dish.name}: unknown protein ${dish.protein}`, failures);
    assert(Boolean(carbLabel), `${dish.name}: unknown carb ${dish.carb}`, failures);
    assert(Boolean(textureLabel), `${dish.name}: unknown texture ${textureValue}`, failures);
    assert(proteinLabel !== "No Primary" || !noPrimaryMeatPattern.test(dish.name), `${dish.name}: no-primary protein conflicts with dish name`, failures);

    assert(Number(dish.calories) === calorieValue, `${dish.name}: registry calories ${dish.calories} != array ${calorieValue}`, failures);
    assert(jsonDish && Number(jsonDish.calories) === calorieValue, `${dish.name}: JSON calories ${jsonDish && jsonDish.calories} != array ${calorieValue}`, failures);
    assert(Number.isInteger(calorieValue) && calorieValue >= 40 && calorieValue <= 900, `${dish.name}: calories look implausible (${calorieValue})`, failures);
    assert(Number.isInteger(prepValue) && prepValue >= 1 && prepValue <= 720, `${dish.name}: prep/cook minutes look implausible (${prepValue})`, failures);

    assert(/^food-photo-review-specific-only-v3\/[-a-z0-9._/]+\.(?:jpg|jpeg|png|webp)$/i.test(imageUrl), `${dish.name}: unsafe or nonlocal image path ${imageUrl}`, failures);
    assert(exists(imageUrl), `${dish.name}: missing image asset ${imageUrl}`, failures);
    assert(!images.has(imageUrl), `${dish.name}: duplicate image path ${imageUrl}`, failures);
    images.add(imageUrl);

    regionCounts[regionGroup] = (regionCounts[regionGroup] || 0) + 1;
    proteinCounts[proteinLabel] = (proteinCounts[proteinLabel] || 0) + 1;
    carbCounts[carbLabel] = (carbCounts[carbLabel] || 0) + 1;
    textureCounts[textureLabel] = (textureCounts[textureLabel] || 0) + 1;

    return {
      ...dish,
      calories: Math.max(1, Math.min(1200, Math.round(calorieValue))),
      texture: textureValue,
      prepCookMinutes: Math.max(1, Math.round(prepValue)),
      imageUrl
    };
  });

  for (const [label, count] of Object.entries(regionCounts)) {
    assert(count >= 30, `Region group ${label} has too few dishes for daily play (${count}).`, failures);
  }

  const targetCache = new Map();
  const regionGroupForDish = (dish) => regionGroupByRegion[dish.cuisineRegion] || dish.cuisineRegion;
  const clueSignatureGroups = new Map();
  masterRegistry.forEach((dish) => {
    const signature = [
      category("protein", dish.protein, lookup, labels),
      category("carb", dish.carb, lookup, labels),
      category("temp", dish.temp, lookup, labels),
      dish.calories,
      category("texture", dish.texture, lookup, labels),
      dish.prepCookMinutes
    ].join(" | ");
    const key = `${regionGroupForDish(dish)} || ${signature}`;
    if (!clueSignatureGroups.has(key)) clueSignatureGroups.set(key, []);
    clueSignatureGroups.get(key).push(dish.name);
  });
  for (const [signature, names] of clueSignatureGroups.entries()) {
    assert(names.length === 1, `Same-region clue collision: ${signature} => ${names.join(", ")}`, failures);
  }

  const targetRankForDate = (key, dish) => hashString(`target:${dataVersion}:${key}:${dish.name}`);
  const recentTargetNamesForDate = (key) => {
    const recent = new Set();
    let cursor = addDaysToDateKey(key, -1);
    for (let offset = 0; offset < recentTargetLookbackDays && cursor >= startDate; offset += 1) {
      const target = targetForDate(cursor);
      if (target) recent.add(target.name);
      cursor = addDaysToDateKey(cursor, -1);
    }
    return recent;
  };
  const targetForDate = (key) => {
    if (targetCache.has(key)) return targetCache.get(key);
    const recent = recentTargetNamesForDate(key);
    const ranked = masterRegistry
      .map((dish) => ({ dish, rank: targetRankForDate(key, dish) }))
      .sort((a, b) => a.rank - b.rank || a.dish.name.localeCompare(b.dish.name));
    const target = (ranked.find((item) => !recent.has(item.dish.name)) || ranked[0]).dish;
    targetCache.set(key, target);
    return target;
  };
  const dailyPoolForDate = (key) => {
    const target = targetForDate(key);
    const targetGroup = regionGroupForDish(target);
    return masterRegistry
      .filter((dish) => regionGroupForDish(dish) === targetGroup)
      .map((dish) => ({ dish, rank: hashString(`pool:${dataVersion}:${key}:${dish.name}`) }))
      .sort((a, b) => a.rank - b.rank || a.dish.name.localeCompare(b.dish.name))
      .map((item) => item.dish);
  };

  const rollingTargets = [];
  for (let offset = 0; offset < TARGET_SCHEDULE_SAMPLE_DAYS; offset += 1) {
    const key = addDaysToDateKey(startDate, offset);
    const target = targetForDate(key);
    const pool = dailyPoolForDate(key);
    assert(target, `${key}: missing target`, failures);
    assert(pool.some((dish) => dish.name === target.name), `${key}: target ${target && target.name} is not in its daily pool`, failures);
    const recentWindow = rollingTargets.slice(-recentTargetLookbackDays);
    assert(!recentWindow.includes(target.name), `${key}: target ${target.name} repeats within ${recentTargetLookbackDays + 1} days`, failures);
    rollingTargets.push(target.name);
  }

  if (failures.length) {
    throw new Error(failures.slice(0, 80).join("\n"));
  }

  console.log(JSON.stringify({
    dishes: masterRegistry.length,
    images: images.size,
    calorieRange: range(calories),
    prepCookRange: range(prepCookMinutes),
    noPrimaryDishes: proteinCounts["No Primary"] || 0,
    regionGroups: regionCounts,
    targetScheduleDaysChecked: TARGET_SCHEDULE_SAMPLE_DAYS,
    targetRepeatLookbackDays: recentTargetLookbackDays,
    status: "food data audit passed"
  }, null, 2));
}

main();
