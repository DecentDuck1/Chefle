const fs = require("fs");
const path = require("path");
const { extractConstLiteral, parseJsonLiteral, withUpdatedCspScriptHash } = require("./chefle-constants");

const ROOT = path.resolve(__dirname, "..");
const HTML_PATH = path.join(ROOT, "chefle.html");
const OUTPUT_JSON_PATH = path.join(ROOT, "chefle-dishes-with-images.json");
const PHOTO_DIR_NAME = "food-photo-review-specific-only-v3";
const PHOTO_DIR = path.join(ROOT, PHOTO_DIR_NAME);
const SOURCES_PATH = path.join(PHOTO_DIR, "sources.json");

function parseRegistry(arrayLiteral) {
  return parseJsonLiteral(arrayLiteral, "chefleGlobalMasterRegistry");
}

function escapeNonAscii(value) {
  return value.replace(/[^\x00-\x7F]/g, (char) => {
    const code = char.codePointAt(0).toString(16).padStart(4, "0");
    return `\\u${code}`;
  });
}

function stringifyAscii(value, spaces = 2) {
  return escapeNonAscii(JSON.stringify(value, null, spaces));
}

function validateManifest(manifest, registry) {
  if (manifest.length !== registry.length) {
    throw new Error(`Manifest count ${manifest.length} does not match registry count ${registry.length}.`);
  }

  const byIndex = new Map();
  for (const item of manifest) {
    if (item.status !== "downloaded") throw new Error(`Image ${item.index} is not downloaded.`);
    if (!item.file) throw new Error(`Image ${item.index} is missing a file name.`);
    if (byIndex.has(item.index)) throw new Error(`Duplicate manifest index ${item.index}.`);
    const imagePath = path.join(PHOTO_DIR, item.file);
    if (!fs.existsSync(imagePath)) throw new Error(`Missing image file: ${imagePath}`);
    byIndex.set(item.index, item);
  }

  for (let index = 1; index <= registry.length; index += 1) {
    const item = byIndex.get(index);
    if (!item) throw new Error(`Missing manifest entry ${index}.`);
    if (String(item.dishName || "").trim() !== String(registry[index - 1].name || "").trim()) {
      throw new Error(`Dish mismatch at ${index}: manifest=${item.dishName}, registry=${registry[index - 1].name}`);
    }
  }

  return byIndex;
}

function imageUrlForFile(file) {
  return `${PHOTO_DIR_NAME}/${file}`;
}

function main() {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const range = extractConstLiteral(html, "chefleGlobalMasterRegistry");
  const registry = parseRegistry(range.literal);
  const manifest = JSON.parse(fs.readFileSync(SOURCES_PATH, "utf8"));
  const byIndex = validateManifest(manifest, registry);

  const updatedRegistry = registry.map((dish, zeroIndex) => {
    const manifestEntry = byIndex.get(zeroIndex + 1);
    return {
      ...dish,
      imageUrl: imageUrlForFile(manifestEntry.file)
    };
  });

  const registryLiteral = stringifyAscii(updatedRegistry, 8)
    .split("\n")
    .map((line, index) => (index === 0 ? line : `      ${line}`))
    .join("\n");
  const updatedHtml = withUpdatedCspScriptHash(html.slice(0, range.start) + registryLiteral + html.slice(range.end));

  fs.writeFileSync(HTML_PATH, updatedHtml);
  fs.writeFileSync(OUTPUT_JSON_PATH, `${stringifyAscii(updatedRegistry, 2)}\n`);

  console.log(`Updated ${updatedRegistry.length} dish image URLs.`);
  console.log(`HTML: ${HTML_PATH}`);
  console.log(`JSON: ${OUTPUT_JSON_PATH}`);
}

main();
