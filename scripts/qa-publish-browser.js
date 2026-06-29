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
const modeKey = "chefle:regional-temp:v3:mode";
const infiniteGameKey = "chefle:regional-temp:v3:infinite";
const statsKey = "chefle:regional-temp:v3:stats";
const requiredFooterLinks = ["how-to-play.html", "food-clues.html", "about.html", "contact.html", "privacy.html", "terms.html", "cookies.html", "accessibility.html", "disclaimer.html"];
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

async function setStoredInfiniteGame(send, state) {
  await evaluate(send, `localStorage.setItem(${JSON.stringify(infiniteGameKey)}, ${JSON.stringify(JSON.stringify(state))})`);
}

async function waitForInfiniteInitialized(send) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await evaluate(send, `(() => ({
      game: document.getElementById("gameId")?.textContent || "",
      pool: document.getElementById("poolFilteredCount")?.textContent || ""
    }))()`);
    if (/Infinite Mode/i.test(state.game) && /\d+ shown/i.test(state.pool) && !/^0 shown$/i.test(state.pool)) return state;
    await delay(100);
  }
  throw new Error("Page did not initialize infinite mode.");
}

async function submitDish(send, name) {
  await evaluate(send, `(() => {
    const input = document.getElementById("dishInput");
    input.focus();
    input.value = ${JSON.stringify(name)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await clickBySelector(send, "#submitButton");
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

async function runInfiniteModeScenario(send) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  await send("Page.navigate", { url: targetUrl });
  await delay(750);
  await waitForInitialized(send);
  await evaluate(send, `localStorage.removeItem(${JSON.stringify(modeKey)}); localStorage.removeItem(${JSON.stringify(infiniteGameKey)})`);
  await clickBySelector(send, "#infiniteModeButton");
  await waitForInfiniteInitialized(send);

  const initial = await evaluate(send, `(() => ({
    game: document.getElementById("gameId")?.textContent || "",
    title: document.getElementById("gameStatus")?.textContent || "",
    poolTitle: document.getElementById("poolTitleLabel")?.textContent || "",
    pressed: document.getElementById("infiniteModeButton")?.getAttribute("aria-pressed"),
    current: document.getElementById("infiniteCurrentStreak")?.textContent || "",
    best: document.getElementById("infiniteBestStreak")?.textContent || "",
    scoreboardHidden: document.getElementById("infiniteScoreboard")?.hidden,
    stored: JSON.parse(localStorage.getItem(${JSON.stringify(infiniteGameKey)}) || "null")
  }))()`);
  if (initial.game !== "Infinite Mode" || initial.poolTitle !== "Infinite Pool" || initial.pressed !== "true" || initial.scoreboardHidden) {
    throw new Error(`Infinite mode did not render expected chrome: ${JSON.stringify(initial)}`);
  }
  if (initial.current !== "0" || initial.best !== "0" || !initial.stored?.targetName) {
    throw new Error(`Infinite initial streak/storage invalid: ${JSON.stringify(initial)}`);
  }

  await clickBySelector(send, "#statsButton");
  const modal = await evaluate(send, `(() => ({
    title: document.getElementById("statsTitle")?.textContent || "",
    histogramHidden: document.getElementById("histogram")?.hidden,
    countdownHidden: document.querySelector(".countdown-box")?.hidden,
    shareHidden: document.getElementById("shareButton")?.hidden
  }))()`);
  if (modal.title !== "Infinite Streak" || !modal.histogramHidden || !modal.countdownHidden || !modal.shareHidden) {
    throw new Error(`Infinite stats modal did not hide daily-only controls: ${JSON.stringify(modal)}`);
  }
  await clickBySelector(send, "#closeStats");

  const firstTarget = initial.stored.targetName;
  await submitDish(send, firstTarget);
  await delay(250);
  const celebration = await evaluate(send, `(() => {
    const popover = document.getElementById("celebrationPopover");
    const style = popover ? getComputedStyle(popover) : null;
    return {
      visible: popover?.classList.contains("visible"),
      fire: document.getElementById("celebrationFire")?.textContent || "",
      title: document.getElementById("celebrationTitle")?.textContent || "",
      meta: document.getElementById("celebrationMeta")?.textContent || "",
      backdropFilter: style?.backdropFilter || style?.webkitBackdropFilter || ""
    };
  })()`);
  if (!celebration.visible || !celebration.fire.trim() || celebration.title !== "Great Job" || celebration.meta.trim() || !celebration.backdropFilter.includes("blur")) {
    throw new Error(`Correct-guess celebration did not render expected text-only blurred popup: ${JSON.stringify(celebration)}`);
  }
  await delay(3300);
  const afterWin = await evaluate(send, `(() => ({
    current: document.getElementById("infiniteCurrentStreak")?.textContent || "",
    best: document.getElementById("infiniteBestStreak")?.textContent || "",
    rows: document.querySelectorAll(".guess-row").length,
    celebrationVisible: document.getElementById("celebrationPopover")?.classList.contains("visible"),
    stored: JSON.parse(localStorage.getItem(${JSON.stringify(infiniteGameKey)}) || "null")
  }))()`);
  if (afterWin.current !== "1" || afterWin.best !== "1" || afterWin.rows !== 0 || afterWin.celebrationVisible || afterWin.stored?.currentStreak !== 1 || afterWin.stored?.bestStreak !== 1 || afterWin.stored?.guesses?.length !== 0) {
    throw new Error(`Infinite win did not advance/reset correctly: ${JSON.stringify(afterWin)}`);
  }
  if (afterWin.stored.targetName === firstTarget) {
    throw new Error("Infinite mode repeated the same target immediately after a win.");
  }

  const failSetup = await evaluate(send, `(() => {
    const stored = JSON.parse(localStorage.getItem(${JSON.stringify(infiniteGameKey)}) || "null");
    const poolNames = Array.from(document.querySelectorAll(".pool-name")).map((element) => element.textContent);
    return { stored, wrongs: poolNames.filter((name) => name !== stored.targetName).slice(0, 7) };
  })()`);
  if (!failSetup.stored?.targetName || failSetup.wrongs.length < 7) {
    throw new Error(`Not enough infinite pool dishes to force a failed round: ${JSON.stringify(failSetup)}`);
  }
  await setStoredInfiniteGame(send, {
    ...failSetup.stored,
    guesses: failSetup.wrongs.slice(0, 6),
    status: "playing",
    roundRecorded: false
  });
  await send("Page.navigate", { url: targetUrl });
  await delay(750);
  await waitForInfiniteInitialized(send);
  await submitDish(send, failSetup.wrongs[6]);
  await delay(900);
  const afterFail = await evaluate(send, `(() => ({
    current: document.getElementById("infiniteCurrentStreak")?.textContent || "",
    best: document.getElementById("infiniteBestStreak")?.textContent || "",
    rows: document.querySelectorAll(".guess-row").length,
    gameOverOpen: document.getElementById("infiniteGameOverModal")?.classList.contains("open"),
    gameOverTitle: document.getElementById("gameOverTitle")?.textContent || "",
    gameOverAnswer: document.getElementById("gameOverAnswerName")?.textContent || "",
    gameOverStats: Array.from(document.querySelectorAll("#gameOverStatGrid .stat")).map((card) => ({
      value: card.querySelector("strong")?.textContent || "",
      label: card.querySelector("span")?.textContent || ""
    })),
    stored: JSON.parse(localStorage.getItem(${JSON.stringify(infiniteGameKey)}) || "null"),
    dailyStats: localStorage.getItem(${JSON.stringify(statsKey)})
  }))()`);
  const endedStreakCard = afterFail.gameOverStats.find((card) => card.label === "Ended Streak");
  const bestCard = afterFail.gameOverStats.find((card) => card.label === "Best");
  if (afterFail.current !== "0" || afterFail.best !== "1" || afterFail.rows !== 7 || !afterFail.gameOverOpen || afterFail.gameOverTitle !== "Game Over" || afterFail.gameOverAnswer !== failSetup.stored.targetName || endedStreakCard?.value !== "1" || bestCard?.value !== "1" || afterFail.stored?.status !== "failed" || afterFail.stored?.currentStreak !== 0 || afterFail.stored?.bestStreak !== 1 || afterFail.stored?.guesses?.length !== 7) {
    throw new Error(`Infinite failure did not show game over and preserve failed round: ${JSON.stringify(afterFail)}`);
  }
  if (afterFail.dailyStats !== null) {
    throw new Error(`Infinite mode should not write daily stats: ${afterFail.dailyStats}`);
  }
  await clickBySelector(send, "#newInfiniteStreakButton");
  await delay(300);
  const afterNewStreak = await evaluate(send, `(() => ({
    current: document.getElementById("infiniteCurrentStreak")?.textContent || "",
    best: document.getElementById("infiniteBestStreak")?.textContent || "",
    rows: document.querySelectorAll(".guess-row").length,
    gameOverOpen: document.getElementById("infiniteGameOverModal")?.classList.contains("open"),
    stored: JSON.parse(localStorage.getItem(${JSON.stringify(infiniteGameKey)}) || "null")
  }))()`);
  if (afterNewStreak.current !== "0" || afterNewStreak.best !== "1" || afterNewStreak.rows !== 0 || afterNewStreak.gameOverOpen || afterNewStreak.stored?.status !== "playing" || afterNewStreak.stored?.guesses?.length !== 0) {
    throw new Error(`Starting a new infinite streak did not reset the failed round: ${JSON.stringify(afterNewStreak)}`);
  }

  await evaluate(send, `localStorage.removeItem(${JSON.stringify(modeKey)}); localStorage.removeItem(${JSON.stringify(infiniteGameKey)})`);
  await send("Page.navigate", { url: targetUrl });
  await delay(750);
  await waitForInitialized(send);
  return { initial, modal, celebration, afterWin, afterFail, afterNewStreak };
}

async function runInfiniteDesktopLayoutScenario(send) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1365,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false
  });
  await send("Page.navigate", { url: targetUrl });
  await delay(750);
  await waitForInitialized(send);
  await evaluate(send, `localStorage.removeItem(${JSON.stringify(modeKey)}); localStorage.removeItem(${JSON.stringify(infiniteGameKey)}); window.scrollTo(0, 0)`);
  await send("Page.navigate", { url: targetUrl });
  await delay(750);
  await waitForInitialized(send);
  const before = await evaluate(send, `(() => {
    const game = document.querySelector(".game-layout")?.getBoundingClientRect();
    const board = document.querySelector(".board-wrap")?.getBoundingClientRect();
    const shell = document.querySelector(".app-shell")?.getBoundingClientRect();
    window.scrollTo(0, 100);
    return {
      mode: document.body.dataset.mode || "",
      gameTop: Math.round(game?.top || 0),
      gameLeft: Math.round(game?.left || 0),
      boardHeight: Math.round(board?.height || 0),
      shellHeight: Math.round(shell?.height || 0),
      scrollY: Math.round(window.scrollY),
      overflowY: getComputedStyle(document.body).overflowY
    };
  })()`);
  await clickBySelector(send, "#infiniteModeButton");
  await waitForInfiniteInitialized(send);
  const after = await evaluate(send, `(() => {
    const game = document.querySelector(".game-layout")?.getBoundingClientRect();
    const board = document.querySelector(".board-wrap")?.getBoundingClientRect();
    const shell = document.querySelector(".app-shell")?.getBoundingClientRect();
    window.scrollTo(0, 100);
    return {
      mode: document.body.dataset.mode || "",
      gameTop: Math.round(game?.top || 0),
      gameLeft: Math.round(game?.left || 0),
      boardHeight: Math.round(board?.height || 0),
      shellHeight: Math.round(shell?.height || 0),
      scrollY: Math.round(window.scrollY),
      overflowY: getComputedStyle(document.body).overflowY,
      current: document.getElementById("infiniteCurrentStreak")?.textContent || "",
      best: document.getElementById("infiniteBestStreak")?.textContent || "",
      scoreboardInactive: document.getElementById("infiniteScoreboard")?.classList.contains("inactive")
    };
  })()`);
  if (before.scrollY !== 0 || after.scrollY !== 0 || before.overflowY !== "hidden" || after.overflowY !== "hidden") {
    throw new Error(`Desktop page should not scroll in wide mode: ${JSON.stringify({ before, after })}`);
  }
  if (after.mode !== "infinite" || after.scoreboardInactive || after.current !== "0" || after.best !== "0") {
    throw new Error(`Desktop infinite mode did not activate cleanly: ${JSON.stringify(after)}`);
  }
  if (Math.abs(after.gameTop - before.gameTop) > 1 || Math.abs(after.gameLeft - before.gameLeft) > 1 || Math.abs(after.boardHeight - before.boardHeight) > 1) {
    throw new Error(`Desktop mode switch shifted the game layout: ${JSON.stringify({ before, after })}`);
  }
  await evaluate(send, `localStorage.removeItem(${JSON.stringify(modeKey)}); localStorage.removeItem(${JSON.stringify(infiniteGameKey)})`);
  return { before, after };
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
    results.push(await runViewport(send, { label: "compact-phone", width: 320, height: 568, mobile: true }));
    results.push(await runViewport(send, { label: "mobile", width: 390, height: 844, mobile: true }));
    results.push(await runViewport(send, { label: "phone-landscape", width: 667, height: 375, mobile: true }));
    results.push(await runViewport(send, { label: "tablet", width: 768, height: 1024, mobile: true }));
    results.push(await runViewport(send, { label: "adsense-preview", width: 1000, height: 768, mobile: false }));
    results.push(await runViewport(send, { label: "desktop", width: 1365, height: 768, mobile: false }));
    const boardScenarios = await runBoardStateScenarios(send);
    const histogramWidths = await runHistogramScenario(send);
    const shareCopy = await runShareCopyScenario(send);
    const infiniteMode = await runInfiniteModeScenario(send);
    const infiniteDesktopLayout = await runInfiniteDesktopLayoutScenario(send);
    socket.close();

    console.log(JSON.stringify({ targetUrl, results, boardScenarios, histogramWidths, shareCopy, infiniteMode, infiniteDesktopLayout }, null, 2));

    const failures = results.filter((result) =>
      result.scrollWidth > result.clientWidth + 1
      || result.topbarRight > result.innerWidth + 1
      || /^0 shown$/i.test(result.pool)
      || result.boardRows !== 7
      || result.devResetPresent
      || !result.poolListHasInternalScroll
      || result.boardToGuessGap > 24
      || (result.label === "adsense-preview" && (result.appLeftGutter < 140 || result.appRightGutter < 140))
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
