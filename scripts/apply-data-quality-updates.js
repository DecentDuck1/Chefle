const fs = require("fs");
const path = require("path");
const { extractConstLiteral, parseJsonLiteral, withUpdatedCspScriptHash } = require("./chefle-constants");

const ROOT = path.resolve(__dirname, "..");
const HTML_PATH = path.join(ROOT, "chefle.html");
const JSON_PATH = path.join(ROOT, "chefle-dishes-with-images.json");

const CALORIE_OVERRIDES = {
  "Scrambled Eggs": 200,
  "Fried Spring Rolls": 300,
  "Edamame": 190,
  "Greek Salad": 300,
  "Potato Salad": 350,
  "Tonkotsu Ramen": 650,
  "Bouillabaisse": 350,
  "Margherita Pizza": 285,
  "Pepperoni Pizza": 350,
  "BBQ Chicken Pizza": 350,
  "Hawaiian Pizza": 330,
  "Lasagna Bolognese": 450,
  "Macaroni and Cheese": 510,
  "Beef Empanadas": 520,
  "Pork Tamales": 520,
  "Beef Taquitos": 480,
  "Potato and Pea Samosas": 320,
  "Pupusas": 520,
  "New York Cheesecake": 500,
  "Banana Split": 850,
  "French Macarons": 180
};

const PROTEIN_DAIRY = new Set([
  "Mozzarella Sticks",
  "Nachos",
  "Jalapeño Poppers",
  "Caprese Salad",
  "Caesar Salad",
  "Greek Salad",
  "Cheese Fondue",
  "Baked Brie",
  "Broccoli Cheddar Soup",
  "Cream of Mushroom Soup",
  "Margherita Pizza",
  "Grilled Cheese Sandwich",
  "Caprese Panini",
  "Fettuccine Alfredo",
  "Macaroni and Cheese",
  "Baked Ziti",
  "Mushroom Risotto",
  "Eggplant Parmigiana",
  "Palak Paneer",
  "Gnocchi alla Sorrentina",
  "Spinach and Ricotta Ravioli",
  "Pesto Pasta",
  "Cheese Tortellini",
  "Cheese Quesadilla",
  "Poutine",
  "Elote",
  "Arancini",
  "New York Cheesecake",
  "Tiramisu",
  "Crème Brûlée",
  "Hot Fudge Sundae",
  "Banana Split",
  "Chocolate Mousse",
  "Gelato",
  "Panna Cotta",
  "Chocolate Éclairs",
  "Waffles with Ice Cream"
]);

const PROTEIN_LEGUME = new Set([
  "Hummus with Pita",
  "Edamame",
  "Lentil Soup",
  "Miso Soup",
  "Falafel Wrap",
  "Chana Masala",
  "Vegetarian Chili",
  "Lentil Dahl"
]);

const PROTEIN_EGG = new Set([
  "French Toast",
  "Sweet Crepes",
  "Potato Salad"
]);

const PROTEIN_PLANT = new Set([
  "Avocado Toast",
  "Acai Bowl",
  "Onion Rings",
  "Bruschetta",
  "Fried Spring Rolls",
  "Guacamole and Tortilla Chips",
  "Cole Slaw",
  "Tomato Soup",
  "Minestrone",
  "Potato Leek Soup",
  "Gazpacho",
  "Borscht",
  "Roasted Pumpkin Soup",
  "Corn Chowder",
  "Vegetable Fried Rice",
  "Vegetable Curry",
  "Ratatouille",
  "Vegetable Chow Mein",
  "Vegetable Biryani",
  "Potato and Pea Samosas"
]);

const CARB_OVERRIDES = {
  "Bacon and Eggs": "None",
  "Scotch Eggs": "None",
  "Chicken Parmigiana": "Breadcrumbs",
  "Chicken Cordon Bleu": "Breadcrumbs",
  "Lobster Thermidor": "None",
  "Steamed Crab Legs": "None",
  "Yakitori": "None",
  "New York Cheesecake": "Pastry",
  "Crème Brûlée": "None",
  "Hot Fudge Sundae": "None",
  "Chocolate Mousse": "None",
  "Gelato": "None",
  "Panna Cotta": "None",
  "Pavlova": "None"
};

function parseArray(source, variableName) {
  return parseJsonLiteral(extractConstLiteral(source, variableName).literal, variableName);
}

function formatNumberArray(values) {
  const rows = [];
  for (let index = 0; index < values.length; index += 12) {
    rows.push("        " + values.slice(index, index + 12).join(", "));
  }
  return "[\n" + rows.join(",\n") + "\n      ]";
}

function proteinForDish(dish) {
  if (dish.protein !== "Vegetarian") return dish.protein;
  if (PROTEIN_EGG.has(dish.name)) return "Egg";
  if (PROTEIN_DAIRY.has(dish.name)) return "Dairy";
  if (PROTEIN_LEGUME.has(dish.name)) return "Legume";
  if (PROTEIN_PLANT.has(dish.name)) return "Plant";
  return "None";
}

function normalizeDish(dish, effectiveCalories) {
  return {
    ...dish,
    protein: proteinForDish(dish),
    carb: CARB_OVERRIDES[dish.name] || dish.carb,
    calories: effectiveCalories
  };
}

function main() {
  let html = fs.readFileSync(HTML_PATH, "utf8");
  const registryRange = extractConstLiteral(html, "chefleGlobalMasterRegistry");
  const calorieRange = extractConstLiteral(html, "CALORIE_ESTIMATES");
  const registry = parseJsonLiteral(registryRange.literal, "chefleGlobalMasterRegistry");
  const currentCalories = parseJsonLiteral(calorieRange.literal, "CALORIE_ESTIMATES");
  if (registry.length !== currentCalories.length) {
    throw new Error(`Registry/calorie length mismatch: ${registry.length} vs ${currentCalories.length}`);
  }

  const updatedCalories = registry.map((dish, index) => CALORIE_OVERRIDES[dish.name] || currentCalories[index]);
  const updatedRegistry = registry.map((dish, index) => normalizeDish(dish, updatedCalories[index]));

  html = html.slice(0, registryRange.start)
    + JSON.stringify(updatedRegistry, null, 22)
    + html.slice(registryRange.end);

  const updatedCalorieRange = extractConstLiteral(html, "CALORIE_ESTIMATES");
  html = html.slice(0, updatedCalorieRange.start)
    + formatNumberArray(updatedCalories)
    + html.slice(updatedCalorieRange.end);
  html = withUpdatedCspScriptHash(html);

  fs.writeFileSync(HTML_PATH, html, "utf8");
  fs.writeFileSync(JSON_PATH, JSON.stringify(updatedRegistry, null, 2) + "\n", "utf8");

  console.log(JSON.stringify({
    dishes: updatedRegistry.length,
    calorieOverrides: Object.keys(CALORIE_OVERRIDES).length,
    proteinCounts: Object.fromEntries(updatedRegistry.reduce((map, dish) => map.set(dish.protein, (map.get(dish.protein) || 0) + 1), new Map())),
    carbOverrides: Object.keys(CARB_OVERRIDES).length
  }, null, 2));
}

main();
