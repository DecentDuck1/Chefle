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
const PUBLISH_ROOT = path.join(ROOT, "publish");
const INDEX_PATH = path.join(PUBLISH_ROOT, "index.html");
const EXPECTED_DISH_COUNT = 273;
const TARGET_SCHEDULE_SAMPLE_DAYS = 365;
const PAGES = ["index.html", "privacy.html", "terms.html", "cookies.html", "accessibility.html", "disclaimer.html"];
const ADSENSE_CLIENT = "ca-pub-4681241502820822";
const ADSENSE_SCRIPT_SRC = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;

function read(relativePath) {
  return fs.readFileSync(path.join(PUBLISH_ROOT, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(PUBLISH_ROOT, relativePath));
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

function isExternalReference(value) {
  return /^(?:https?:|mailto:|tel:|#|data:)/i.test(value) || value.startsWith("REPLACE_WITH_");
}

function localTarget(pagePath, value) {
  const clean = value.split("#")[0].split("?")[0];
  if (!clean || isExternalReference(clean)) return null;
  return path.normalize(path.join(path.dirname(pagePath), clean)).replace(/\\/g, "/");
}

function linkedValues(html) {
  return Array.from(html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi), (match) => match[1]);
}

function duplicateIds(html) {
  const ids = new Map();
  for (const match of html.matchAll(/\bid=["']([^"']+)["']/gi)) {
    ids.set(match[1], (ids.get(match[1]) || 0) + 1);
  }
  return Array.from(ids.entries()).filter(([, count]) => count > 1).map(([id]) => id);
}

function auditPages(failures) {
  for (const page of PAGES) {
    assert(exists(page), `Missing publish page: ${page}`, failures);
    if (!exists(page)) continue;

    const html = read(page);
    assert(/<title>[^<]+<\/title>/i.test(html), `${page}: missing title`, failures);
    assert(/<meta\s+name=["']description["']/i.test(html), `${page}: missing meta description`, failures);
    assert(/<meta\s+name=["']theme-color["']/i.test(html), `${page}: missing theme color`, failures);
    assert(/<link\s+rel=["']icon["'][^>]+href=["']chefle-logo\.png["']/i.test(html), `${page}: missing favicon link`, failures);
    assert(!/\bhref=["']javascript:/i.test(html), `${page}: javascript: href is not launch-safe`, failures);

    const ids = duplicateIds(html);
    assert(!ids.length, `${page}: duplicate ids: ${ids.join(", ")}`, failures);

    for (const value of linkedValues(html)) {
      const target = localTarget(page, value);
      if (target) assert(exists(target), `${page}: broken local reference ${value} -> ${target}`, failures);
    }

    for (const anchor of html.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/gi)) {
      assert(/\brel=["'][^"']*\bnoopener\b/i.test(anchor[0]), `${page}: target=_blank link missing rel=noopener`, failures);
    }
  }
}

function resolvePublishImagePath(imageUrl) {
  const value = String(imageUrl || "").trim();
  if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(value) || value.includes("\\")) {
    throw new Error(`Unsafe image URL: ${imageUrl}`);
  }
  const filePath = path.resolve(PUBLISH_ROOT, value);
  if (!filePath.startsWith(PUBLISH_ROOT + path.sep)) throw new Error(`Image URL escapes publish root: ${imageUrl}`);
  return filePath;
}

function auditDishData(html, failures) {
  const registry = parseJsonConst(html, "chefleGlobalMasterRegistry");
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

  assert(registry.length === EXPECTED_DISH_COUNT, `Expected ${EXPECTED_DISH_COUNT} dishes, got ${registry.length}.`, failures);
  assert(calories.length === registry.length, `Calories length ${calories.length} does not match registry ${registry.length}.`, failures);
  assert(textures.length === registry.length, `Textures length ${textures.length} does not match registry ${registry.length}.`, failures);
  assert(prepCookMinutes.length === registry.length, `Prep/cook length ${prepCookMinutes.length} does not match registry ${registry.length}.`, failures);
  assert(recentTargetLookbackDays >= 9, `Recent target lookback should be at least 9 days, got ${recentTargetLookbackDays}.`, failures);

  const names = new Set();
  const images = new Set();
  const regionCounts = {};
  const noPrimaryMeatPattern = /\b(beef|chicken|pork|bacon|ham|turkey|duck|lamb|veal|shrimp|salmon|tuna|cod|fish|crab|lobster|clam|oyster|mussel|sausage|kebab|steak|meat|gyro|shawarma)\b/i;

  const masterRegistry = registry.map((dish, index) => {
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
    assert(Number.isInteger(calorieValue) && calorieValue >= 40 && calorieValue <= 900, `${dish.name}: calories look implausible (${calorieValue})`, failures);
    assert(Number.isInteger(prepValue) && prepValue >= 1 && prepValue <= 720, `${dish.name}: prep/cook minutes look implausible (${prepValue})`, failures);

    assert(/^food-photo-review-specific-only-v3\/[-a-z0-9._/]+\.(?:jpg|jpeg|png|webp)$/i.test(imageUrl), `${dish.name}: unsafe or nonlocal image path ${imageUrl}`, failures);
    if (imageUrl) assert(fs.existsSync(resolvePublishImagePath(imageUrl)), `${dish.name}: missing publish image asset ${imageUrl}`, failures);
    assert(!images.has(imageUrl), `${dish.name}: duplicate image path ${imageUrl}`, failures);
    images.add(imageUrl);
    regionCounts[regionGroup] = (regionCounts[regionGroup] || 0) + 1;

    return { ...dish, imageUrl };
  });

  for (const [label, count] of Object.entries(regionCounts)) {
    assert(count >= 30, `Region group ${label} has too few dishes for daily play (${count}).`, failures);
  }

  const targetCache = new Map();
  const regionGroupForDish = (dish) => regionGroupByRegion[dish.cuisineRegion] || dish.cuisineRegion;
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

  return {
    dishes: registry.length,
    images: images.size,
    targetScheduleDaysChecked: TARGET_SCHEDULE_SAMPLE_DAYS,
    targetRepeatLookbackDays: recentTargetLookbackDays
  };
}

function main() {
  const failures = [];
  assert(fs.existsSync(INDEX_PATH), "publish/index.html is missing.", failures);
  assert(exists("_headers"), "publish/_headers is missing.", failures);
  assert(exists("CNAME"), "publish/CNAME is missing.", failures);
  assert(exists(".nojekyll"), "publish/.nojekyll is missing.", failures);
  if (exists("_headers")) assert(read("_headers").includes("Content-Security-Policy:"), "publish/_headers missing CSP.", failures);
  if (exists("CNAME")) assert(read("CNAME").trim() === "chefle.org", "publish/CNAME should point to chefle.org.", failures);

  auditPages(failures);
  for (const page of PAGES) {
    if (exists(page)) assert(read(page).includes(ADSENSE_SCRIPT_SRC), `${page}: missing AdSense verification script.`, failures);
  }

  let dishSummary = null;
  if (fs.existsSync(INDEX_PATH)) {
    const html = fs.readFileSync(INDEX_PATH, "utf8");
    assert(!/No Primary Protein/.test(html), "Old protein label still appears in publish/index.html.", failures);
    assert(!/(resetFoodButton|devResetStatus|dev-block|Restart Today)/.test(html), "Dev food reset control still appears in publish/index.html.", failures);
    assert(!/ca-pub-0000000000000000/.test(html), "publish/index.html still contains placeholder AdSense publisher ID.", failures);
    dishSummary = auditDishData(html, failures);
  }

  if (failures.length) {
    throw new Error(failures.join("\n"));
  }

  console.log(JSON.stringify({
    ...dishSummary,
    pages: PAGES.length,
    status: "publish bundle audit passed"
  }, null, 2));
}

main();
