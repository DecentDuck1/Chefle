const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { parseJsonConst } = require("./chefle-constants");

const ROOT = path.resolve(__dirname, "..");
const HTML_PATH = path.join(ROOT, "chefle.html");
const ZIP_PATH = path.join(ROOT, "data", "nutrition", "FoodData_Central_survey_food_json_2024-10-31.zip");
const USDA_CACHE_PATH = path.join(ROOT, "data", "nutrition", "usda-fndds-foods.json");
const OUT_PATH = path.join(ROOT, "data", "nutrition", "chefle-nutrition-audit.csv");

function parseConstArray(source, variableName) {
  return parseJsonConst(source, variableName);
}

function cacheUsdaFoods() {
  if (fs.existsSync(USDA_CACHE_PATH)) return;
  const python = process.env.CODEX_PYTHON || "python";
  const script = `
import json, zipfile
from pathlib import Path
zip_path = Path(${JSON.stringify(ZIP_PATH)})
out_path = Path(${JSON.stringify(USDA_CACHE_PATH)})
with zipfile.ZipFile(zip_path) as z:
    data = json.load(z.open("surveyDownload.json"))
foods = []
for food in data["SurveyFoods"]:
    kcal = None
    for nutrient in food.get("foodNutrients", []):
        details = nutrient.get("nutrient", {})
        if details.get("number") == "208" and details.get("unitName") == "kcal":
            kcal = nutrient.get("amount")
            break
    if kcal is None:
        continue
    foods.append({
        "fdcId": food.get("fdcId"),
        "description": food.get("description", ""),
        "category": (food.get("wweiaFoodCategory") or {}).get("wweiaFoodCategoryDescription", ""),
        "kcalPer100g": kcal,
        "portions": [
            {
                "description": portion.get("portionDescription", ""),
                "gramWeight": portion.get("gramWeight", 0),
                "sequenceNumber": portion.get("sequenceNumber", 999)
            }
            for portion in food.get("foodPortions", [])
            if portion.get("gramWeight", 0)
        ]
    })
out_path.write_text(json.dumps(foods, ensure_ascii=True), encoding="utf-8")
print(len(foods))
`;
  const result = spawnSync(python, ["-c", script], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Failed to extract USDA data:\n${result.stderr || result.stdout}`);
  }
}

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

const ALIASES = {
  "Belgian Waffles": ["waffle, plain", "waffle"],
  "Avocado Toast": ["avocado toast"],
  "Hash Browns": ["potatoes, hash browned"],
  "Eggs Florentine": ["egg benedict florentine", "eggs benedict"],
  "Full English Breakfast": ["breakfast platter", "egg, bacon, sausage, beans"],
  "Bagel with Lox and Cream Cheese": ["bagel with cream cheese and smoked salmon", "bagel, cream cheese, smoked salmon"],
  "Classic French Omelette": ["omelet", "egg omelet"],
  "Scotch Eggs": ["egg, with sausage"],
  "Mozzarella Sticks": ["mozzarella sticks"],
  "Buffalo Chicken Wings": ["chicken wing, buffalo"],
  "Jalapeno Poppers": ["jalapeno poppers"],
  "Hummus with Pita": ["hummus with pita"],
  "Guacamole and Tortilla Chips": ["guacamole with tortilla chips"],
  "Pigs in a Blanket": ["frankfurter or hot dog wrapped in dough"],
  "Chicken Tenders": ["chicken tenders", "chicken strips"],
  "Classic Beef Stew": ["beef stew"],
  "Chili Con Carne": ["chili with meat and beans", "chili con carne"],
  "Tom Yum Soup": ["thai soup", "tom yum"],
  "Beef Pho": ["pho, beef"],
  "Tonkotsu Ramen": ["ramen noodle soup, pork"],
  "Beef Goulash": ["goulash with beef"],
  "Chicken Tortilla Soup": ["tortilla soup with chicken"],
  "Split Pea Soup": ["split pea soup with ham"],
  "Roasted Pumpkin Soup": ["pumpkin soup"],
  "Hot and Sour Soup": ["hot and sour soup"],
  "Wonton Soup": ["wonton soup"],
  "Egg Drop Soup": ["egg drop soup"],
  "Italian Wedding Soup": ["italian wedding soup"],
  "Broccoli Cheddar Soup": ["broccoli cheese soup"],
  "Classic Cheeseburger": ["cheeseburger"],
  "Margherita Pizza": ["pizza, cheese"],
  "Pepperoni Pizza": ["pizza, pepperoni"],
  "Club Sandwich": ["club sandwich"],
  "BLT Sandwich": ["bacon lettuce tomato sandwich"],
  "Grilled Cheese Sandwich": ["grilled cheese sandwich"],
  "Reuben Sandwich": ["reuben sandwich"],
  "Philly Cheesesteak": ["cheesesteak sandwich"],
  "Pulled Pork Sandwich": ["pulled pork sandwich"],
  "Chicken Parmigiana Sub": ["chicken parmesan sandwich"],
  "Meatball Sub": ["meatball sandwich"],
  "Turkey and Swiss Wrap": ["turkey wrap"],
  "Sloppy Joe": ["sloppy joe sandwich"],
  "Cuban Sandwich": ["cuban sandwich"],
  "French Dip Sandwich": ["roast beef sandwich with au jus"],
  "Pork Banh Mi": ["banh mi sandwich"],
  "Caprese Panini": ["tomato mozzarella panini"],
  "BBQ Chicken Pizza": ["pizza, chicken barbecue"],
  "Hawaiian Pizza": ["pizza, ham and pineapple"],
  "Calzone": ["calzone"],
  "Lobster Roll": ["lobster roll sandwich"],
  "Ribeye Steak": ["beef steak, rib eye"],
  "Filet Mignon": ["beef tenderloin steak"],
  "Sunday Roast Beef": ["roast beef"],
  "Classic Meatloaf": ["meat loaf, beef"],
  "Beef Stroganoff": ["beef stroganoff"],
  "Beef Wellington": ["beef wellington"],
  "BBQ Baby Back Ribs": ["pork ribs, barbecue"],
  "Pan Seared Pork Chops": ["pork chop"],
  "Roast Pork Tenderloin": ["pork tenderloin"],
  "Shepherd's Pie": ["shepherds pie"],
  "Cottage Pie": ["beef pot pie", "shepherds pie"],
  "Grilled Lamb Chops": ["lamb chop"],
  "Beef Bourguignon": ["beef burgundy", "beef stew"],
  "Carne Asada": ["carne asada"],
  "Swedish Meatballs": ["swedish meatballs"],
  "Spaghetti and Meatballs": ["spaghetti with meatballs"],
  "Wiener Schnitzel": ["veal cutlet breaded fried"],
  "Pork Schnitzel": ["pork cutlet breaded fried"],
  "Smoked Beef Brisket": ["beef brisket smoked"],
  "Corned Beef and Cabbage": ["corned beef and cabbage"],
  "Salisbury Steak": ["salisbury steak"],
  "Braised Lamb Shank": ["lamb shank"],
  "Beef Kebabs": ["beef kabob"],
  "Mongolian Beef": ["mongolian beef"],
  "Beef and Broccoli": ["beef with broccoli"],
  "Beef Fajitas": ["beef fajita"],
  "Southern Fried Chicken": ["fried chicken"],
  "Classic Roast Chicken": ["roasted chicken"],
  "Chicken Parmigiana": ["chicken parmesan"],
  "Chicken Alfredo": ["chicken alfredo"],
  "Chicken Marsala": ["chicken marsala"],
  "Chicken Piccata": ["chicken piccata"],
  "Chicken Cordon Bleu": ["chicken cordon bleu"],
  "Chicken Tikka Masala": ["chicken tikka masala"],
  "Butter Chicken": ["butter chicken"],
  "Chicken Korma": ["chicken korma"],
  "Kung Pao Chicken": ["kung pao chicken"],
  "General Tso's Chicken": ["general tso chicken"],
  "Sweet and Sour Chicken": ["sweet and sour chicken"],
  "Orange Chicken": ["orange chicken"],
  "Chicken Fajitas": ["chicken fajita"],
  "Roast Turkey": ["roasted turkey"],
  "Peking Duck": ["duck, roasted"],
  "Duck a l'Orange": ["duck with orange sauce", "duck roasted"],
  "Chicken Satay": ["chicken satay"],
  "Chicken Souvlaki": ["chicken souvlaki"],
  "Tandoori Chicken": ["tandoori chicken"],
  "Chicken Adobo": ["chicken adobo"],
  "Chicken Quesadilla": ["chicken quesadilla"],
  "Coq au Vin": ["chicken in wine sauce"],
  "Chicken Enchiladas": ["chicken enchilada"],
  "Chicken Teriyaki": ["chicken teriyaki"],
  "Chicken Cacciatore": ["chicken cacciatore"],
  "Fish and Chips": ["fish and chips"],
  "Grilled Salmon": ["salmon grilled"],
  "Shrimp Scampi": ["shrimp scampi"],
  "Paella Valenciana": ["paella"],
  "California Sushi Rolls": ["sushi roll california"],
  "Tuna Sashimi": ["tuna sashimi"],
  "Maryland Crab Cakes": ["crab cake"],
  "Fried Butterfly Shrimp": ["shrimp fried breaded"],
  "Baked Cod": ["cod baked"],
  "Lobster Thermidor": ["lobster"],
  "Linguine with Clams": ["linguine with clam sauce"],
  "Shrimp Fried Rice": ["shrimp fried rice"],
  "Baja Fish Tacos": ["fish taco"],
  "Grilled Swordfish Steak": ["swordfish grilled"],
  "Tuna Tartare": ["tuna raw"],
  "Classic Ceviche": ["ceviche"],
  "Coconut Shrimp": ["coconut shrimp"],
  "Seared Ahi Tuna": ["tuna steak"],
  "Shrimp Jambalaya": ["jambalaya with shrimp"],
  "Mussels in White Wine Sauce": ["mussels"],
  "Pan Seared Scallops": ["scallops cooked"],
  "Steamed Crab Legs": ["crab legs"],
  "Shrimp and Grits": ["shrimp and grits"],
  "Salmon Teriyaki": ["salmon teriyaki"],
  "Lasagna Bolognese": ["lasagna with meat"],
  "Spaghetti Carbonara": ["spaghetti carbonara"],
  "Fettuccine Alfredo": ["fettuccine alfredo"],
  "Penne alla Vodka": ["pasta with vodka sauce"],
  "Macaroni and Cheese": ["macaroni and cheese"],
  "Baked Ziti": ["baked ziti"],
  "Pad Thai": ["pad thai"],
  "Chicken Lo Mein": ["chicken lo mein"],
  "Vegetable Fried Rice": ["vegetable fried rice"],
  "Mushroom Risotto": ["risotto"],
  "Eggplant Parmigiana": ["eggplant parmesan"],
  "Falafel Wrap": ["falafel sandwich"],
  "Chana Masala": ["chickpea curry"],
  "Palak Paneer": ["spinach with cheese"],
  "Vegetable Curry": ["vegetable curry"],
  "Gnocchi alla Sorrentina": ["gnocchi with tomato sauce"],
  "Spinach and Ricotta Ravioli": ["cheese ravioli"],
  "Spaghetti Aglio e Olio": ["spaghetti with oil and garlic"],
  "Pesto Pasta": ["pasta with pesto sauce"],
  "Vegetable Chow Mein": ["vegetable chow mein"],
  "Singapore Noodles": ["rice noodles singapore"],
  "Bibimbap": ["bibimbap"],
  "Kimchi Fried Rice": ["kimchi fried rice"],
  "Vegetable Biryani": ["vegetable biryani"],
  "Stuffed Bell Peppers": ["stuffed pepper"],
  "Vegetarian Chili": ["vegetarian chili"],
  "Cheese Tortellini": ["cheese tortellini"],
  "Lentil Dahl": ["lentil curry"],
  "Beef Tacos": ["beef taco"],
  "Tacos al Pastor": ["pork taco"],
  "Beef and Bean Burrito": ["beef and bean burrito"],
  "Classic Hot Dog": ["hot dog"],
  "Corn Dog": ["corn dog"],
  "Gyro Wrap": ["gyro sandwich"],
  "Chicken Shawarma": ["chicken shawarma"],
  "Doner Kebab": ["doner kebab"],
  "Cheese Quesadilla": ["cheese quesadilla"],
  "Beef Empanadas": ["beef empanada"],
  "Pork Tamales": ["pork tamale"],
  "Beef Taquitos": ["beef taquito"],
  "Potato and Pea Samosas": ["samosa"],
  "Poutine": ["poutine"],
  "Arepas": ["arepa"],
  "Pork Belly Bao Buns": ["pork bun"],
  "Beef Chimichanga": ["beef chimichanga"],
  "Elote": ["corn with cheese"],
  "Soft Pretzels": ["soft pretzel"],
  "Yakitori": ["chicken skewer"],
  "Arancini": ["rice ball"],
  "Pupusas": ["pupusa"],
  "Potato Pierogi": ["pierogi potato"],
  "Croque Monsieur": ["ham and cheese sandwich"],
  "Croque Madame": ["ham and cheese sandwich with egg"],
  "Burek": ["meat pie"],
  "Sausage Roll": ["sausage roll"],
  "Apple Pie": ["apple pie"],
  "Chocolate Chip Cookies": ["chocolate chip cookie"],
  "Fudge Brownies": ["brownie"],
  "New York Cheesecake": ["cheesecake"],
  "Tiramisu": ["tiramisu"],
  "Creme Brulee": ["creme brulee"],
  "Chocolate Lava Cake": ["chocolate cake"],
  "Hot Fudge Sundae": ["ice cream sundae"],
  "Banana Split": ["banana split"],
  "Carrot Cake": ["carrot cake"],
  "Red Velvet Cake": ["red velvet cake"],
  "Key Lime Pie": ["key lime pie"],
  "Lemon Meringue Tart": ["lemon meringue pie"],
  "Pecan Pie": ["pecan pie"],
  "Chocolate Mousse": ["chocolate mousse"],
  "Churros": ["churro"],
  "Gelato": ["ice cream"],
  "Panna Cotta": ["panna cotta"],
  "French Macarons": ["macaroon"],
  "Chocolate Eclairs": ["eclair"],
  "Baklava": ["baklava"],
  "Bread and Butter Pudding": ["bread pudding"],
  "Sticky Toffee Pudding": ["pudding cake"],
  "Strawberry Shortcake": ["strawberry shortcake"],
  "Peach Cobbler": ["peach cobbler"],
  "Pavlova": ["meringue dessert"],
  "Glazed Donuts": ["glazed doughnut"],
  "Waffles with Ice Cream": ["waffle with ice cream"],
  "Blueberry Muffins": ["blueberry muffin"],
  "Butter Croissant": ["croissant"]
};

function scoreCandidate(query, food) {
  const queryTokens = tokens(query);
  const foodName = normalize(food.description);
  const desc = normalize(`${food.description} ${food.category}`);
  const descTokens = new Set(tokens(desc));
  let score = 0;
  for (const token of queryTokens) {
    if (descTokens.has(token)) score += 12;
    else if (desc.includes(token)) score += 5;
    else score -= 8;
  }
  if (desc.includes(normalize(query))) score += 40;
  if (foodName.includes(normalize(query))) score += 30;
  if (/\bnfs\b|\bns as to\b/.test(desc)) score -= 2;
  return score;
}

function bestPortion(food) {
  const portions = [...food.portions].filter((portion) => Number(portion.gramWeight) > 0);
  if (!portions.length) return { description: "100 g reference amount", gramWeight: 100 };
  const bad = /guideline|quantity not specified|fl oz|tbsp|teaspoon|packet|sauce|dressing/i;
  const preferred = [
    /1 serving/i,
    /1 order/i,
    /1 sandwich/i,
    /1 burger/i,
    /1 burrito/i,
    /1 taco/i,
    /1 slice/i,
    /1 piece/i,
    /1 cup/i,
    /1 bowl/i,
    /1 plate/i,
    /1 individual/i
  ];
  for (const pattern of preferred) {
    const hit = portions.find((portion) => pattern.test(portion.description) && !bad.test(portion.description));
    if (hit) return hit;
  }
  return portions
    .filter((portion) => !bad.test(portion.description))
    .sort((a, b) => (a.sequenceNumber || 999) - (b.sequenceNumber || 999))[0] || portions[0];
}

function kcalForPortion(food, portion) {
  return Math.max(1, Math.round((Number(food.kcalPer100g) * Number(portion.gramWeight)) / 100));
}

function csv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function main() {
  cacheUsdaFoods();
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const registry = parseConstArray(html, "chefleGlobalMasterRegistry");
  const currentCalories = parseConstArray(html, "CALORIE_ESTIMATES");
  const foods = JSON.parse(fs.readFileSync(USDA_CACHE_PATH, "utf8"));

  const rows = [];
  for (const [index, dish] of registry.entries()) {
    const queries = [dish.name, ...(ALIASES[dish.name] || [])];
    const candidates = [];
    for (const query of queries) {
      for (const food of foods) {
        const score = scoreCandidate(query, food);
        if (score > 0) candidates.push({ query, score, food });
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.food.description.localeCompare(b.food.description));
    const best = candidates[0];
    if (!best) {
      rows.push({
        index: index + 1,
        name: dish.name,
        appCalories: currentCalories[index],
        usdaCandidateCalories: "",
        candidateSource: "manual-needed",
        fdcId: "",
        description: "",
        category: "",
        kcalPer100g: "",
        portionDescription: "",
        portionGrams: "",
        matchScore: 0,
        query: queries[0]
      });
      continue;
    }
    const portion = bestPortion(best.food);
    rows.push({
      index: index + 1,
      name: dish.name,
      appCalories: currentCalories[index],
      usdaCandidateCalories: kcalForPortion(best.food, portion),
      candidateSource: "USDA FNDDS 2021-2023",
      fdcId: best.food.fdcId,
      description: best.food.description,
      category: best.food.category,
      kcalPer100g: best.food.kcalPer100g,
      portionDescription: portion.description,
      portionGrams: portion.gramWeight,
      matchScore: best.score,
      query: best.query
    });
  }

  const header = Object.keys(rows[0]);
  fs.writeFileSync(OUT_PATH, [header.join(","), ...rows.map((row) => header.map((key) => csv(row[key])).join(","))].join("\n"), "utf8");
  const lowConfidence = rows.filter((row) => row.matchScore < 35);
  console.log(JSON.stringify({
    rows: rows.length,
    output: path.relative(ROOT, OUT_PATH),
    lowConfidence: lowConfidence.length,
    lowConfidenceExamples: lowConfidence.slice(0, 20).map((row) => ({
      index: row.index,
      name: row.name,
      score: row.matchScore,
      match: row.description,
      portion: row.portionDescription,
      calories: row.usdaCandidateCalories
    }))
  }, null, 2));
}

main();
