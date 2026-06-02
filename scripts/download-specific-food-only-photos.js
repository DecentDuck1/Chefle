const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DISHES_PATH = path.join(ROOT, "chefle-dishes-with-images.json");
const OUTPUT_DIR = path.join(ROOT, "food-photo-review-specific-only-v3");
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";
const MAX_NEW = Number(process.argv.find((arg) => arg.startsWith("--max-new="))?.split("=")[1] || Infinity);
const START_AT = Number(process.argv.find((arg) => arg.startsWith("--start-at="))?.split("=")[1] || 1);
const MISSING_ONLY = process.argv.includes("--missing-only");
const ALLOW_STOCK_FALLBACK = process.argv.includes("--allow-stock-fallback");
const REQUEST_DELAY_MS = 650;
const REJECTED_DIR = path.join(OUTPUT_DIR, "rejected");

const MANUAL_REJECTS = new Set([
  49, // visible watermark
  53, // includes extra dipping foods rather than just fondue
  61, // graphic background
  71, // raw beef, not beef goulash
  72, // chicken noodle soup, not chicken tortilla soup
  75, // wrong soup type
  84, // wrong soup type
  108, // raw steak, not cooked ribeye steak
  115, // table scene
  116, // table scene
  138, // side food dominates
  139, // side pasta dominates
  146, // table scene
  167, // table/drink scene
  172, // dark restaurant scene
  180, // dark splash/extra styling
  183, // table/utensil scene
  184, // table scene
  187, // wrong dish, burger
  198, // table/utensil scene
  208, // takeout packaging
  228, // table scene
  229, // retail packaging
  234, // raw corn, not elote
  250  // spoon/table scene
]);

const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif"
};

const DISH_HINTS = {
  "Acai Bowl": "açaí bowl",
  "Oatmeal": "cooked oatmeal porridge bowl",
  "Cheese Fondue": "melted cheese fondue pot",
  "Macaroni Salad": "macaroni salad bowl",
  "Italian Wedding Soup": "italian wedding soup bowl",
  "Classic French Omelette": "French omelette",
  "Cottage Pie": "cottage pie",
  "Salisbury Steak": "salisbury steak patty gravy",
  "Mongolian Beef": "mongolian beef dish",
  "Classic Cheeseburger": "cheeseburger",
  "Sunday Roast Beef": "roast beef",
  "Duck à l'Orange": "duck a l orange dish",
  "Paella Valenciana": "paella valenciana pan",
  "Baked Cod": "baked cod fillet",
  "Linguine with Clams": "linguine with clams pasta",
  "Shrimp Jambalaya": "shrimp jambalaya bowl",
  "Singapore Noodles": "singapore noodles bowl",
  "Vegetarian Chili": "vegetarian chili bowl",
  "Lentil Dahl": "lentil dal bowl",
  "Beef Chimichanga": "beef chimichanga",
  "Classic Roast Chicken": "roast chicken",
  "California Sushi Rolls": "California roll sushi",
  "Classic Ceviche": "ceviche",
  "Classic Hot Dog": "hot dog",
  "Potato and Pea Samosas": "samosa potato peas",
  "Key Lime Pie": "key lime pie slice",
  "Lemon Meringue Tart": "lemon meringue tart slice",
  "Pecan Pie": "pecan pie slice",
  "Chocolate Mousse": "chocolate mousse cup",
  "Churros": "churros",
  "Gelato": "gelato scoop bowl",
  "Panna Cotta": "panna cotta",
  "French Macarons": "macarons",
  "Chocolate Éclairs": "chocolate eclair",
  "Baklava": "baklava pastry",
  "Bread and Butter Pudding": "bread butter pudding",
  "Sticky Toffee Pudding": "sticky toffee pudding",
  "Strawberry Shortcake": "strawberry shortcake slice",
  "Peach Cobbler": "peach cobbler bowl",
  "Pavlova": "pavlova dessert",
  "Glazed Donuts": "glazed doughnut",
  "Waffles with Ice Cream": "waffle ice cream dessert",
  "Blueberry Muffins": "blueberry muffin",
  "Butter Croissant": "butter croissant"
};

const SEARCH_REJECT_TERMS = [
  "people",
  "person",
  "hand",
  "chef",
  "restaurant",
  "table",
  "menu",
  "logo",
  "icon",
  "cartoon",
  "drawing",
  "illustration",
  "vector",
  "clipart",
  "infographic",
  "packaging",
  "grocery",
  "raw ingredients",
  "recipe card",
  "watermark"
];

const WATERMARK_SOURCE_TERMS = [
  "alamy.com",
  "dreamstime.com",
  "stock.adobe.com",
  "ftcdn.net",
  "shutterstock.com",
  "istockphoto.com",
  "gettyimages",
  "depositphotos.com",
  "123rf.com",
  "bigstockphoto.com",
  "pond5.com",
  "vecteezy.com",
  "static.vecteezy.com"
];

const PREFERRED_SOURCE_TERMS = [
  "freepik.com",
  "img.freepik.com",
  "wikimedia.org",
  "thf.bing.com",
  "tse"
];

const TOKEN_IGNORE = new Set([
  "and",
  "with",
  "classic",
  "southern",
  "new",
  "york",
  "french",
  "italian",
  "american",
  "style"
]);

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

function simplify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlDecode(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function existingImageFile(baseName) {
  return fs.readdirSync(OUTPUT_DIR).find((file) => {
    return file.startsWith(`${baseName}.`) && /\.(jpg|jpeg|png|webp|avif)$/i.test(file);
  });
}

function quarantineRejectedExisting(index, file) {
  if (!file || !MANUAL_REJECTS.has(index)) return false;
  ensureDir(REJECTED_DIR);
  const from = path.join(OUTPUT_DIR, file);
  const to = path.join(REJECTED_DIR, file);
  if (fs.existsSync(from)) {
    fs.renameSync(from, to);
    return true;
  }
  return false;
}

function readManifest() {
  const manifestPath = path.join(OUTPUT_DIR, "sources.json");
  if (!fs.existsSync(manifestPath)) return [];
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function writeManifest(entries) {
  const manifestPath = path.join(OUTPUT_DIR, "sources.json");
  const csvPath = path.join(OUTPUT_DIR, "sources.csv");
  safeWriteFile(manifestPath, `${JSON.stringify(entries, null, 2)}\n`);
  const header = ["index", "dishName", "file", "status", "query", "title", "pageUrl", "imageUrl", "reason"];
  const rows = entries.map((entry) => header.map((key) => csvEscape(entry[key] || "")).join(","));
  safeWriteFile(csvPath, [header.map(csvEscape).join(","), ...rows].join("\n") + "\n");
}

function safeWriteFile(filePath, content) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      fs.writeFileSync(filePath, content);
      return true;
    } catch (error) {
      if (attempt === 5) {
        console.warn(`Could not write ${filePath}: ${error.message}`);
        return false;
      }
    }
  }
  return false;
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function queryForDish(dish) {
  const name = DISH_HINTS[dish.name] || dish.name;
  const simple = simplify(name);
  return [
    `"${simple}" isolated on white background food photo no watermark`,
    `"${simple}" isolated food photo clean white background`,
    `"${simple}" cut out food photo no text`
  ];
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml"
    }
  }, 12_000);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchJson(url, referer) {
  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Referer": referer || "https://duckduckgo.com/"
    }
  }, 12_000);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchImage(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
      "Referer": "https://www.bing.com/"
    }
  }, 18_000);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const mime = response.headers.get("content-type")?.split(";")[0].toLowerCase() || "";
  if (!EXT_BY_MIME[mime]) throw new Error(`not a supported image: ${mime}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 12_000) throw new Error("image too small");
  if (!looksLikeImage(buffer, mime)) throw new Error("invalid image header");
  return { buffer, mime };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function looksLikeImage(buffer, mime) {
  if (mime === "image/jpeg" || mime === "image/jpg") return buffer[0] === 0xff && buffer[1] === 0xd8;
  if (mime === "image/png") return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if (mime === "image/webp") return buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP";
  if (mime === "image/avif") return buffer.slice(4, 12).toString("ascii") === "ftypavif" || buffer.slice(4, 12).toString("ascii") === "ftypavis";
  return false;
}

function parseBingCandidates(html) {
  const decoded = htmlDecode(html);
  const candidates = [];
  const seen = new Set();
  const objectPatterns = [
    /m="\{([^"]*?murl[^"]*?)\}"/g,
    /m='(\{[^']*?murl[^']*?\})'/g,
    /\{&quot;murl&quot;:[\s\S]*?&quot;turl&quot;:[\s\S]*?\}/g,
    /\{"murl":"[\s\S]*?"turl":"[\s\S]*?\}/g
  ];

  for (const pattern of objectPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const raw = htmlDecode(match[0].startsWith("{") ? match[0] : `{${match[1] || ""}}`);
      const parsed = parseLooseJson(raw);
      addCandidate(candidates, seen, parsed);
    }
  }

  const murlPattern = /"murl"\s*:\s*"([^"]+)"/g;
  let match;
  while ((match = murlPattern.exec(decoded)) !== null) {
    addCandidate(candidates, seen, { murl: match[1] });
  }

  return candidates;
}

function parseLooseJson(raw) {
  const normalized = raw
    .replace(/^m="/, "")
    .replace(/"$/, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
  try {
    return JSON.parse(normalized);
  } catch {
    const result = {};
    for (const key of ["murl", "turl", "purl", "t", "desc"]) {
      const match = normalized.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
      if (match) result[key] = match[1].replace(/\\\//g, "/");
    }
    return result;
  }
}

function addCandidate(candidates, seen, candidate) {
  const imageUrl = htmlDecode(candidate?.murl || "");
  if (!imageUrl || seen.has(imageUrl)) return;
  if (!/^https?:\/\//i.test(imageUrl)) return;
  if (/\.(svg|gif)(\?|$)/i.test(imageUrl)) return;
  seen.add(imageUrl);
  candidates.push({
    imageUrl,
    thumbUrl: htmlDecode(candidate.turl || ""),
    pageUrl: htmlDecode(candidate.purl || ""),
    title: htmlDecode(candidate.t || candidate.desc || "")
  });
}

function coreTokens(dishName) {
  return simplify(dishName)
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/'s$/, ""))
    .filter((token) => token.length > 2 && !TOKEN_IGNORE.has(token));
}

function tokenVariants(token) {
  const variants = new Set([token]);
  if (token.endsWith("s") && token.length > 4) variants.add(token.slice(0, -1));
  const synonyms = {
    dahl: ["dal"],
    dal: ["dahl"],
    donuts: ["donut", "doughnut", "doughnuts"],
    donut: ["donuts", "doughnut", "doughnuts"],
    eclairs: ["eclair"],
    macarons: ["macaron"],
    waffles: ["waffle"],
    clams: ["clam"],
    noodles: ["noodle"],
    mussels: ["mussel"],
    scallops: ["scallop"],
    rolls: ["roll"],
    tacos: ["taco"]
  };
  for (const synonym of synonyms[token] || []) variants.add(synonym);
  return Array.from(variants);
}

function candidateScore(candidate, dishName, query) {
  const haystack = `${candidate.title} ${candidate.imageUrl} ${candidate.pageUrl}`.toLowerCase();
  if (WATERMARK_SOURCE_TERMS.some((term) => haystack.includes(term))) {
    if (!ALLOW_STOCK_FALLBACK) return -100;
  }
  if (/\b(raw|uncooked|ingredient|ingredients|marble board|premium psd|psd)\b/.test(haystack)) return -100;
  if (/chicken tortilla soup|hot and sour soup/.test(dishName.toLowerCase()) && /\bnoodle\b/.test(haystack)) return -100;
  const tokens = coreTokens(dishName);
  const matched = tokens.filter((token) => tokenVariants(token).some((variant) => haystack.includes(variant)));
  const needed = tokens.length;
  if (matched.length < needed) return -100;
  let score = 0;
  score += matched.length * 5;
  if (haystack.includes("isolated")) score += 6;
  if (haystack.includes("white background")) score += 5;
  if (haystack.includes("cutout") || haystack.includes("cut-out") || haystack.includes("cut out")) score += 4;
  if (haystack.includes("single")) score += 2;
  if (haystack.includes("no people") || haystack.includes("nobody")) score += 2;
  if (/\b(stock|photo|jpg|jpeg)\b/.test(haystack)) score += 1;
  for (const term of SEARCH_REJECT_TERMS) {
    if (haystack.includes(term)) score -= 8;
  }
  for (const term of PREFERRED_SOURCE_TERMS) {
    if (haystack.includes(term)) score += 3;
  }
  if (ALLOW_STOCK_FALLBACK && WATERMARK_SOURCE_TERMS.some((term) => haystack.includes(term))) score -= 8;
  if (/\b(vector|illustration|clipart|icon|logo|cartoon|drawing)\b/.test(haystack)) score -= 12;
  if (!query.toLowerCase().includes("table") && /\b(table|restaurant|menu)\b/.test(haystack)) score -= 10;
  return score;
}

function duckVqd(html) {
  const patterns = [
    /vqd="([^"]+)"/,
    /vqd='([^']+)'/,
    /vqd=([^&"']+)/,
    /"vqd":"([^"]+)"/
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return "";
}

async function findDuckDuckGoCandidates(dish) {
  for (const query of queryForDish(dish)) {
    const landing = new URL("https://duckduckgo.com/");
    landing.search = new URLSearchParams({ q: query, iax: "images", ia: "images" }).toString();
    try {
      const html = await fetchText(landing);
      const vqd = duckVqd(html);
      if (!vqd) continue;

      const api = new URL("https://duckduckgo.com/i.js");
      api.search = new URLSearchParams({
        l: "us-en",
        o: "json",
        q: query,
        vqd,
        f: ",,,",
        p: "1"
      }).toString();
      const json = await fetchJson(api, landing.toString());
      const candidates = (json.results || [])
        .map((result) => ({
          imageUrl: result.image,
          thumbUrl: result.thumbnail,
          pageUrl: result.url,
          title: result.title || result.height ? `${result.title || ""} ${result.width || ""}x${result.height || ""}` : "",
          query
        }))
        .filter((candidate) => candidate.imageUrl && /^https?:\/\//i.test(candidate.imageUrl))
        .map((candidate) => ({ ...candidate, query, score: candidateScore(candidate, dish.name, query) }))
        .filter((candidate) => candidate.score >= 12)
        .sort((a, b) => b.score - a.score);
      if (candidates.length) return candidates;
    } catch {
      // Try the next query.
    }
    await sleep(REQUEST_DELAY_MS);
  }
  return [];
}

async function downloadDish(dish, index) {
  const baseName = `${String(index + 1).padStart(3, "0")}-${slugify(dish.name)}`;
  const existing = existingImageFile(baseName);
  if (existing && !MANUAL_REJECTS.has(index + 1)) {
    return {
      index: index + 1,
      dishName: dish.name,
      file: existing,
      status: "downloaded",
      reason: "already present"
    };
  }
  if (existing) quarantineRejectedExisting(index + 1, existing);

  const candidates = await findDuckDuckGoCandidates(dish);
  const errors = [];
  for (const candidate of candidates.slice(0, 10)) {
    const isStockCandidate = WATERMARK_SOURCE_TERMS.some((term) => {
      const haystack = `${candidate.imageUrl} ${candidate.pageUrl}`.toLowerCase();
      return haystack.includes(term);
    });
    const urls = (isStockCandidate ? [candidate.thumbUrl, candidate.imageUrl] : [candidate.imageUrl, candidate.thumbUrl]).filter(Boolean);
    for (const imageUrl of urls) {
      try {
        const { buffer, mime } = await fetchImage(imageUrl);
        const ext = EXT_BY_MIME[mime] || ".jpg";
        const file = `${baseName}${ext}`;
        fs.writeFileSync(path.join(OUTPUT_DIR, file), buffer);
        return {
          index: index + 1,
          dishName: dish.name,
          file,
          status: "downloaded",
          query: candidate.query,
          title: candidate.title,
          pageUrl: candidate.pageUrl,
          imageUrl,
          reason: "isolated image-search candidate"
        };
      } catch (error) {
        errors.push(`${candidate.imageUrl}: ${error.message}`);
      }
      await sleep(120);
    }
  }

  return {
    index: index + 1,
    dishName: dish.name,
    status: "missing",
    reason: errors.slice(0, 3).join(" | ") || "no candidates"
  };
}

function writeReviewPage(entries) {
  const downloaded = entries.filter((entry) => entry.status === "downloaded").length;
  const missing = entries.filter((entry) => entry.status !== "downloaded").length;
  const cards = entries.map((entry) => {
    const image = entry.file
      ? `<img src="${htmlEscape(entry.file)}" alt="${htmlEscape(entry.dishName)}">`
      : `<div class="missing">Missing</div>`;
    return `<article class="card ${htmlEscape(entry.status)}">
  <div class="number">${String(entry.index).padStart(3, "0")}</div>
  ${image}
  <h2>${htmlEscape(entry.dishName)}</h2>
  <p>${htmlEscape(entry.title || entry.reason || entry.status)}</p>
  ${entry.pageUrl ? `<a href="${htmlEscape(entry.pageUrl)}">source</a>` : ""}
</article>`;
  }).join("\n");

  safeWriteFile(
    path.join(OUTPUT_DIR, "index.html"),
    `<!doctype html>
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
  <p class="meta">${downloaded} downloaded, ${missing} missing. Search terms require isolated food on a white/plain background and reject people, menus, table scenes, and illustrations.</p>
</header>
<main>
${cards}
</main>
</body>
</html>
`
  );
}

async function main() {
  ensureDir(OUTPUT_DIR);
  const dishes = JSON.parse(fs.readFileSync(DISHES_PATH, "utf8"));
  const manifestByIndex = new Map(readManifest().map((entry) => [entry.index, entry]));
  let newDownloads = 0;

  for (let index = START_AT - 1; index < dishes.length; index += 1) {
    const dish = dishes[index];
    const baseName = `${String(index + 1).padStart(3, "0")}-${slugify(dish.name)}`;
    const alreadyPresent = existingImageFile(baseName);
    if (alreadyPresent && (MISSING_ONLY || !MANUAL_REJECTS.has(index + 1))) {
      manifestByIndex.set(index + 1, {
        ...(manifestByIndex.get(index + 1) || {}),
        index: index + 1,
        dishName: dish.name,
        file: alreadyPresent,
        status: "downloaded"
      });
      continue;
    }
    if (alreadyPresent) quarantineRejectedExisting(index + 1, alreadyPresent);

    if (newDownloads >= MAX_NEW) break;
    const result = await downloadDish(dish, index);
    manifestByIndex.set(index + 1, result);
    const entries = dishes.map((item, itemIndex) => manifestByIndex.get(itemIndex + 1) || {
      index: itemIndex + 1,
      dishName: item.name,
      status: "pending"
    });
    writeManifest(entries);
    writeReviewPage(entries);
    if (result.status === "downloaded") {
      newDownloads += 1;
      console.log(`[${result.index}/${dishes.length}] saved: ${result.dishName} -> ${result.file}`);
    } else {
      console.log(`[${result.index}/${dishes.length}] missing: ${result.dishName} (${result.reason})`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  const finalEntries = dishes.map((dish, index) => manifestByIndex.get(index + 1) || {
    index: index + 1,
    dishName: dish.name,
    status: "pending"
  });
  writeManifest(finalEntries);
  writeReviewPage(finalEntries);
  const downloaded = finalEntries.filter((entry) => entry.status === "downloaded").length;
  const missing = finalEntries.filter((entry) => entry.status === "missing").length;
  const pending = finalEntries.filter((entry) => entry.status === "pending").length;
  console.log(`Done. Downloaded ${downloaded}/${dishes.length}. Missing ${missing}. Pending ${pending}.`);
  console.log(`Review folder: ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
