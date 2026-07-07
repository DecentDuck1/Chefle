const fs = require("fs");
const path = require("path");
const { inlineScripts } = require("./chefle-constants");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_PAGES = ["chefle.html", "about.html", "how-to-play.html", "food-clues.html", "contact.html", "privacy.html", "terms.html", "cookies.html", "accessibility.html", "disclaimer.html"];
const PUBLISH_PAGES = ["index.html", "about.html", "how-to-play.html", "food-clues.html", "contact.html", "privacy.html", "terms.html", "cookies.html", "accessibility.html", "disclaimer.html"];
const AD_CSP_SCRIPT_DIRECTIVE = "script-src 'self' 'unsafe-inline' https:";
const AD_CSP_FRAME_DIRECTIVE = "frame-src https:";
const NATIVE_AD_SCRIPT_SOURCE = "https://pl30249834.effectivecpmnetwork.com/aa279291e14979c0366cfb9f53773392/invoke.js";
const DISPLAY_AD_SCRIPT_SOURCE = "https://www.highperformanceformat.com/c5bca2546625cae1a377f1152785c4d1/invoke.js";
const DISPLAY_AD_STATIC_SNIPPET_COUNT = 3;
const AD_CONTAINER_ID = "container-aa279291e14979c0366cfb9f53773392";
const REMOVED_GOOGLE_AD_PATTERN = /pagead2\.googlesyndication\.com|googlesyndication|googleads\.g\.doubleclick\.net|adtrafficquality\.google|adsbygoogle|ca-pub-/i;
const NON_PUBLIC_PUBLISH_FILES = [
  "publish/README.md",
  "publish/publish-manifest.json",
  "publish/squarespace-iframe-snippet.html"
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

function isExternalReference(value) {
  return /^(?:https?:|mailto:|tel:|#|data:)/i.test(value) || value.startsWith("REPLACE_WITH_");
}

function localTarget(pagePath, value) {
  const clean = value.split("#")[0].split("?")[0];
  if (!clean || isExternalReference(clean)) return null;
  return path.normalize(path.join(path.dirname(pagePath), clean)).replace(/\\/g, "/");
}

function linkedValues(html) {
  return Array.from(html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi), (match) => match[1]);
}

function duplicateIds(html) {
  const ids = new Map();
  for (const match of html.matchAll(/\bid=["']([^"']+)["']/gi)) {
    ids.set(match[1], (ids.get(match[1]) || 0) + 1);
  }
  return Array.from(ids.entries()).filter(([, count]) => count > 1).map(([id]) => id);
}

function auditPages(prefix, pages, expectedReturnHref, failures) {
  for (const page of pages) {
    const pagePath = prefix ? `${prefix}/${page}` : page;
    assert(exists(pagePath), `Missing page: ${pagePath}`, failures);
    if (!exists(pagePath)) continue;

    const html = read(pagePath);
    assert(/<title>[^<]+<\/title>/i.test(html), `${pagePath}: missing title`, failures);
    assert(/<meta\s+name=["']description["']/i.test(html), `${pagePath}: missing meta description`, failures);
    assert(/<meta\s+name=["']theme-color["']/i.test(html), `${pagePath}: missing theme color`, failures);
    assert(/<link\s+rel=["']icon["'][^>]+href=["']chefle-logo\.png["']/i.test(html), `${pagePath}: missing favicon link`, failures);
    assert(!/\bhref=["']javascript:/i.test(html), `${pagePath}: javascript: href is not launch-safe`, failures);

    const ids = duplicateIds(html);
    assert(!ids.length, `${pagePath}: duplicate ids: ${ids.join(", ")}`, failures);

    for (const value of linkedValues(html)) {
      const target = localTarget(pagePath, value);
      if (target) assert(exists(target), `${pagePath}: broken local reference ${value} -> ${target}`, failures);
    }

    for (const anchor of html.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/gi)) {
      assert(/\brel=["'][^"']*\bnoopener\b/i.test(anchor[0]), `${pagePath}: target=_blank link missing rel=noopener`, failures);
    }

    if (page !== "chefle.html" && page !== "index.html") {
      assert(html.includes(`href="${expectedReturnHref}"`), `${pagePath}: return link should point to ${expectedReturnHref}`, failures);
    }
  }
}

function auditAdSnippet(relativePath, failures) {
  const html = read(relativePath);
  const headEnd = html.search(/<\/head>/i);
  const body = headEnd >= 0 ? html.slice(headEnd) : html;
  assert(html.includes(`src="${NATIVE_AD_SCRIPT_SOURCE}"`), `${relativePath}: missing configured native ad script`, failures);
  assert(body.includes(`src="${NATIVE_AD_SCRIPT_SOURCE}"`), `${relativePath}: native ad script should be placed in the page body`, failures);
  assert(html.includes(`id="${AD_CONTAINER_ID}"`), `${relativePath}: missing configured ad container`, failures);
  assert(body.includes(`id="${AD_CONTAINER_ID}"`), `${relativePath}: configured ad container should be placed in the page body`, failures);
  const displayScriptCount = (html.match(new RegExp(`src="${DISPLAY_AD_SCRIPT_SOURCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "g")) || []).length;
  const displayOptionsCount = (html.match(/atOptions\s*=\s*\{\s*'key'\s*:\s*'c5bca2546625cae1a377f1152785c4d1'/g) || []).length;
  assert(displayScriptCount === DISPLAY_AD_STATIC_SNIPPET_COUNT, `${relativePath}: expected ${DISPLAY_AD_STATIC_SNIPPET_COUNT} static display ad script, found ${displayScriptCount}`, failures);
  assert(displayOptionsCount === DISPLAY_AD_STATIC_SNIPPET_COUNT, `${relativePath}: expected ${DISPLAY_AD_STATIC_SNIPPET_COUNT} static display ad option block, found ${displayOptionsCount}`, failures);
  assert(body.includes(`src="${DISPLAY_AD_SCRIPT_SOURCE}"`), `${relativePath}: display ad script should be placed in the page body`, failures);
  ["ad-side-left", "ad-side-right", "ad-bottom-banner"].forEach((className) => {
    assert(html.includes(className), `${relativePath}: missing ${className} placement`, failures);
  });
}

function auditRemovedGoogleAds(relativePath, failures) {
  if (!exists(relativePath)) return;
  assert(!REMOVED_GOOGLE_AD_PATTERN.test(read(relativePath)), `${relativePath}: removed Google ad code is still present.`, failures);
}

function main() {
  const failures = [];
  auditPages("", SOURCE_PAGES, "chefle.html", failures);
  auditPages("publish", PUBLISH_PAGES, "index.html", failures);
  for (const file of NON_PUBLIC_PUBLISH_FILES) {
    assert(!exists(file), `${file}: setup/template file should not be deployed publicly.`, failures);
  }

  const sourceHtml = read("chefle.html");
  const publishHtml = read("publish/index.html");
  const sourceScripts = inlineScripts(sourceHtml);
  const publishScripts = inlineScripts(publishHtml);
  assert(sourceScripts.length === publishScripts.length && sourceScripts.length > 0, "Source and publish should contain the same inline scripts.", failures);
  if (sourceScripts.length === publishScripts.length && sourceScripts.length > 0) {
    assert(JSON.stringify(sourceScripts) === JSON.stringify(publishScripts), "publish/index.html inline scripts are not in sync with chefle.html; run node scripts/build-publish.js", failures);
    assert(publishHtml.includes(AD_CSP_SCRIPT_DIRECTIVE), "publish/index.html CSP should allow ad provider inline/bootstrap scripts.", failures);
    assert(publishHtml.includes(AD_CSP_FRAME_DIRECTIVE), "publish/index.html CSP should allow ad provider frames.", failures);
    assert(read("publish/_headers").includes(AD_CSP_SCRIPT_DIRECTIVE), "publish/_headers CSP should allow ad provider inline/bootstrap scripts.", failures);
    assert(read("publish/_headers").includes(AD_CSP_FRAME_DIRECTIVE), "publish/_headers CSP should allow ad provider frames.", failures);
  }
  auditAdSnippet("chefle.html", failures);
  auditAdSnippet("publish/index.html", failures);
  [...SOURCE_PAGES, ...PUBLISH_PAGES.map((page) => `publish/${page}`), "publish/_headers"].forEach((page) => auditRemovedGoogleAds(page, failures));
  assert(!/No Primary Protein/.test(sourceHtml + publishHtml), "Old protein label still appears in game HTML.", failures);
  assert(!/(resetFoodButton|devResetStatus|dev-block|Restart Today)/.test(sourceHtml + publishHtml), "Dev food reset control still appears in game HTML.", failures);
  assert(read("publish/_headers").includes("Content-Security-Policy:"), "publish/_headers missing CSP.", failures);
  assert(read("publish/CNAME").trim() === "chefle.org", "publish/CNAME should point to chefle.org.", failures);
  assert(exists("publish/.nojekyll"), "publish/.nojekyll is missing.", failures);

  if (failures.length) {
    throw new Error(failures.join("\n"));
  }
  console.log(JSON.stringify({
    sourcePages: SOURCE_PAGES.length,
    publishPages: PUBLISH_PAGES.length,
    status: "launch audit passed"
  }, null, 2));
}

main();
