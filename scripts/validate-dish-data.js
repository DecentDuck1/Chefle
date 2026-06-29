const fs = require("fs");
const path = require("path");
const { parseJsonConst, parseJsonObjectConst } = require("./chefle-constants");

const ROOT = path.resolve(__dirname, "..");
const HTML_PATH = path.join(ROOT, "chefle.html");
const JSON_PATH = path.join(ROOT, "chefle-dishes-with-images.json");

function parseConst(source, name, open, close) {
  return open === "{" && close === "}"
    ? parseJsonObjectConst(source, name)
    : parseJsonConst(source, name, open, close);
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

function main() {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const registry = parseConst(html, "chefleGlobalMasterRegistry", "[", "]");
  const calories = parseConst(html, "CALORIE_ESTIMATES", "[", "]");
  const hasJsonRegistry = fs.existsSync(JSON_PATH);
  const jsonRegistry = hasJsonRegistry ? JSON.parse(fs.readFileSync(JSON_PATH, "utf8")) : [];
  const groups = parseConst(html, "CATEGORY_GROUPS", "{", "}");
  const labels = parseConst(html, "CATEGORY_FILTER_LABELS", "{", "}");
  const lookup = Object.fromEntries(Object.entries(groups).map(([field, fieldGroups]) => [
    field,
    Object.fromEntries(Object.entries(fieldGroups).flatMap(([canonical, aliases]) => aliases.map((alias) => [normalize(alias), canonical])))
  ]));

  const category = (field, value) => {
    let normalized = normalize(value);
    const fieldLookup = lookup[field] || {};
    if (fieldLookup[normalized]) return labels[fieldLookup[normalized]] || fieldLookup[normalized];
    normalized = singularize(normalized);
    return labels[fieldLookup[normalized] || normalized] || String(value);
  };

  const badCarbValues = new Set(["Cheese", "Dairy", "Butter", "Egg", "Pork", "Skewer", "Meringue"]);
  const failures = [];
  if (registry.length !== 273) failures.push(`Expected 273 HTML dishes, got ${registry.length}.`);
  if (hasJsonRegistry && jsonRegistry.length !== registry.length) failures.push(`JSON registry length ${jsonRegistry.length} does not match HTML ${registry.length}.`);
  if (calories.length !== registry.length) failures.push(`Calories length ${calories.length} does not match registry ${registry.length}.`);

  registry.forEach((dish, index) => {
    const jsonDish = jsonRegistry[index];
    if (hasJsonRegistry && (!jsonDish || jsonDish.name !== dish.name)) failures.push(`JSON mismatch at ${index + 1}: ${dish.name}`);
    if (dish.protein === "Vegetarian") failures.push(`${dish.name}: protein still uses Vegetarian.`);
    if (badCarbValues.has(dish.carb)) failures.push(`${dish.name}: carb uses non-base value ${dish.carb}.`);
    if (Number(dish.calories) !== Number(calories[index])) failures.push(`${dish.name}: registry calories ${dish.calories} != array ${calories[index]}.`);
    if (hasJsonRegistry && jsonDish && Number(jsonDish.calories) !== Number(calories[index])) failures.push(`${dish.name}: JSON calories ${jsonDish.calories} != array ${calories[index]}.`);
    if (!Number.isFinite(Number(calories[index])) || Number(calories[index]) < 1) failures.push(`${dish.name}: invalid calories ${calories[index]}.`);
  });

  if (failures.length) {
    throw new Error(failures.slice(0, 50).join("\n"));
  }

  const counts = {};
  for (const field of ["protein", "carb", "texture"]) {
    counts[field] = {};
    for (const dish of registry) {
      const value = field === "texture" ? "from metadata" : category(field, dish[field]);
      counts[field][value] = (counts[field][value] || 0) + 1;
    }
  }

  console.log(JSON.stringify({
    dishes: registry.length,
    jsonRegistryPresent: hasJsonRegistry,
    calorieRange: [Math.min(...calories), Math.max(...calories)],
    proteinCategories: counts.protein,
    carbCategories: counts.carb
  }, null, 2));
}

main();
