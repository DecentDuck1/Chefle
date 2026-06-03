const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseJsonConst } = require("./chefle-constants");

const root = path.resolve(__dirname, "..");
const publishPath = path.join(root, "publish", "index.html");
const targetUrl = "file:///" + publishPath.replace(/\\/g, "/");
const publishHtml = fs.existsSync(publishPath) ? fs.readFileSync(publishPath, "utf8") : "";
const dataVersion = (publishHtml.match(/const DATA_VERSION = "([^"]+)"/) || [])[1] || "";
const gameNumberStartDate = (publishHtml.match(/const GAME_NUMBER_START_DATE = "([^"]+)"/) || [])[1] || "";
const recentTargetLookbackDays = Number((publishHtml.match(/const RECENT_TARGET_LOOKBACK_DAYS = (\d+)/) || [])[1] || 0);
const registry = publishHtml ? parseJsonConst(publishHtml, "chefleGlobalMasterRegistry") : [];
const gameKey = "chefle:regional-temp:v3:game";
const statsKey = "chefle:regional-temp:v3:stats";
const requiredFooterLinks = ["privacy.html", "terms.html", "cookies.html", "accessibility.html", "disclaimer.html"];
const chromePaths = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
];

function findChrome() {
  const chrome = chromePaths.find((candidate) => fs.existsSync(candidate));
  if (!chrome) throw new Error("Could not find installed Chrome.");
  return chrome;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const targetNameCache = new Map();

function targetRankForDate(dateKey, dish) {
  return hashString(`target:${dataVersion}:${dateKey}:${dish.name}`);
}

function targetNameForDate(dateKey) {
  if (!registry.length || !dataVersion) throw new Error("Could not read publish registry or data version.");
  if (!gameNumberStartDate || !recentTargetLookbackDays) throw new Error("Could not read target schedule constants.");
  if (targetNameCache.has(dateKey)) return targetNameCache.get(dateKey);
  const recentTargets = new Set();
  let cursor = addDaysToDateKey(dateKey, -1);
  for (let offset = 0; offset < recentTargetLookbackDays && cursor >= gameNumberStartDate; offset += 1) {
    recentTargets.add(targetNameForDate(cursor));
    cursor = addDaysToDateKey(cursor, -1);
  }
  const target = registry
    .map((dish) => ({ dish, rank: targetRankForDate(dateKey, dish) }))
    .sort((a, b) => a.rank - b.rank || a.dish.name.localeCompare(b.dish.name))
    .find((item) => !recentTargets.has(item.dish.name))?.dish || registry[0];
  targetNameCache.set(dateKey, target.name);
  return target.name;
}

function gameNumberForDate(dateKey) {
  if (!gameNumberStartDate) throw new Error("Could not read game number start date.");
  const date = new Date(`${dateKey}T00:00:00Z`);
  const start = new Date(`${gameNumberStartDate}T00:00:00Z`);
  return Math.max(1, Math.floor((date - start) / 86400000) + 1);
}

function assertDisplayedGameNumber(gameText) {
  const number = Number((gameText.match(/Chefle #(\d+)/) || [])[1]);
  const dateText = gameText.split("|")[1]?.trim() || "";
  const dateKey = new Date(`${dateText} 12:00 UTC`).toISOString().slice(0, 10);
  const expected = gameNumberForDate(dateKey);
  if (number !== expected) {
    throw new Error(`${dateKey} should render as Chefle #${expected}, found ${gameText}.`);
  }
}

function assertTargetSchedule() {
  if (!gameNumberStartDate) throw new Error("Could not read game number start date.");
  const seen = [];
  for (let offset = 0; offset < 120; offset += 1) {
    const dateKey = addDaysToDateKey(gameNumberStartDate, offset);
    const targetName = targetNameForDate(dateKey);
    const repeated = seen.slice(-recentTargetLookbackDays).includes(targetName);
    if (repeated) {
      throw new Error(`${targetName} repeats within ${recentTargetLookbackDays + 1} days at ${dateKey}.`);
    }
    seen.push(targetName);
  }
}

function waitForDevTools(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for Chrome DevTools.")), 15000);
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited before DevTools was ready: ${code}`));
    });
  });
}

function openWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error(`Could not open ${url}`)), { once: true });
  });
}

function createCdp(socket) {
  let id = 0;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result || {});
  });

  return function send(method, params = {}) {
    const messageId = ++id;
    socket.send(JSON.stringify({ id: messageId, method, params }));
    return new Promise((resolve, reject) => pending.set(messageId, { resolve, reject }));
  };
}

async function openPage(browserWsUrl) {
  const port = new URL(browserWsUrl).port;
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(targetUrl)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`Could not create Chrome tab: ${response.status}`);
  const tab = await response.json();
  if (!tab.webSocketDebuggerUrl) throw new Error("Chrome tab did not expose a debugger URL.");
  return tab.webSocketDebuggerUrl;
}

async function evaluate(send, expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed.");
  return result.result.value;
}

async function clickBySelector(send, selector) {
  const rect = await evaluate(send, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const bounds = element.getBoundingClientRect();
    return {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
      width: bounds.width,
      height: bounds.height,
      disabled: Boolean(element.disabled),
      text: element.textContent || ""
    };
  })()`);
  if (!rect || rect.disabled || rect.width <= 0 || rect.height <= 0) {
    throw new Error(`Cannot click ${selector}: ${JSON.stringify(rect)}`);
  }
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: rect.x,
    y: rect.y,
    button: "left",
    clickCount: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: rect.x,
    y: rect.y,
    button: "left",
    clickCount: 1
  });
  await delay(150);
  return rect;
}

async function waitForInitialized(send) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await evaluate(send, `(() => ({
      game: document.getElementById("gameId")?.textContent || "",
      pool: document.getElementById("poolFilteredCount")?.textContent || ""
    }))()`);
    if (/#\d+/.test(state.game) && /\d+ shown/i.test(state.pool) && !/^0 shown$/i.test(state.pool)) {
      assertDisplayedGameNumber(state.game);
      return state;
    }
    await delay(100);
  }
  throw new Error("Page did not initialize the game state.");
}

async function boardMetrics(send, label) {
  return evaluate(send, `(() => {
    const rows = Array.from(document.querySelectorAll(".guess-row, .empty-row"));
    const board = document.getElementById("board");
    return {
      label: ${JSON.stringify(label)},
      rows: rows.length,
      guessRows: document.querySelectorAll(".guess-row").length,
      emptyRows: document.querySelectorAll(".empty-row").length,
      labels: rows.map((row) => row.querySelector(".dish-name, .empty-dish")?.textContent || ""),
      boardClientHeight: board.clientHeight,
      boardScrollHeight: board.scrollHeight,
      boardHasInternalScroll: board.scrollHeight > board.clientHeight + 1,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth
    };
  })()`);
}

async function reloadAndMeasure(send, label) {
  await send("Page.navigate", { url: targetUrl });
  await delay(750);
  await waitForInitialized(send);
  return boardMetrics(send, label);
}

async function setStoredGame(send, state) {
  await evaluate(send, `localStorage.setItem(${JSON.stringify(gameKey)}, ${JSON.stringify(JSON.stringify(state))})`);
}

async function runHistogramScenario(send) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  await evaluate(send, `localStorage.setItem(${JSON.stringify(statsKey)}, ${JSON.stringify(JSON.stringify({
    played: 10,
    wins: 3,
    currentStreak: 0,
    maxStreak: 2,
    guessDistribution: [0, 0, 1, 0, 0, 2, 0],
    lastCompletedDate: "2026-06-01",
    lastCompletedGameKey: "2026-06-01:qa",
    lastWinDate: "2026-06-01",
    lastWinGameKey: "2026-06-01:qa"
  }))})`);
  await send("Page.navigate", { url: targetUrl });
  await delay(750);
  await waitForInitialized(send);
  await evaluate(send, `document.getElementById("statsButton").click()`);
  await delay(100);
  const rows = await evaluate(send, `Array.from(document.querySelectorAll(".hist-row")).map((row) => ({
    label: row.querySelector("span:first-child")?.textContent || "",
    width: row.querySelector(".hist-fill")?.style.getPropertyValue("--w") || ""
  }))`);
  const expected = [
    ["1", "0%"],
    ["2", "0%"],
    ["3", "10%"],
    ["4", "0%"],
    ["5", "0%"],
    ["6", "20%"],
    ["7", "0%"],
    ["Failed", "70%"]
  ];
  expected.forEach(([label, width], index) => {
    const row = rows[index] || {};
    if (row.label !== label || row.width !== width) {
      throw new Error(`Stats histogram row ${label} expected ${width}, found ${row.label || "none"} ${row.width || "none"}.`);
    }
  });
  await evaluate(send, `localStorage.removeItem(${JSON.stringify(statsKey)})`);
  return rows;
}

async function runShareCopyScenario(send) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1365,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false
  });
  await send("Page.navigate", { url: targetUrl });
  await delay(750);
  await waitForInitialized(send);
  const dateKey = await evaluate(send, `(() => {
    const gameText = document.getElementById("gameId")?.textContent || "";
    const dateText = gameText.split("|")[1]?.trim() || "";
    return new Date(dateText + " 12:00 UTC").toISOString().slice(0, 10);
  })()`);
  const targetName = targetNameForDate(dateKey);
  await setStoredGame(send, {
    dateKey,
    dataVersion,
    targetName,
    guesses: [targetName],
    status: "won",
    statsRecorded: true,
    answerRevealed: false
  });
  await send("Page.navigate", { url: targetUrl });
  await delay(750);
  await waitForInitialized(send);
  await clickBySelector(send, "#statsButton");
  await clickBySelector(send, "#copySummaryButton");
  const copyToast = await evaluate(send, `document.getElementById("toast")?.textContent || ""`);
  await evaluate(send, `Object.defineProperty(navigator, "share", { value: undefined, configurable: true })`);
  await clickBySelector(send, "#shareButton");
  const shareToast = await evaluate(send, `document.getElementById("toast")?.textContent || ""`);
  await evaluate(send, `localStorage.removeItem(${JSON.stringify(gameKey)})`);
  if (/failed/i.test(copyToast) || /failed/i.test(shareToast)) {
    throw new Error(`Share/copy toast should not fail. Copy: ${copyToast || "empty"} Share: ${shareToast || "empty"}`);
  }
  return { copyToast, shareToast };
}

function assertScenario(scenario, expectedRows, expectedLastLabel = null) {
  if (scenario.rows !== expectedRows) {
    throw new Error(`${scenario.label} expected ${expectedRows} board rows, found ${scenario.rows}.`);
  }
  if (expectedLastLabel && scenario.labels[scenario.labels.length - 1] !== expectedLastLabel) {
    throw new Error(`${scenario.label} expected last row ${expectedLastLabel}, found ${scenario.labels[scenario.labels.length - 1] || "none"}.`);
  }
  if (scenario.documentScrollWidth > scenario.documentClientWidth + 1) {
    throw new Error(`${scenario.label} widened the document.`);
  }
}

async function runBoardStateScenarios(send) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  const initial = await reloadAndMeasure(send, "initial");
  assertScenario(initial, 7, "Guess 7");

  const setup = await evaluate(send, `(() => {
    const gameText = document.getElementById("gameId")?.textContent || "";
    const dateText = gameText.split("|")[1]?.trim() || "";
    const dateKey = new Date(dateText + " 12:00 UTC").toISOString().slice(0, 10);
    const poolNames = Array.from(document.querySelectorAll(".pool-name")).map((element) => element.textContent);
    return { dateKey, poolNames };
  })()`);
  const targetName = targetNameForDate(setup.dateKey);
  const wrongs = setup.poolNames.filter((name) => name !== targetName).slice(0, 9);
  if (wrongs.length < 9) throw new Error("Not enough non-target pool dishes for board-state QA.");
  const base = {
    dateKey: setup.dateKey,
    dataVersion,
    targetName,
    statsRecorded: true,
    answerRevealed: false
  };

  await setStoredGame(send, { ...base, guesses: wrongs.slice(0, 7), status: "failed" });
  const failed = await reloadAndMeasure(send, "failed");
  assertScenario(failed, 7, wrongs[6]);

  await setStoredGame(send, { ...base, guesses: wrongs.slice(0, 7), status: "freeplay" });
  const continued = await reloadAndMeasure(send, "continued");
  assertScenario(continued, 8, "Guess 8");

  await setStoredGame(send, { ...base, guesses: wrongs.slice(0, 8), status: "freeplay" });
  const freeplayMiss = await reloadAndMeasure(send, "freeplay-miss");
  assertScenario(freeplayMiss, 9, "Guess 9");
  if (!freeplayMiss.boardHasInternalScroll) throw new Error("Freeplay board should scroll inside the table area.");

  await setStoredGame(send, { ...base, guesses: [...wrongs.slice(0, 7), targetName], status: "freeplay-won" });
  const freeplayWon = await reloadAndMeasure(send, "freeplay-won");
  assertScenario(freeplayWon, 8, targetName);

  await setStoredGame(send, { ...base, guesses: [targetName], status: "won" });
  const won = await reloadAndMeasure(send, "won");
  assertScenario(won, 7, "Guess 7");

  await evaluate(send, `localStorage.removeItem(${JSON.stringify(gameKey)})`);
  return [initial, failed, continued, freeplayMiss, freeplayWon, won];
}

async function runViewport(send, viewport) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile
  });
  await send("Page.navigate", { url: targetUrl });
  await delay(750);
  await waitForInitialized(send);

  return evaluate(send, `(() => {
    const doc = document.documentElement;
    const body = document.body;
    const visibleOverflow = Array.from(document.querySelectorAll("body *"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.display !== "none"
          && style.visibility !== "hidden"
          && rect.right > window.innerWidth + 1;
      })
      .slice(0, 12)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: String(element.className || ""),
          id: element.id || "",
          right: Math.round(rect.right),
          width: Math.round(rect.width)
        };
      });
    const appRect = document.querySelector(".app-shell")?.getBoundingClientRect() || { left: 0, right: window.innerWidth, width: window.innerWidth };
    const leftRail = document.querySelector(".ad-rail-left");
    const rightRail = document.querySelector(".ad-rail-right");
    const leftRailRect = leftRail?.getBoundingClientRect() || { width: 0 };
    const rightRailRect = rightRail?.getBoundingClientRect() || { width: 0 };
    return {
      label: ${JSON.stringify(viewport.label)},
      innerWidth: window.innerWidth,
      clientWidth: doc.clientWidth,
      scrollWidth: doc.scrollWidth,
      bodyScrollWidth: body.scrollWidth,
      appWidth: Math.round(appRect.width),
      appLeftGutter: Math.round(appRect.left),
      appRightGutter: Math.round(window.innerWidth - appRect.right),
      leftRailWidth: Math.round(leftRailRect.width),
      rightRailWidth: Math.round(rightRailRect.width),
      leftRailDisplay: leftRail ? getComputedStyle(leftRail).display : "",
      rightRailDisplay: rightRail ? getComputedStyle(rightRail).display : "",
      initialized: document.getElementById("gameId")?.textContent || "",
      region: document.getElementById("regionInsightTitle")?.textContent || "",
      pool: document.getElementById("poolFilteredCount")?.textContent || "",
      footerLinks: Array.from(document.querySelectorAll(".legal-footer a")).map((link) => link.getAttribute("href")),
      boardRows: document.querySelectorAll(".guess-row, .empty-row").length,
      lastBoardLabel: Array.from(document.querySelectorAll(".guess-row, .empty-row")).at(-1)?.querySelector(".dish-name, .empty-dish")?.textContent || "",
      poolListClientHeight: document.getElementById("poolList")?.clientHeight || 0,
      poolListScrollHeight: document.getElementById("poolList")?.scrollHeight || 0,
      poolListHasInternalScroll: (document.getElementById("poolList")?.scrollHeight || 0) > (document.getElementById("poolList")?.clientHeight || 0) + 1,
      devResetPresent: Boolean(document.getElementById("resetFoodButton") || document.querySelector(".dev-block")),
      discoveryPanelHeight: Math.round(document.querySelector(".discovery-panel")?.getBoundingClientRect().height || 0),
      boardToGuessGap: Math.round((document.querySelector(".guess-panel")?.getBoundingClientRect().top || 0) - (document.querySelector(".board-wrap")?.getBoundingClientRect().bottom || 0)),
      playgroundToPoolBottomDelta: Math.round(Math.abs((document.querySelector(".playground")?.getBoundingClientRect().bottom || 0) - (document.querySelector(".discovery-panel")?.getBoundingClientRect().bottom || 0))),
      topbarRight: Math.round(document.querySelector(".topbar-inner")?.getBoundingClientRect().right || 0),
      visibleOverflow
    };
  })()`);
}

async function main() {
  if (!fs.existsSync(publishPath)) throw new Error("Run scripts/build-publish.js before QA.");
  assertTargetSchedule();

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "chefle-chrome-"));
  const chrome = spawn(findChrome(), [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--allow-file-access-from-files",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });

  try {
    const browserWsUrl = await waitForDevTools(chrome);
    const pageWsUrl = await openPage(browserWsUrl);
    const socket = await openWebSocket(pageWsUrl);
    const send = createCdp(socket);
    await send("Page.enable");
    await send("Runtime.enable");

    const results = [];
    results.push(await runViewport(send, { label: "mobile", width: 390, height: 844, mobile: true }));
    results.push(await runViewport(send, { label: "adsense-preview", width: 1000, height: 768, mobile: false }));
    results.push(await runViewport(send, { label: "desktop", width: 1365, height: 768, mobile: false }));
    const boardScenarios = await runBoardStateScenarios(send);
    const histogramWidths = await runHistogramScenario(send);
    const shareCopy = await runShareCopyScenario(send);
    socket.close();

    console.log(JSON.stringify({ targetUrl, results, boardScenarios, histogramWidths, shareCopy }, null, 2));

    const failures = results.filter((result) =>
      result.scrollWidth > result.clientWidth + 1
      || result.topbarRight > result.innerWidth + 1
      || /^0 shown$/i.test(result.pool)
      || result.boardRows !== 7
      || result.devResetPresent
      || !result.poolListHasInternalScroll
      || result.boardToGuessGap > 24
      || (result.label === "adsense-preview" && (result.appLeftGutter < 40 || result.appRightGutter < 40))
      || (result.label === "desktop" && result.playgroundToPoolBottomDelta > 2)
      || requiredFooterLinks.some((href) => !result.footerLinks.includes(href))
    );
    if (failures.length) process.exitCode = 1;
  } finally {
    chrome.kill();
    await delay(300);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // Windows can hold Chrome's temporary profile briefly after process exit.
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
