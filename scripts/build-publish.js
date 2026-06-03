const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { inlineScripts, parseJsonConst, scriptHash } = require("./chefle-constants");

const ROOT = path.resolve(__dirname, "..");
const HTML_PATH = path.join(ROOT, "chefle.html");
const OUT_DIR = path.join(ROOT, "publish");
const PYTHON = process.env.CODEX_PYTHON || process.env.PYTHON || "python";
const CUSTOM_DOMAIN = "chefle.org";
const ADSENSE_ORIGIN = "https://pagead2.googlesyndication.com";
const LEGAL_PAGES = ["privacy.html", "terms.html", "cookies.html", "accessibility.html", "disclaimer.html"];
const ADSENSE_TEMPLATES = ["ADSENSE.md", "adsense-auto-ads-template.html", "adsense-manual-ad-unit-template.html", "ads.txt.template"];

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

function iframeSnippet() {
  return `<div class="chefle-embed">
  <iframe
    title="Chefle daily food guessing game"
    src="REPLACE_WITH_PUBLIC_CHEFLE_URL"
    loading="lazy"
    style="width:100%;height:min(920px,100svh);border:0;display:block;border-radius:12px;overflow:hidden;"
    allow="clipboard-write"
  ></iframe>
</div>
<style>
  .chefle-embed {
    width: min(1320px, 100%);
    margin: 0 auto;
  }
  @media (max-width: 760px) {
    .chefle-embed iframe { height: 100svh; border-radius: 0; }
  }
</style>
`;
}

function securityHeaders(html) {
  const scripts = inlineScripts(html);
  if (scripts.length !== 1) throw new Error(`Expected one inline app script for CSP hash, found ${scripts.length}.`);
  const hash = scriptHash(scripts[0]);
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'sha256-${hash}' ${ADSENSE_ORIGIN}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net",
    "connect-src 'self' https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net https://*.adtrafficquality.google",
    "frame-src https://googleads.g.doubleclick.net https://tpc.googlesyndication.com",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join("; ");

  return `/*
  Content-Security-Policy: ${csp}
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), xr-spatial-tracking=(), clipboard-write=(self), web-share=(self)
`;
}

function publishHtmlWithHashedCsp(html) {
  const scripts = inlineScripts(html);
  if (scripts.length !== 1) throw new Error(`Expected one inline app script for CSP hash, found ${scripts.length}.`);
  const hash = scriptHash(scripts[0]);
  const metaPattern = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/i;
  const match = html.match(metaPattern);
  if (!match) throw new Error("Could not find Content-Security-Policy meta tag.");

  const directives = match[2].split(";").map((directive) => directive.trim()).filter(Boolean);
  const nextDirectives = directives.map((directive) => (
    directive.startsWith("script-src ")
      ? `script-src 'self' 'sha256-${hash}' ${ADSENSE_ORIGIN}`
      : directive
  ));

  return html.replace(metaPattern, `${match[1]}${nextDirectives.join("; ")}${match[3]}`);
}

function publishingReadme(stats) {
  return `# Chefle Publish Bundle

Generated by \`node scripts/build-publish.js\`.

## Contents

- \`index.html\`: standalone Chefle page.
- \`chefle-logo.png\`: logo used by the page.
- \`assets/food-pattern.svg\` and \`assets/earth-equirectangular.jpg\`: required visual assets.
- \`food-photo-review-specific-only-v3/\`: ${stats.dishImages} optimized production dish images only.
- \`squarespace-iframe-snippet.html\`: paste this into a Squarespace Code Block after replacing \`REPLACE_WITH_PUBLIC_CHEFLE_URL\`.
- Legal/info pages: ${LEGAL_PAGES.map((page) => `\`${page}\``).join(", ")}.
- AdSense setup templates: ${ADSENSE_TEMPLATES.map((page) => `\`${page}\``).join(", ")}.
- \`CNAME\`: custom-domain marker for \`${CUSTOM_DOMAIN}\`.
- \`.nojekyll\`: keeps static assets served as-is on GitHub Pages.
- \`_headers\`: static-host security headers for hosts that support this file format.

## GitHub Pages Deployment

This bundle is built for \`${CUSTOM_DOMAIN}\` through \`.github/workflows/deploy-pages.yml\`. In GitHub repository settings, set Pages to use GitHub Actions, then set the custom domain to \`${CUSTOM_DOMAIN}\`.

GitHub Pages ignores \`_headers\`; the production \`index.html\` still carries the hash-based CSP in a meta tag. Hosts that support \`_headers\` can apply the stronger header policy too.

## Squarespace Recommendation

Use an iframe to embed the standalone page. Do not paste the full app HTML directly into a Squarespace Code Block; that risks global CSS conflicts, stripped head/meta tags, Ajax-loading issues, and asset-path breakage.

Squarespace Code Blocks have a 400 KB code limit. The HTML may fit today, but a Code Block cannot carry the complete image bundle or preserve the standalone document environment, so host the bundle separately and embed the public URL.

Host this folder on a static host or file host that preserves the relative paths exactly. Then put the hosted \`index.html\` URL into \`squarespace-iframe-snippet.html\`.

The generated \`index.html\` and \`_headers\` file use a hash-based script policy. The \`_headers\` file intentionally omits \`X-Frame-Options\` and \`frame-ancestors\` because those can block Squarespace iframe embedding. If you add \`frame-ancestors\` at the host, include your final Squarespace and custom-domain origins.

For Google AdSense setup, read \`ADSENSE.md\`. The AdSense templates are placeholders only and do not turn ads on until you replace them with real Google account values.

## Size

- Optimized bundle: ${stats.totalSize}
- Dish images: ${stats.dishImageSize}

## Squarespace References

- https://support.squarespace.com/hc/en-us/articles/205815928-Adding-custom-code-to-your-site
- https://support.squarespace.com/hc/en-us/articles/206543167-Code-blocks
- https://support.squarespace.com/hc/en-us/articles/206543617-Embed-blocks
`;
}

function main() {
  cleanDir(OUT_DIR);

  const sourceHtml = fs.readFileSync(HTML_PATH, "utf8");
  const html = publishHtmlWithHashedCsp(sourceHtml);
  const registry = parseJsonConst(sourceHtml, "chefleGlobalMasterRegistry");
  const imageUrls = Array.from(new Set(registry.map((dish) => dish.imageUrl))).sort();

  fs.writeFileSync(path.join(OUT_DIR, "index.html"), html, "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "_headers"), securityHeaders(html), "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "CNAME"), `${CUSTOM_DOMAIN}\n`, "utf8");
  fs.writeFileSync(path.join(OUT_DIR, ".nojekyll"), "", "utf8");
  copyFile("chefle-logo.png");
  LEGAL_PAGES.forEach(copyLegalPage);
  ADSENSE_TEMPLATES.forEach(copyFile);
  copyFile(path.join("assets", "food-pattern.svg"));

  const manifest = [
    {
      source: path.join(ROOT, "assets", "earth-equirectangular.jpg"),
      target: path.join(OUT_DIR, "assets", "earth-equirectangular.jpg"),
      maxSize: 1200,
      quality: 76
    },
    ...imageUrls.map((imageUrl) => ({
      source: path.join(ROOT, imageUrl),
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
    throw new Error(`Image optimization failed:\n${result.stderr || result.stdout}`);
  }

  fs.writeFileSync(path.join(OUT_DIR, "squarespace-iframe-snippet.html"), iframeSnippet(), "utf8");

  const dishImageSize = imageUrls.reduce((sum, imageUrl) => sum + fs.statSync(path.join(OUT_DIR, imageUrl)).size, 0);
  const stats = {
    dishImages: imageUrls.length,
    dishImageSize: formatBytes(dishImageSize),
    totalSize: formatBytes(fileSize(OUT_DIR))
  };
  fs.writeFileSync(path.join(OUT_DIR, "README.md"), publishingReadme(stats), "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "publish-manifest.json"), `${JSON.stringify(stats, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(stats, null, 2));
}

main();
