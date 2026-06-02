const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { parseJsonConst } = require("./chefle-constants");

const ROOT = path.resolve(__dirname, "..");
const HTML_PATH = path.join(ROOT, "chefle.html");
const JSON_PATH = path.join(ROOT, "chefle-dishes-with-images.json");
function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function startStaticServer() {
  const server = http.createServer((request, response) => {
    try {
      const urlPath = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const relativePath = urlPath === "/" ? "chefle.html" : urlPath.replace(/^\/+/, "");
      const filePath = path.resolve(ROOT, relativePath);
      if (!filePath.startsWith(ROOT + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      response.writeHead(200, { "content-type": contentTypeFor(filePath) });
      fs.createReadStream(filePath).pipe(response);
    } catch (error) {
      response.writeHead(500);
      response.end(String(error.message || error));
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function extractInlineScripts(html) {
  const scripts = [];
  const pattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    scripts.push(match[1]);
  }
  return scripts;
}

function parseRegistry(html) {
  return parseJsonConst(html, "chefleGlobalMasterRegistry");
}

function resolveLocalImagePath(imageUrl) {
  const value = String(imageUrl || "").trim();
  if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(value) || value.includes("\\")) {
    throw new Error(`Unsafe image URL: ${imageUrl}`);
  }
  const filePath = path.resolve(ROOT, value);
  if (!filePath.startsWith(ROOT + path.sep)) throw new Error(`Image URL escapes project root: ${imageUrl}`);
  return filePath;
}

function checkScriptSyntax(script, index) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chefle-script-check-"));
  const filePath = path.join(dir, `inline-${index}.js`);
  try {
    fs.writeFileSync(filePath, script, "utf8");
    const result = spawnSync(process.execPath, ["--check", filePath], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `Inline script ${index} failed syntax check.`);
    }
  } finally {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    fs.rmdirSync(dir);
  }
}

function validateLocalFiles(items, label) {
  const missing = [];
  for (const item of items) {
    if (!item.imageUrl) missing.push(`${item.name}: no imageUrl`);
    else if (!fs.existsSync(resolveLocalImagePath(item.imageUrl))) missing.push(`${item.name}: ${item.imageUrl}`);
  }
  if (missing.length) {
    throw new Error(`${label} missing local files:\n${missing.slice(0, 20).join("\n")}`);
  }
}

async function validateServerImages(items, origin) {
  const failures = [];
  const seen = Array.from(new Set(items.map((item) => item.imageUrl)));
  for (const imageUrl of seen) {
    const response = await fetch(`${origin}/${imageUrl}`);
    if (!response.ok) failures.push(`${response.status} ${imageUrl}`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) failures.push(`${contentType || "no content-type"} ${imageUrl}`);
  }
  if (failures.length) {
    throw new Error(`Server image failures:\n${failures.slice(0, 20).join("\n")}`);
  }
}

async function main() {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  extractInlineScripts(html).forEach(checkScriptSyntax);

  const registry = parseRegistry(html);
  const jsonRegistry = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
  validateLocalFiles(registry, "HTML registry");
  validateLocalFiles(jsonRegistry, "JSON registry");

  const { server, origin } = await startStaticServer();
  try {
    await validateServerImages(registry, origin);
  } finally {
    server.close();
  }

  console.log(JSON.stringify({
    htmlRegistryCount: registry.length,
    jsonRegistryCount: jsonRegistry.length,
    uniqueImageUrls: new Set(registry.map((item) => item.imageUrl)).size,
    inlineScriptsCompiled: extractInlineScripts(html).length
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
