const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { parseJsonConst } = require("./chefle-constants");

const ROOT = path.resolve(__dirname, "..");
const HTML_PATH = path.join(ROOT, "chefle.html");
const OUT_DIR = path.join(ROOT, "publish");
const PYTHON = process.env.CODEX_PYTHON || process.env.PYTHON || "python";
const CUSTOM_DOMAIN = "chefle.org";
const PUBLISH_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https: data:",
  "img-src 'self' data: https:",
  "connect-src 'self' https:",
  "frame-src https:",
  "child-src https:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join("; ");
const LEGAL_PAGES = ["about.html", "how-to-play.html", "food-clues.html", "contact.html", "privacy.html", "terms.html", "cookies.html", "accessibility.html", "disclaimer.html"];

function assertInsideRoot(target) {
  const resolved = path.resolve(target);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    throw new Error(`Refusing to write outside project root: ${resolved}`);
  }
  return resolved;
}

function cleanDir(dir) {
  const resolved = assertInsideRoot(dir);
  if (fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
}

function copyFile(relativePath) {
  const source = path.join(ROOT, relativePath);
  const target = path.join(OUT_DIR, relativePath);
  if (!fs.existsSync(source)) throw new Error(`Missing publish asset: ${relativePath}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyLegalPage(relativePath) {
  const source = path.join(ROOT, relativePath);
  const target = path.join(OUT_DIR, relativePath);
  if (!fs.existsSync(source)) throw new Error(`Missing publish legal page: ${relativePath}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const html = fs.readFileSync(source, "utf8").replace(/href="chefle\.html"/g, 'href="index.html"');
  fs.writeFileSync(target, html, "utf8");
}

function fileSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) total += fileSize(filePath);
    else if (entry.isFile()) total += fs.statSync(filePath).size;
  }
  return total;
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function prepareDishImageSources(imageUrls) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chefle-publish-images-"));
  const imageSources = new Map();
  let fallbackCopies = 0;

  for (const imageUrl of imageUrls) {
    const rootSource = path.join(ROOT, imageUrl);
    if (fs.existsSync(rootSource)) {
      imageSources.set(imageUrl, { source: rootSource, optimize: true });
      continue;
    }

    const publishSource = path.join(OUT_DIR, imageUrl);
    if (!fs.existsSync(publishSource)) {
      throw new Error(`Missing source image for ${imageUrl}. Expected ${rootSource} or ${publishSource}.`);
    }

    const backupSource = path.join(tempDir, imageUrl);
    fs.mkdirSync(path.dirname(backupSource), { recursive: true });
    fs.copyFileSync(publishSource, backupSource);
    imageSources.set(imageUrl, { source: backupSource, optimize: false });
    fallbackCopies += 1;
  }

  if (!fallbackCopies) fs.rmSync(tempDir, { recursive: true, force: true });
  return {
    imageSources,
    tempDir: fallbackCopies ? tempDir : null
  };
}

function securityHeaders() {
  return `/*
  Content-Security-Policy: ${PUBLISH_CSP}
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), xr-spatial-tracking=(), clipboard-write=(self), web-share=(self)
`;
}

function publishHtmlWithAdFriendlyCsp(html) {
  const metaPattern = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/i;
  const match = html.match(metaPattern);
  if (!match) throw new Error("Could not find Content-Security-Policy meta tag.");
  return html.replace(metaPattern, `${match[1]}${PUBLISH_CSP}${match[3]}`);
}

function main() {
  const sourceHtml = fs.readFileSync(HTML_PATH, "utf8");
  const html = publishHtmlWithAdFriendlyCsp(sourceHtml);
  const registry = parseJsonConst(sourceHtml, "chefleGlobalMasterRegistry");
  const imageUrls = Array.from(new Set(registry.map((dish) => dish.imageUrl))).sort();
  const { imageSources, tempDir } = prepareDishImageSources(imageUrls);

  try {
    cleanDir(OUT_DIR);

    fs.writeFileSync(path.join(OUT_DIR, "index.html"), html, "utf8");
    fs.writeFileSync(path.join(OUT_DIR, "_headers"), securityHeaders(), "utf8");
    fs.writeFileSync(path.join(OUT_DIR, "CNAME"), `${CUSTOM_DOMAIN}\n`, "utf8");
    fs.writeFileSync(path.join(OUT_DIR, ".nojekyll"), "", "utf8");
    copyFile("chefle-logo.png");
    LEGAL_PAGES.forEach(copyLegalPage);
    copyFile(path.join("assets", "food-pattern.svg"));

    const manifest = [
      {
        source: path.join(ROOT, "assets", "earth-equirectangular.jpg"),
        target: path.join(OUT_DIR, "assets", "earth-equirectangular.jpg"),
        maxSize: 1200,
        quality: 76
      },
      ...imageUrls.filter((imageUrl) => imageSources.get(imageUrl).optimize).map((imageUrl) => ({
        source: imageSources.get(imageUrl).source,
        target: path.join(OUT_DIR, imageUrl),
        maxSize: 520,
        quality: 78
      }))
    ];

    const manifestPath = path.join(OUT_DIR, ".image-optimization-manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    const result = spawnSync(PYTHON, [path.join(ROOT, "scripts", "optimize-publish-images.py"), manifestPath], {
      encoding: "utf8"
    });
    fs.rmSync(manifestPath, { force: true });
    if (result.status !== 0) {
      throw new Error(`Image optimization failed:\n${result.stderr || result.stdout || result.error}`);
    }

    for (const imageUrl of imageUrls) {
      const imageSource = imageSources.get(imageUrl);
      if (imageSource.optimize) continue;
      const target = path.join(OUT_DIR, imageUrl);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(imageSource.source, target);
    }

    const dishImageSize = imageUrls.reduce((sum, imageUrl) => sum + fs.statSync(path.join(OUT_DIR, imageUrl)).size, 0);
    const stats = {
      dishImages: imageUrls.length,
      dishImageSize: formatBytes(dishImageSize),
      totalSize: formatBytes(fileSize(OUT_DIR))
    };

    console.log(JSON.stringify(stats, null, 2));
  } finally {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
