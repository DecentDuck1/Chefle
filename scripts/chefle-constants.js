const crypto = require("crypto");

function extractBracketed(source, marker, open, close) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) throw new Error(`Could not find ${marker}.`);

  const start = source.indexOf(open, markerIndex);
  if (start === -1) throw new Error(`Could not find ${open} after ${marker}.`);

  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }

    if (char === "\"" || char === "'") quote = char;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return { start, end: index + 1, literal: source.slice(start, index + 1) };
      }
    }
  }

  throw new Error(`Could not find ${close} for ${marker}.`);
}

function extractConstLiteral(source, name, open = "[", close = "]") {
  return extractBracketed(source, `const ${name} =`, open, close);
}

function parseJsonLiteral(literal, label) {
  try {
    return JSON.parse(literal);
  } catch (error) {
    throw new Error(`Could not parse ${label} as JSON data: ${error.message}`);
  }
}

function quoteObjectKeys(literal) {
  let output = "";
  let quote = "";
  let escaped = false;

  for (let index = 0; index < literal.length; index += 1) {
    const char = literal[index];
    output += char;

    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (char !== "{" && char !== ",") continue;

    let lookahead = index + 1;
    while (/\s/.test(literal[lookahead] || "")) {
      output += literal[lookahead];
      lookahead += 1;
    }

    const keyStart = lookahead;
    if (!/[A-Za-z_$]/.test(literal[keyStart] || "")) {
      index = lookahead - 1;
      continue;
    }

    lookahead += 1;
    while (/[A-Za-z0-9_$]/.test(literal[lookahead] || "")) lookahead += 1;

    const key = literal.slice(keyStart, lookahead);
    let afterKey = lookahead;
    while (/\s/.test(literal[afterKey] || "")) afterKey += 1;

    if (literal[afterKey] === ":") {
      output += JSON.stringify(key);
      index = lookahead - 1;
    } else {
      output += key;
      index = lookahead - 1;
    }
  }

  return output;
}

function parseJsonConst(source, name, open = "[", close = "]") {
  const range = extractConstLiteral(source, name, open, close);
  return parseJsonLiteral(range.literal, name);
}

function parseJsonObjectConst(source, name) {
  const range = extractConstLiteral(source, name, "{", "}");
  return parseJsonLiteral(quoteObjectKeys(range.literal), name);
}

function inlineScripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
}

function scriptHash(script) {
  return crypto.createHash("sha256").update(script, "utf8").digest("base64");
}

function withUpdatedCspScriptHash(html) {
  if (/script-src[^;]*'unsafe-inline'/.test(html)) return html;

  const scripts = inlineScripts(html);
  if (scripts.length !== 1) throw new Error(`Expected exactly one inline script, found ${scripts.length}.`);

  const metaPattern = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/i;
  const match = html.match(metaPattern);
  if (!match) throw new Error("Could not find Content-Security-Policy meta tag.");

  const hash = scriptHash(scripts[0]);
  const directives = match[2].split(";").map((directive) => directive.trim()).filter(Boolean);
  const scriptDirective = `script-src 'sha256-${hash}'`;
  const nextDirectives = directives.some((directive) => directive.startsWith("script-src "))
    ? directives.map((directive) => directive.startsWith("script-src ") ? scriptDirective : directive)
    : [...directives, scriptDirective];

  return html.replace(metaPattern, `${match[1]}${nextDirectives.join("; ")}${match[3]}`);
}

module.exports = {
  extractBracketed,
  extractConstLiteral,
  inlineScripts,
  parseJsonConst,
  parseJsonLiteral,
  parseJsonObjectConst,
  quoteObjectKeys,
  scriptHash,
  withUpdatedCspScriptHash
};
