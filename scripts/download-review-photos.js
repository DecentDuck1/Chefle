const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DISHES_PATH = path.join(ROOT, "chefle-dishes-with-images.json");
const OUTPUT_DIR = path.join(ROOT, "food-photo-review");
const USER_AGENT = "CheflePhotoReview/1.0 (local review script)";
const CONCURRENCY = 1;
const REQUEST_DELAY_MS = 450;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const QUICK_MODE = process.argv.includes("--quick");

const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
};

const FALLBACK_TERMS = {
  "Red Curry": "Thai red curry",
  "Green Curry": "Thai green curry",
  "Yellow Curry": "Thai yellow curry",
  "Satay": "chicken satay",
  "Kebab": "shish kebab",
  "Currywurst": "currywurst food",
  "Pierogi": "pierogi food",
  "Dolma": "dolma food",
  "Fried Rice": "Chinese fried rice",
  "Chocolate Éclairs": "chocolate eclair",
  "Crème Brûlée": "creme brulee dessert"
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function normalizeTitle(value) {
  return String(value || "")
    .replace(/^File:/i, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

function titleScore(title, dishName) {
  const cleanTitle = normalizeTitle(title);
  const terms = dishName.toLowerCase().split(/\s+/).filter((term) => term.length > 2);
  let score = 0;
  for (const term of terms) {
    if (cleanTitle.includes(term)) score += 2;
  }
  if (/\b(food|dish|plate|meal|served|homemade|cuisine)\b/.test(cleanTitle)) score += 1;
  if (/\b(map|logo|diagram|illustration|icon|painting|drawing|poster|person|restaurant|menu)\b/.test(cleanTitle)) score -= 4;
  return score;
}

function apiUrl(host, params) {
  const url = new URL(`https://${host}/w/api.php`);
  url.search = new URLSearchParams({ format: "json", origin: "*", ...params }).toString();
  return url;
}

async function fetchJson(url) {
  const response = await fetchWithRetry(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/json"
    }
  });
  return response.json();
}

async function fetchBuffer(url) {
  const response = await fetchWithRetry(url, {
    headers: { "User-Agent": USER_AGENT }
  });
  const mime = response.headers.get("content-type")?.split(";")[0].toLowerCase() || "";
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, mime };
}

async function fetchWithRetry(url, options = {}, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status} for ${url}`);
      if (!RETRYABLE_STATUS.has(response.status)) throw lastError;
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 1200 * attempt;
      await sleep(waitMs);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(900 * attempt);
    }
  }
  throw lastError;
}

function pageImageCandidate(page, dishName, source) {
  const image = page.thumbnail || page.original || null;
  if (!image?.source) return null;
  const license = page.imageinfo?.[0]?.extmetadata || {};
  return {
    dishName,
    source,
    title: page.title,
    filePage: page.fullurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
    imageUrl: image.source,
    credit: stripHtml(license.Artist?.value || license.Credit?.value),
    license: stripHtml(license.LicenseShortName?.value || license.UsageTerms?.value),
    licenseUrl: license.LicenseUrl?.value || "",
    score: titleScore(page.title, dishName)
  };
}

async function findWikipediaImage(dishName) {
  const url = apiUrl("en.wikipedia.org", {
    action: "query",
    titles: dishName,
    prop: "pageimages|info|imageinfo",
    piprop: "thumbnail|original",
    pithumbsize: "900",
    inprop: "url",
    iiprop: "url|extmetadata"
  });
  const json = await fetchJson(url);
  const pages = Object.values(json.query?.pages || {}).filter((page) => !page.missing);
  const candidates = pages.map((page) => pageImageCandidate(page, dishName, "wikipedia")).filter(Boolean);
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

async function findCommonsImage(dishName, term) {
  const search = `File:${term} food dish`;
  const url = apiUrl("commons.wikimedia.org", {
    action: "query",
    generator: "search",
    gsrnamespace: "6",
    gsrlimit: "8",
    gsrsearch: search,
    prop: "imageinfo|info",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: "900",
    inprop: "url"
  });
  const json = await fetchJson(url);
  const pages = Object.values(json.query?.pages || {});
  const candidates = pages
    .map((page) => {
      const imageInfo = page.imageinfo?.[0];
      if (!imageInfo) return null;
      const mime = String(imageInfo.mime || "").toLowerCase();
      if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) return null;
      const license = imageInfo.extmetadata || {};
      return {
        dishName,
        source: "wikimedia-commons",
        title: page.title,
        filePage: page.fullurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
        imageUrl: imageInfo.thumburl || imageInfo.url,
        credit: stripHtml(license.Artist?.value || license.Credit?.value),
        license: stripHtml(license.LicenseShortName?.value || license.UsageTerms?.value),
        licenseUrl: license.LicenseUrl?.value || "",
        score: titleScore(page.title, dishName)
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

async function findCandidate(dish) {
  if (QUICK_MODE) return findLoremFlickrImage(dish);

  const terms = [
    FALLBACK_TERMS[dish.name] || dish.name,
    `${dish.name} ${dish.cuisineRegion}`,
    `${dish.name} food`
  ];

  try {
    const wikipedia = await findWikipediaImage(terms[0]);
    if (wikipedia) return wikipedia;
  } catch (error) {
    // Continue to Commons search.
  }

  for (const term of terms) {
    try {
      const commons = await findCommonsImage(dish.name, term);
      if (commons) return commons;
    } catch (error) {
      // Try the next term.
    }
    await sleep(150);
  }

  return findLoremFlickrImage(dish);
}

function findLoremFlickrImage(dish) {
  const terms = [dish.name, "food"]
    .join(",")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9,]+/g, ",")
    .replace(/,+/g, ",")
    .replace(/^,|,$/g, "")
    .toLowerCase();
  return {
    dishName: dish.name,
    source: "loremflickr",
    title: `${dish.name} photo search`,
    filePage: `https://loremflickr.com/900/900/${encodeURIComponent(terms)}`,
    imageUrl: `https://loremflickr.com/900/900/${encodeURIComponent(terms)}/all`,
    credit: "",
    license: "review-only source; verify before production use",
    licenseUrl: "",
    score: 0
  };
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function writeManifest(results) {
  const jsonPath = path.join(OUTPUT_DIR, "sources.json");
  const csvPath = path.join(OUTPUT_DIR, "sources.csv");
  fs.writeFileSync(jsonPath, `${JSON.stringify(results, null, 2)}\n`);
  fs.writeFileSync(
    csvPath,
    [
      ["dishName", "file", "status", "source", "title", "filePage", "imageUrl", "license", "licenseUrl", "credit"].map(csvEscape).join(","),
      ...results.map((entry) =>
        [
          entry.dishName,
          entry.file || "",
          entry.status,
          entry.source || "",
          entry.title || "",
          entry.filePage || "",
          entry.imageUrl || "",
          entry.license || "",
          entry.licenseUrl || "",
          entry.credit || ""
        ].map(csvEscape).join(",")
      )
    ].join("\n") + "\n"
  );
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function writeReviewPage(results) {
  const cards = results.map((entry, index) => {
    const image = entry.file
      ? `<img src="${htmlEscape(entry.file)}" alt="${htmlEscape(entry.dishName)}">`
      : `<div class="missing">No photo found</div>`;
    return `<article class="card ${entry.status}">
  <div class="number">${String(index + 1).padStart(3, "0")}</div>
  ${image}
  <h2>${htmlEscape(entry.dishName)}</h2>
  <p>${htmlEscape(entry.title || entry.status)}</p>
  ${entry.filePage ? `<a href="${htmlEscape(entry.filePage)}">source</a>` : ""}
</article>`;
  }).join("\n");

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "index.html"),
    `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Food Photo Review</title>
<style>
body { margin: 0; font-family: Arial, sans-serif; background: #f7f3ee; color: #221b15; }
header { position: sticky; top: 0; z-index: 1; padding: 16px 24px; background: rgba(247, 243, 238, .94); border-bottom: 1px solid #ded3c6; }
h1 { margin: 0; font-size: 22px; }
.meta { margin: 4px 0 0; color: #6f6258; font-size: 14px; }
main { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 16px; padding: 20px; }
.card { position: relative; overflow: hidden; background: #fff; border: 1px solid #dfd5ca; border-radius: 8px; box-shadow: 0 1px 2px rgba(37, 28, 20, .08); }
.number { position: absolute; top: 8px; left: 8px; padding: 4px 6px; border-radius: 6px; background: rgba(0, 0, 0, .72); color: #fff; font-size: 12px; }
img, .missing { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; background: #e9dfd3; }
.missing { display: grid; place-items: center; color: #7a6a5e; font-size: 14px; }
h2 { margin: 10px 10px 4px; font-size: 15px; line-height: 1.25; }
p { min-height: 34px; margin: 0 10px 8px; color: #675a51; font-size: 12px; line-height: 1.35; }
a { display: inline-block; margin: 0 10px 12px; color: #0b6655; font-size: 12px; }
.missing h2 { color: #8b2f21; }
</style>
<body>
<header>
  <h1>Food Photo Review</h1>
  <p class="meta">${results.filter((entry) => entry.status === "downloaded").length} downloaded, ${results.filter((entry) => entry.status !== "downloaded").length} missing</p>
</header>
<main>
${cards}
</main>
</body>
</html>
`
  );
}

async function processDish(dish, index, total) {
  const baseName = `${String(index + 1).padStart(3, "0")}-${slugify(dish.name)}`;
  const existing = fs.readdirSync(OUTPUT_DIR).find((name) => name.startsWith(`${baseName}.`));
  if (existing) {
    return {
      dishName: dish.name,
      file: existing,
      status: "downloaded",
      source: "existing"
    };
  }

  const candidate = await findCandidate(dish);
  if (!candidate) {
    console.log(`[${index + 1}/${total}] missing: ${dish.name}`);
    return { dishName: dish.name, status: "missing" };
  }

  const { buffer, mime } = await fetchBuffer(candidate.imageUrl);
  const ext = EXT_BY_MIME[mime] || path.extname(new URL(candidate.imageUrl).pathname).toLowerCase() || ".jpg";
  const file = `${baseName}${ext === ".jpeg" ? ".jpg" : ext}`;
  fs.writeFileSync(path.join(OUTPUT_DIR, file), buffer);
  console.log(`[${index + 1}/${total}] saved: ${dish.name} -> ${file}`);
  return {
    ...candidate,
    file,
    status: "downloaded"
  };
}

async function runPool(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runWorker() {
    while (next < items.length) {
      const current = next++;
      results[current] = await worker(items[current], current, items.length);
      writeManifest(results.filter(Boolean));
      writeReviewPage(results.filter(Boolean));
      await sleep(REQUEST_DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, runWorker));
  return results;
}

async function main() {
  ensureDir(OUTPUT_DIR);
  const dishes = JSON.parse(fs.readFileSync(DISHES_PATH, "utf8"));
  const results = await runPool(dishes, processDish);
  writeManifest(results);
  writeReviewPage(results);
  const downloaded = results.filter((entry) => entry.status === "downloaded").length;
  const missing = results.length - downloaded;
  console.log(`Done. Downloaded ${downloaded}/${results.length}. Missing ${missing}.`);
  console.log(`Review folder: ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
