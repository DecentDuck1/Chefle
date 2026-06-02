const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REVIEW_DIR = path.join(ROOT, "food-photo-review-specific-only-v3");
const SOURCES_PATH = path.join(REVIEW_DIR, "sources.json");
const CSV_PATH = path.join(REVIEW_DIR, "sources.csv");
const INDEX_PATH = path.join(REVIEW_DIR, "index.html");

function escapeCsv(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(SOURCES_PATH, "utf8"));
  const downloaded = manifest.filter((item) => item.status === "downloaded").length;
  const missing = manifest.length - downloaded;

  const csvHeader = ["index", "dishName", "file", "status", "query", "title", "pageUrl", "imageUrl", "reason"];
  const csvRows = manifest.map((item) => csvHeader.map((key) => escapeCsv(item[key])).join(","));
  fs.writeFileSync(CSV_PATH, `${csvHeader.map(escapeCsv).join(",")}\n${csvRows.join("\n")}\n`);

  const cards = manifest.map((item) => {
    const index = String(item.index).padStart(3, "0");
    const title = item.title || item.reason || item.query || "";
    const source = item.pageUrl ? `<a href="${escapeHtml(item.pageUrl)}">source</a>` : "";
    const image = item.file
      ? `<img src="${escapeHtml(item.file)}" alt="${escapeHtml(item.dishName)}">`
      : `<div class="missing">Missing</div>`;
    return `<article class="card ${escapeHtml(item.status)}">
  <div class="number">${index}</div>
  ${image}
  <h2>${escapeHtml(item.dishName)}</h2>
  <p>${escapeHtml(title)}</p>
  ${source}
</article>`;
  }).join("\n");

  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Specific Food Only Photo Review</title>
<style>
body { margin: 0; font-family: Arial, sans-serif; background: #f8f6f2; color: #201a15; }
header { position: sticky; top: 0; z-index: 2; padding: 16px 24px; background: rgba(248, 246, 242, .96); border-bottom: 1px solid #d8d0c5; }
h1 { margin: 0; font-size: 22px; }
.meta { margin: 4px 0 0; color: #6e6258; font-size: 14px; }
main { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 16px; padding: 20px; }
.card { position: relative; overflow: hidden; background: #fff; border: 1px solid #ded6cc; border-radius: 8px; box-shadow: 0 1px 2px rgba(34, 24, 18, .08); }
.number { position: absolute; top: 8px; left: 8px; padding: 4px 6px; border-radius: 6px; background: rgba(0, 0, 0, .72); color: #fff; font-size: 12px; }
img, .missing { width: 100%; aspect-ratio: 1; object-fit: contain; display: block; background: #fff; }
.missing { display: grid; place-items: center; color: #8a3327; font-size: 14px; }
h2 { margin: 10px 10px 4px; font-size: 15px; line-height: 1.25; }
p { min-height: 34px; margin: 0 10px 8px; color: #695c52; font-size: 12px; line-height: 1.35; }
a { display: inline-block; margin: 0 10px 12px; color: #0c6653; font-size: 12px; }
</style>
<body>
<header>
  <h1>Specific Food Only Photo Review</h1>
  <p class="meta">${downloaded} downloaded, ${missing} missing. App-ready local JPEG files with isolated food photos.</p>
</header>
<main>
${cards}
</main>
</body>
</html>
`;

  fs.writeFileSync(INDEX_PATH, html);
  console.log(`Synced ${manifest.length} review entries.`);
}

main();
