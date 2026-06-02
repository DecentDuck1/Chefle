const fs = require("fs");
const path = require("path");
const { parseJsonConst } = require("./chefle-constants");

const LOREM_FLICKR_BASE = "https://loremflickr.com/500/500/food";

function formatLoremFlickrName(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, ",");
}

function loremFlickrImageUrl(name) {
  return `${LOREM_FLICKR_BASE},${formatLoremFlickrName(name)}/all`;
}

function normalizeName(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function foodVisualType(dish) {
  const name = normalizeName(dish.name);
  const protein = normalizeName(dish.protein);
  if (/\bpizza|calzone\b/.test(name)) return "pizza";
  if (/\btaco|burrito|quesadilla|enchilada|taquito|chimichanga|tamale|pupusa|arepa|shawarma|gyro|kebab|bao|wrap\b/.test(name)) return "wrap";
  if (/\bburger|sandwich|sub|roll|hot dog|banh mi|toast|bruschetta|pretzel|croque\b/.test(name)) return "sandwich";
  if (/\bsoup|stew|chowder|bisque|ramen|pho|congee|gazpacho|borscht|goulash|chili\b/.test(name)) return "soup";
  if (/\bsalad|slaw|ceviche|tartare|sashimi|sushi|cocktail|edamame\b/.test(name)) return "fresh";
  if (/\begg|omelette|frittata|shakshuka|huevos|benedict|florentine\b/.test(name)) return "eggs";
  if (/\bpancake|waffle|french toast|crepe\b/.test(name)) return "breakfast";
  if (/\bcake|pie|tart|cheesecake|tiramisu|mousse|sundae|split|pudding|cobbler|macaron|eclair|baklava|donut|muffin|croissant|cookie|brownie|churro|gelato|panna cotta|pavlova|rolls\b/.test(name)) return "dessert";
  if (/\bpasta|spaghetti|alfredo|carbonara|ziti|ravioli|tortellini|lasagna|lo mein|chow mein|noodle|risotto|fried rice|bibimbap|biryani|jambalaya|paella|arancini\b/.test(name)) return "pasta";
  if (/\bfish|salmon|shrimp|crab|lobster|clam|mussel|scallop|cod|tuna|swordfish|calamari|seafood\b/.test(name) || protein === "seafood") return "seafood";
  if (/\bfries|hash brown|poutine|potato\b/.test(name)) return "potato";
  if (/\bdumpling|samosa|empanada|pierogi|spring roll|poppers|rings|sticks|tenders|fondue|brie\b/.test(name)) return "bites";
  if (/\bsteak|ribs|chop|roast|meatloaf|brisket|schnitzel|meatball|chicken|duck|turkey|lamb|beef|pork\b/.test(name) || ["beef", "pork", "poultry", "lamb", "veal"].includes(protein)) return "protein";
  return "plate";
}

function foodOnlyImageUrl(dish) {
  const type = foodVisualType(dish);
  const common = '<rect width="300" height="300" rx="32" fill="#fff8e8"/><circle cx="150" cy="158" r="108" fill="#fff8e8" stroke="#e8c783" stroke-width="10"/><ellipse cx="150" cy="218" rx="86" ry="16" fill="#d9b372" opacity=".22"/>';
  const shapes = {
    pizza: '<path d="M86 78 224 116 121 229Z" fill="#f4c45f" stroke="#a86539" stroke-width="9" stroke-linejoin="round"/><path d="M86 78c45 7 91 20 138 38" fill="none" stroke="#d69a52" stroke-width="18" stroke-linecap="round"/><circle cx="143" cy="132" r="10" fill="#c65b45"/><circle cx="176" cy="153" r="9" fill="#c65b45"/><circle cx="135" cy="184" r="8" fill="#c65b45"/>',
    wrap: '<path d="M69 176c20-55 67-86 137-94 21 31 30 70 21 115-48 26-104 22-158-21Z" fill="#d69a52" stroke="#a86539" stroke-width="8"/><path d="M91 160c32-16 72-28 118-35" fill="none" stroke="#fff2c7" stroke-width="15" stroke-linecap="round"/><circle cx="126" cy="146" r="9" fill="#c65b45"/><circle cx="161" cy="136" r="8" fill="#6c945e"/><circle cx="192" cy="142" r="8" fill="#f4c45f"/>',
    sandwich: '<path d="M69 153c34-39 101-54 164-10l-18 73H86Z" fill="#d69a52" stroke="#a86539" stroke-width="8" stroke-linejoin="round"/><path d="M83 165h137" stroke="#fff2c7" stroke-width="16" stroke-linecap="round"/><path d="M89 184c35-15 74-17 122-2" fill="none" stroke="#6c945e" stroke-width="13" stroke-linecap="round"/>',
    soup: '<ellipse cx="150" cy="145" rx="83" ry="39" fill="#7eb8c4" stroke="#a86539" stroke-width="8"/><path d="M73 145c8 54 30 80 77 80s69-26 77-80" fill="#fff2c7" stroke="#a86539" stroke-width="8"/><path d="M105 142c30-13 61-13 91 0" fill="none" stroke="#617d5a" stroke-width="9" stroke-linecap="round"/>',
    fresh: '<path d="M83 179c34-52 82-70 141-33-33 56-80 73-141 33Z" fill="#6c945e" stroke="#48683f" stroke-width="8"/><path d="M99 169c36-7 75-13 108-18" stroke="#dcefb9" stroke-width="8" stroke-linecap="round"/><circle cx="124" cy="180" r="10" fill="#c65b45"/><circle cx="163" cy="165" r="10" fill="#f4c45f"/>',
    eggs: '<path d="M78 168c0-36 37-55 70-30 32-26 76-7 76 31 0 44-56 58-76 32-28 24-70 8-70-33Z" fill="#fffdf6" stroke="#d7ba81" stroke-width="8"/><circle cx="129" cy="168" r="23" fill="#f4c45f" stroke="#d69a38" stroke-width="6"/><circle cx="177" cy="174" r="20" fill="#f4c45f" stroke="#d69a38" stroke-width="6"/>',
    breakfast: '<ellipse cx="150" cy="180" rx="72" ry="30" fill="#d69a52" stroke="#a86539" stroke-width="8"/><ellipse cx="150" cy="153" rx="67" ry="28" fill="#e8b765" stroke="#a86539" stroke-width="7"/><ellipse cx="150" cy="128" rx="61" ry="25" fill="#f0c575" stroke="#a86539" stroke-width="6"/><rect x="133" y="111" width="34" height="25" rx="6" fill="#f4c45f"/>',
    dessert: '<path d="M89 112h121l-18 93H107Z" fill="#f1b0a3" stroke="#a86539" stroke-width="8" stroke-linejoin="round"/><path d="M91 116c22-28 84-36 118-3" fill="#fff2c7" stroke="#a86539" stroke-width="8"/><path d="M108 150h85M112 179h76" stroke="#fff8e8" stroke-width="9" stroke-linecap="round"/>',
    pasta: '<path d="M84 164c34-34 99-41 137-4-27 45-105 55-137 4Z" fill="#f7d26b" stroke="#a86539" stroke-width="8"/><path d="M101 160c23-22 42 18 66-5 17-16 30 8 47-7M102 179c27-20 47 17 72-4 17-14 28 3 39-8" fill="none" stroke="#fff2a8" stroke-width="9" stroke-linecap="round"/>',
    seafood: '<path d="M78 164c48-52 103-52 147 0-47 46-98 48-147 0Z" fill="#f2a88d" stroke="#a86539" stroke-width="8"/><path d="M198 164 236 135v58Z" fill="#f2a88d" stroke="#a86539" stroke-width="8" stroke-linejoin="round"/><circle cx="115" cy="155" r="7" fill="#fffdf6"/><circle cx="117" cy="156" r="3" fill="#3b2418"/>',
    potato: '<path d="M91 207h118l12-82H79Z" fill="#c65b45" stroke="#a86539" stroke-width="8" stroke-linejoin="round"/><path d="M104 103v83M126 92v96M150 101v84M176 91v96M199 107v78" stroke="#f0c15d" stroke-width="17" stroke-linecap="round"/>',
    bites: '<path d="M83 178c14-38 46-45 66-14 23-31 57-21 67 16-39 33-93 33-133-2Z" fill="#fff2c7" stroke="#a86539" stroke-width="8"/><path d="M105 166c11 10 21 12 34 2M161 165c12 10 24 11 36 0" fill="none" stroke="#e8c783" stroke-width="7" stroke-linecap="round"/>',
    protein: '<path d="M82 165c19-55 86-75 140-33 2 55-55 88-115 69-22-7-33-19-25-36Z" fill="#9a4f3f" stroke="#a86539" stroke-width="8"/><path d="M115 154c30-16 62-18 92-2" fill="none" stroke="#d77a5c" stroke-width="9" stroke-linecap="round"/>',
    plate: '<circle cx="127" cy="161" r="25" fill="#c65b45" stroke="#a86539" stroke-width="7"/><circle cx="174" cy="158" r="24" fill="#6c945e" stroke="#48683f" stroke-width="7"/><circle cx="150" cy="196" r="22" fill="#f4c45f" stroke="#a86539" stroke-width="7"/>'
  };
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">${common}${shapes[type] || shapes.plate}</svg>`)}`;
}

function addImageUrls(dishes) {
  return dishes.map((dish) => ({
    ...dish,
    imageUrl: dish.verifiedImageUrl || foodOnlyImageUrl(dish)
  }));
}

function addLoremFlickrImageUrls(dishes) {
  return dishes.map((dish) => ({
    ...dish,
    imageUrl: loremFlickrImageUrl(dish.name)
  }));
}

function readChefleDishes(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  return parseJsonConst(source, "chefleGlobalMasterRegistry");
}

if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  const cheflePath = path.join(root, "chefle.html");
  const outputPath = path.join(root, "chefle-dishes-with-images.json");
  const dishes = addImageUrls(readChefleDishes(cheflePath));
  fs.writeFileSync(outputPath, `${JSON.stringify(dishes, null, 2)}\n`);
  console.log(`Wrote ${dishes.length} dishes to ${outputPath}`);
}

module.exports = {
  addImageUrls,
  addLoremFlickrImageUrls,
  foodOnlyImageUrl,
  formatLoremFlickrName,
  loremFlickrImageUrl
};
