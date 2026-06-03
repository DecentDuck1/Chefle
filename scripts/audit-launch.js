const fs = require("fs");
const path = require("path");
const { inlineScripts, scriptHash } = require("./chefle-constants");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_PAGES = ["chefle.html", "privacy.html", "terms.html", "cookies.html", "accessibility.html", "disclaimer.html"];
const PUBLISH_PAGES = ["index.html", "privacy.html", "terms.html", "cookies.html", "accessibility.html", "disclaimer.html"];
const ADSENSE_CLIENT = "ca-pub-4681241502820822";
const ADSENSE_SCRIPT_SRC = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
const ADSENSE_SCRIPT_ORIGIN = "https://pagead2.googlesyndication.com";

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

function main() {
  const failures = [];
  auditPages("", SOURCE_PAGES, "chefle.html", failures);
  auditPages("publish", PUBLISH_PAGES, "index.html", failures);

  const sourceHtml = read("chefle.html");
  const publishHtml = read("publish/index.html");
  const sourceScripts = inlineScripts(sourceHtml);
  const publishScripts = inlineScripts(publishHtml);
  assert(sourceScripts.length === 1 && publishScripts.length === 1, "Source and publish should each contain one app script.", failures);
  if (sourceScripts.length === 1 && publishScripts.length === 1) {
    assert(scriptHash(sourceScripts[0]) === scriptHash(publishScripts[0]), "publish/index.html app script is not in sync with chefle.html; run node scripts/build-publish.js", failures);
    const publishScriptHash = scriptHash(publishScripts[0]);
    assert(publishHtml.includes(`script-src 'self' 'sha256-${publishScriptHash}' ${ADSENSE_SCRIPT_ORIGIN}`), "publish/index.html CSP script hash or AdSense origin does not match browser-normalized inline script content.", failures);
    assert(read("publish/_headers").includes(`script-src 'self' 'sha256-${publishScriptHash}' ${ADSENSE_SCRIPT_ORIGIN}`), "publish/_headers CSP script hash or AdSense origin does not match browser-normalized inline script content.", failures);
  }
  assert(!/script-src[^;"]*'unsafe-inline'/.test(publishHtml), "publish/index.html script CSP still allows unsafe-inline.", failures);
  for (const page of SOURCE_PAGES) {
    assert(read(page).includes(ADSENSE_SCRIPT_SRC), `${page}: missing AdSense verification script.`, failures);
  }
  for (const page of PUBLISH_PAGES) {
    assert(read(`publish/${page}`).includes(ADSENSE_SCRIPT_SRC), `publish/${page}: missing AdSense verification script.`, failures);
  }
  assert(!/No Primary Protein/.test(sourceHtml + publishHtml), "Old protein label still appears in game HTML.", failures);
  assert(!/(resetFoodButton|devResetStatus|dev-block|Restart Today)/.test(sourceHtml + publishHtml), "Dev food reset control still appears in game HTML.", failures);
  assert(!/ca-pub-0000000000000000/.test(publishHtml), "publish/index.html still contains placeholder AdSense publisher ID.", failures);
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
