#!/usr/bin/env node
/**
 * export-hydrated.mjs —— 把 /proto/session-redesign 的**水合后 DOM**固化成单文件 HTML。
 *
 * 背景（2026-10-20-session-page-dsh-alignment / D-018）：
 *   上一版 `prototype-session-fullpage.html` 是从 **SSR HTML** 抓的，里面有 138 个
 *   CSR-bailout `<template>` 占位、**0 个 `.wmde-markdown`** —— 也就是说 21 轮答复
 *   正文全部缺失（MarkdownText 走 next/dynamic ssr:false，SSR 阶段根本不渲染）。
 *   静态稿因此不能作为「答复正文是否成立」的证据。
 *
 * 本脚本的修法：等浏览器把页面真正水合完（.wmde-markdown 出现 ≥ 阈值）之后再取
 *   `document.documentElement.outerHTML`，把样式内联成单个 <style>，剥掉所有
 *   `<script>` / `<link>`，产出**自包含**（无外链、无 JS、无外部 fetch）的定稿稿。
 *
 * 用法（在 frontend/ 下）：
 *   node scripts/export-hydrated.mjs
 *   node scripts/export-hydrated.mjs --shot <png 路径>        # 顺带把定稿稿截图
 *   node scripts/export-hydrated.mjs --url http://127.0.0.1:3000/proto/session-redesign
 *                                   --out <html 路径> --min-markdown 50 --min-meta 15
 *
 *   node scripts/export-hydrated.mjs --with-js                # 静态快照 + 轻量脚本（可交互）
 *   node scripts/export-hydrated.mjs --with-js --verify <png>  # 再跑 file:// 交互验证 + 截图
 *   node scripts/export-hydrated.mjs --with-react              # 实验：内联 React bundle（见下）
 *
 * `--with-js`（2026-10-21）＝**静态快照 + 轻量脚本（非 React 运行时）**：
 *   - 导出前把页面点成「所有卡片展开」（含 100 文件用例），让列表内容真的进 DOM；
 *   - 在 `</body>` 前追加一段 ~4 KB 的 vanilla 脚本，只重放三个判据交互：
 *     卡头展开/折叠（切 `data-expanded` + `hidden`）、文件行点击写 `open-file-log`、
 *     主题按钮改 `html[data-theme]`，外加 100 文件用例的显示/隐藏；
 *   - 成品顶部有注释标明「静态快照 + 轻量脚本（非 React 运行时）」。
 *
 * `--with-react` 实验结论（**不可行，保留代码供复核**）：
 *   把 8 个 `<script src>`（12.4 MB dev bundle，含 6 MB main-app）按 DOM 顺序内联、
 *   把动态 chunk（tanstack devtools，1.2 MB）预注册进 `self.webpackChunk_N_E` 队列、
 *   把 flight 载荷里的 `layout.css` / `favicon.ico` 改写成 data: URI、字体内联成 base64
 *   —— 脚本确实全部执行、**零 http(s) 请求**，但 React 的 document hydration 必然拒绝
 *   这份 DOM：`Expected server HTML to contain a matching <script> in <head>` →
 *   `Hydration failed` → 整根切到客户端渲染。同一份文件用 http:// 打（不带 file://）
 *   也报同样的错，说明是**水合后 outerHTML 再序列化**与 RSC 载荷对不上，不是 file:// 的锅。
 *   file:// 下更糟：dev overlay 的 HMR WebSocket 在 file:// 下 hostname 为空，
 *   `new WebSocket("wss://:/_next/webpack-hmr")` 抛 SyntaxError，dev overlay 走到
 *   global-error，整页变「应用发生严重错误」。所以这条路不能宣称成功。
 *
 * 校验（任一不满足即**大声失败**，exit 1，绝不写半成品）：
 *   1. `</title>` / `</style>` / `</head>` / `<body>` / `</body>` 各恰好 1 个；
 *   2. 输出里 `.wmde-markdown`（元素级，排除 CSS 文本）≥ --min-markdown（默认 50）；
 *   3. `turn-meta-detail`（轮尾元信息行 testid）≥ --min-meta（默认 15）；
 *   4. 不残留 `<template>` CSR 占位里带 markdown 的块；
 *   5. 无 `<link>`；不带 --with-js/--with-react 时还要无 `<script>`；带 --with-js 时
 *      恰好 1 个脚本（轻量 shim）；带 --with-react 时不得残留 `<script src>`。
 * 打印字节数与上述全部计数。
 *
 * `--verify <png>` 在 file:// 下实测：首卡折叠/展开（可见行数）、文件行点击写
 * `open-file-log`、dark 主题按钮改 `html[data-theme]`、**零 http(s) 请求**、
 * console/page 错误；`--with-react` 模式额外要求 React 水合痕迹。
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** frontend/scripts/ → 上两级 = 仓库根。 */
const REPO_ROOT = path.resolve(HERE, "..", "..");
const CHANGE_DIR = path.join(
  REPO_ROOT,
  ".sillyspec",
  "changes",
  "2026-10-20-session-page-dsh-alignment",
);

/** `--flag value` 取值（缺省回落 fallback）。 */
function argValue(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} 缺少取值`);
  }
  return value;
}

const TARGET_URL = argValue("--url", "http://127.0.0.1:3000/proto/session-redesign");
const OUT_FILE = path.resolve(
  argValue("--out", path.join(CHANGE_DIR, "prototype-session-final.html")),
);
const SHOT_FILE = argValue("--shot", null);
const MIN_MARKDOWN = Number(argValue("--min-markdown", "50"));
const MIN_META = Number(argValue("--min-meta", "15"));
const HYDRATION_TIMEOUT_MS = Number(argValue("--timeout", "120000"));
/** `--with-js`：成品追加**轻量 vanilla 脚本**（静态快照可交互；不是 React 水合）。 */
const WITH_SHIM = process.argv.includes("--with-js");
/**
 * `--with-react`：实验路径 —— 内联全部 Next/React bundle，尝试 file:// 下真水合。
 * 结论（2026-10-21 实测）：**不可行**。见文件头「--with-react 实验结论」。
 */
const WITH_REACT = process.argv.includes("--with-react");
/** `--verify <png>`：写完稿后在 file:// 下实跑交互 + 零网络断言 + 截图。 */
const VERIFY_SHOT = argValue("--verify", null);
if (WITH_REACT && WITH_SHIM) {
  fail("--with-react 与 --with-js 不能同时用：前者是（失败了的）真水合实验，后者是轻量脚本快照。");
}

/** 大声失败：抛到顶层 catch → stderr + exit 1（不留半成品文件、先收掉浏览器）。 */
function fail(message) {
  const err = new Error(message);
  err.loud = true;
  throw err;
}

function info(message) {
  console.log(`[export-hydrated] ${message}`);
}

/** 非贪婪计数（html 里的出现次数）。 */
function countOf(haystack, needle) {
  return haystack.split(needle).length - 1;
}

/* ─────────────── --with-js：内联脚本 / 资源的工具函数 ─────────────── */

/**
 * 把 JS 源码安全地塞进 `<script>` 内联块：
 * - `</script` 会让解析器提前收块（bundle 的 eval-source-map 字符串里常见）→ `<\/script`；
 * - `<!--` 会进入 script-data-escaped 状态吞掉后续内容 → `<\!--`。
 * 两处转义在 JS 字符串/正则/模板里语义不变（`\/` `\!` 都是合法转义）。
 */
function jsSafe(code) {
  return code.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
}

/** 属性值转义（只用于我们自己写的 data-inlined-from 之类）。 */
function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** 序列化 HTML 的属性值反转义（`?a=1&amp;b=2` → `?a=1&b=2`），用于按 src 对齐。 */
function decodeAttr(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** 按扩展名给 data: URI 选 mime。 */
function mimeFor(url) {
  const pathname = new URL(url, "http://x/").pathname;
  if (/\.woff2$/i.test(pathname)) return "font/woff2";
  if (/\.woff$/i.test(pathname)) return "font/woff";
  if (/\.ttf$/i.test(pathname)) return "font/ttf";
  if (/\.otf$/i.test(pathname)) return "font/otf";
  if (/\.png$/i.test(pathname)) return "image/png";
  if (/\.jpe?g$/i.test(pathname)) return "image/jpeg";
  if (/\.gif$/i.test(pathname)) return "image/gif";
  if (/\.svg$/i.test(pathname)) return "image/svg+xml";
  return "application/octet-stream";
}

/** 内联块的出处标签：去掉 origin 与前导 `/`，避免成品里再出现 `/_next/` 字样。 */
function inlineLabel(url) {
  try {
    const u = new URL(url, "http://x/");
    return `${u.pathname.replace(/^\//, "")}${u.search || ""}`;
  } catch {
    return String(url);
  }
}

/**
 * `--with-js` 的轻量脚本：在**已经渲染好的**静态 DOM 上重放判据交互。
 * 只有 4 件事：卡头展开/折叠、文件行点击写 open-file-log、主题按钮改 html[data-theme]、
 * 100 文件用例的显示/隐藏。没有 React、没有状态树、没有 router。
 */
const SHIM_SCRIPT = `<script data-export-shim="vanilla">
/* 静态快照 + 轻量脚本（非 React 运行时）：只重放判据交互，无 hydration、无状态树。 */
(function () {
  "use strict";
  window.__STATIC_SNAPSHOT_SHIM__ = true;
  document.documentElement.setAttribute("data-export-shim", "vanilla");

  var THEME_GROUP = '[aria-label="\\u9884\\u89c8\\u4e3b\\u9898"]';
  var ACTIVE_CLASS = "rounded border border-brand-400 bg-brand-50 px-1.5 py-0.5 font-mono text-[10.5px] text-brand-700";
  var IDLE_CLASS = "rounded border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:bg-muted";

  function setExpanded(card, on) {
    if (!card) return;
    card.setAttribute("data-expanded", on ? "true" : "false");
    var header = card.querySelector('[data-testid="file-changes-header"]');
    if (header) header.setAttribute("aria-expanded", on ? "true" : "false");
    var list = card.querySelector('[data-testid="file-changes-list"]');
    if (list) list.hidden = !on;
    var chevron = header && header.querySelector("svg");
    if (chevron) chevron.style.transform = on ? "rotate(90deg)" : "";
  }

  function setTheme(name) {
    if (name) document.documentElement.setAttribute("data-theme", name);
    else document.documentElement.removeAttribute("data-theme");
    var group = document.querySelector(THEME_GROUP);
    if (!group) return;
    Array.prototype.forEach.call(group.querySelectorAll("button"), function (button) {
      var on = button.textContent.trim() === name;
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.className = on ? ACTIVE_CLASS : IDLE_CLASS;
    });
  }

  function longListCard() {
    var toggle = document.querySelector('[data-testid="toggle-long-list"]');
    if (!toggle) return null;
    var section = toggle.closest("div.rounded-md") || toggle.parentElement;
    return section ? section.querySelector('[data-testid="file-changes-card"]') : null;
  }

  function setLongList(shown) {
    var toggle = document.querySelector('[data-testid="toggle-long-list"]');
    var card = longListCard();
    var wrap = card ? card.parentElement : null;
    if (wrap) wrap.hidden = !shown;
    if (toggle) {
      toggle.setAttribute("aria-expanded", shown ? "true" : "false");
      toggle.textContent = shown ? "\\u6536\\u8d77 100 \\u6587\\u4ef6\\u7528\\u4f8b" : "\\u5c55\\u5f00 100 \\u6587\\u4ef6\\u7528\\u4f8b";
    }
  }

  function openFile(row) {
    var log = document.querySelector('[data-testid="open-file-log"]');
    if (log) log.textContent = row.getAttribute("data-path") || "";
  }

  function onActivate(event) {
    var target = event.target;
    if (!target || target.nodeType !== 1) return;

    var header = target.closest('[data-testid="file-changes-header"]');
    if (header) {
      var card = header.closest('[data-testid="file-changes-card"]');
      if (card) setExpanded(card, card.getAttribute("data-expanded") !== "true");
      return;
    }

    var row = target.closest('[data-testid="file-changes-row"]');
    if (row) { openFile(row); return; }

    var themeButton = target.closest(THEME_GROUP + " button");
    if (themeButton) { setTheme(themeButton.textContent.trim()); return; }

    var toggle = target.closest('[data-testid="toggle-long-list"]');
    if (toggle) {
      var lcard = longListCard();
      var wrap = lcard ? lcard.parentElement : null;
      setLongList(Boolean(wrap && wrap.hidden));
      return;
    }
  }

  document.addEventListener("click", onActivate);
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
    var row = event.target && event.target.closest ? event.target.closest('[data-testid="file-changes-row"]') : null;
    if (!row) return;
    event.preventDefault();
    openFile(row);
  });

  // 快照里卡片本来就是全展开的；这里把 hidden 与 data-expanded 对齐一次，
  // 之后脚本只做纯粹的 hide/show。
  Array.prototype.forEach.call(document.querySelectorAll('[data-testid="file-changes-card"]'), function (card) {
    setExpanded(card, card.getAttribute("data-expanded") !== "false");
  });
  setLongList(true);
})();
</script>`;

/**
 * `--verify`：file:// 下实跑「判据交互」+ 零 http(s) 请求断言 + 截图。
 *
 * 判据（`.sillyspec/changes/2026-10-20-session-page-dsh-alignment` 的文件变更卡原型页）：
 *   1. 卡头点击：首卡首点折叠（可见行 0）、再点展开且可见行 > 0；
 *   2. 文件行点击：`open-file-log` 文本从占位变成被点行的 `data-path`；
 *   3. dark 主题按钮：`html[data-theme]` 变 `dark`（`aria-pressed` 跟随）；
 *   4. 整个过程中 `page.on('request')` 里**没有任何 http(s) 请求**；
 *   5. console error / pageerror 全量记录（一个都不许有）。
 *
 * `mode === "react"` 时额外要求水合痕迹（React 在它水合过的节点上挂 `__reactProps$…`）；
 * `mode === "shim"` 时要求轻量脚本真的接管（`window.__STATIC_SNAPSHOT_SHIM__`）。
 *
 * 缺 testid（例如拿 session-redesign 页跑）不静默通过，而是标 skipped 并说明。
 */
async function verifyOffline(filePath, shotPath, mode) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const httpRequests = [];
  const consoleErrors = [];
  const pageErrors = [];
  page.on("request", (req) => {
    if (/^https?:/i.test(req.url())) httpRequests.push(req.url());
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err && err.message ? err.message : String(err)));

  const steps = {};
  const skipped = [];
  try {
    await page.goto(pathToFileURL(filePath).href, {
      waitUntil: "load",
      timeout: HYDRATION_TIMEOUT_MS,
    });
    // React 水合是异步的（--with-react 的成品是十几 MB 内联 dev bundle，解析更慢）。
    await page.waitForTimeout(mode === "react" ? 3000 : 1200);

    steps.mode = mode;
    steps.hydration = await page.evaluate(() => {
      const header = document.querySelector('[data-testid="file-changes-header"]');
      if (!header) return { hydrated: false, reason: "页面里没有 file-changes-header" };
      const keys = Object.keys(header);
      return {
        hydrated: keys.some((k) => k.startsWith("__reactProps$") || k.startsWith("__reactFiber$")),
        reactKeys: keys.filter((k) => k.startsWith("__react")).length,
        nextF: typeof self.__next_f !== "undefined" ? self.__next_f.length : null,
      };
    });
    steps.shim = await page.evaluate(() => ({
      active: globalThis.__STATIC_SNAPSHOT_SHIM__ === true,
      marker: document.documentElement.getAttribute("data-export-shim"),
    }));

    const cards = page.locator('[data-testid="file-changes-card"]');
    const cardCount = await cards.count();
    steps.cards = { count: cardCount };
    const rowsOf = (card) => card.locator('[data-testid="file-changes-row"]:visible').count();
    const stateOf = async (card) => ({
      expanded: await card.getAttribute("data-expanded"),
      rows: await rowsOf(card),
    });

    if (cardCount >= 1) {
      const first = cards.first();
      const header = first.locator('[data-testid="file-changes-header"]');
      const before = await stateOf(first);
      await header.click();
      await page.waitForTimeout(250);
      const afterCollapse = await stateOf(first);
      await header.click();
      await page.waitForTimeout(250);
      const afterExpand = await stateOf(first);
      steps.firstCardToggle = {
        before,
        afterCollapse,
        afterExpand,
        ok:
          before.rows > 0 &&
          afterCollapse.expanded === "false" &&
          afterCollapse.rows === 0 &&
          afterExpand.expanded === "true" &&
          afterExpand.rows === before.rows,
      };
      // 再点第二张卡，确认不是只有首卡能切。
      if (cardCount >= 2) {
        const second = cards.nth(1);
        const secondHeader = second.locator('[data-testid="file-changes-header"]');
        const secondBefore = await stateOf(second);
        await secondHeader.click();
        await page.waitForTimeout(200);
        const secondCollapsed = await stateOf(second);
        await secondHeader.click();
        await page.waitForTimeout(200);
        const secondExpanded = await stateOf(second);
        steps.secondCardToggle = {
          before: secondBefore,
          collapsed: secondCollapsed,
          expanded: secondExpanded,
          ok:
            secondBefore.rows > 0 &&
            secondCollapsed.rows === 0 &&
            secondExpanded.expanded === "true" &&
            secondExpanded.rows === secondBefore.rows,
        };
      }
    } else {
      skipped.push("卡头展开/折叠（页面没有 file-changes-card）");
    }

    const log = page.locator('[data-testid="open-file-log"]');
    const firstRow = page.locator('[data-testid="file-changes-row"]:visible').first();
    if ((await log.count()) > 0 && (await firstRow.count()) > 0) {
      const before = ((await log.textContent()) || "").trim();
      const rowPath = await firstRow.getAttribute("data-path");
      await firstRow.click();
      await page.waitForTimeout(250);
      const after = ((await log.textContent()) || "").trim();
      steps.openFile = { path: rowPath, before, after, ok: after === rowPath && after !== before };
    } else {
      skipped.push("文件行点击写 open-file-log（缺 open-file-log 或可见文件行）");
    }

    const themeGroup = page.locator('[aria-label="预览主题"]');
    if ((await themeGroup.count()) > 0) {
      const darkButton = themeGroup.locator("button").filter({ hasText: /^dark$/ });
      if ((await darkButton.count()) > 0) {
        await darkButton.click();
        await page.waitForTimeout(250);
        const theme = await page.evaluate(() => document.documentElement.dataset.theme);
        const pressed = await darkButton.getAttribute("aria-pressed");
        steps.theme = { theme, pressed, ok: theme === "dark" && pressed === "true" };
      } else {
        skipped.push("dark 主题按钮（主题组里没有 dark 按钮）");
      }
    } else {
      skipped.push("dark 主题按钮（页面没有 aria-label=预览主题 的组）");
    }

    // 100 文件用例的显隐（--with-js shim 才有；纯快照里它的卡也在，点按钮切显隐）。
    const longToggle = page.locator('[data-testid="toggle-long-list"]');
    if ((await longToggle.count()) > 0) {
      const longCard = page
        .locator('[data-testid="toggle-long-list"]')
        .locator("xpath=ancestor::div[contains(@class,'rounded-md')][1]")
        .locator('[data-testid="file-changes-card"]');
      const visibleBefore = await longCard.locator('[data-testid="file-changes-row"]:visible').count();
      await longToggle.click();
      await page.waitForTimeout(250);
      const visibleAfter = await longCard.locator('[data-testid="file-changes-row"]:visible').count();
      await longToggle.click();
      await page.waitForTimeout(250);
      const visibleRestored = await longCard.locator('[data-testid="file-changes-row"]:visible').count();
      steps.longList = {
        visibleBefore,
        visibleAfter,
        visibleRestored,
        ok: visibleBefore > 0 && visibleAfter === 0 && visibleRestored === visibleBefore,
      };
    }

    await page.screenshot({ path: shotPath, fullPage: true });
    steps.screenshot = shotPath;
  } finally {
    await browser.close();
  }

  const uniqueHttp = [...new Set(httpRequests)];
  steps.network = { httpRequests: uniqueHttp, ok: uniqueHttp.length === 0 };
  steps.consoleErrors = consoleErrors;
  steps.pageErrors = pageErrors;
  steps.skipped = skipped;

  const checks = [
    mode === "react" ? steps.hydration && steps.hydration.hydrated : steps.shim && steps.shim.active,
    steps.firstCardToggle && steps.firstCardToggle.ok,
    steps.secondCardToggle && steps.secondCardToggle.ok,
    steps.openFile && steps.openFile.ok,
    steps.theme && steps.theme.ok,
    steps.network && steps.network.ok,
    consoleErrors.length === 0,
    pageErrors.length === 0,
    skipped.length === 0,
  ];
  steps.ok = checks.every(Boolean);
  return steps;
}

// ───────────────────────── 1. 取水合后的 DOM + CSS ─────────────────────────
info(`target: ${TARGET_URL}`);
const browser = await chromium.launch();
let page;
try {
  page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });

  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: HYDRATION_TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: HYDRATION_TIMEOUT_MS });
  info("networkidle ✓，等待水合（.wmde-markdown 出现）…");

  // 水合门：答复正文（MarkdownText，next/dynamic ssr:false）只有水合后才进 DOM。
  try {
    await page.waitForFunction(
      (min) => document.querySelectorAll(".wmde-markdown").length >= min,
      MIN_MARKDOWN,
      { timeout: HYDRATION_TIMEOUT_MS, polling: 500 },
    );
  } catch {
    const seen = await page
      .evaluate(() => document.querySelectorAll(".wmde-markdown").length)
      .catch(() => "?");
    fail(
      `${HYDRATION_TIMEOUT_MS}ms 内 .wmde-markdown 未到 ${MIN_MARKDOWN} 个（实际 ${seen}）——` +
        `页面没水合完或答复正文没渲染，拒绝导出空壳稿`,
    );
  }
  await page.waitForLoadState("networkidle", { timeout: HYDRATION_TIMEOUT_MS });

  const hydrated = await page.evaluate(() => ({
    markdown: document.querySelectorAll(".wmde-markdown").length,
    metaDetail: document.querySelectorAll('[data-testid="turn-meta-detail"]').length,
    turnBlocks: document.querySelectorAll('[data-testid="turn-block"]').length,
    answerFontSize: (() => {
      const el = document.querySelector(".seg-text-body .wmde-markdown");
      return el ? getComputedStyle(el).fontSize : null;
    })(),
  }));
  info(
    `水合后 DOM：.wmde-markdown=${hydrated.markdown} · turn-meta-detail=${hydrated.metaDetail} · ` +
      `turn-block=${hydrated.turnBlocks} · 正文字号=${hydrated.answerFontSize}`,
  );
  if (hydrated.markdown < MIN_MARKDOWN) {
    fail(`水合后 .wmde-markdown=${hydrated.markdown} < ${MIN_MARKDOWN}`);
  }

  // 样式：优先读 styleSheets 的 cssRules（<style> 与同源 <link> 都吃）；跨源/读不到
  // 的再回退到「按 href 重新取一遍」。
  const styleSources = await page.evaluate(() => {
    const chunks = [];
    const refetch = [];
    for (const sheet of Array.from(document.styleSheets)) {
      const owner = sheet.ownerNode;
      const ownerTag = owner && owner.tagName ? owner.tagName.toUpperCase() : "";
      try {
        const rules = Array.from(sheet.cssRules);
        if (rules.length > 0) {
          chunks.push(
            rules
              .map((rule) => rule.cssText)
              .filter(Boolean)
              .join("\n"),
          );
        } else if (ownerTag === "STYLE" && owner.textContent) {
          chunks.push(owner.textContent);
        }
      } catch {
        // 跨源样式表读 cssRules 会抛 SecurityError —— 记下 href，Node 侧重取。
        const href = sheet.href || (owner && owner.getAttribute && owner.getAttribute("href"));
        if (href) refetch.push(href);
      }
    }
    return { chunks, refetch };
  });

  const cssChunks = styleSources.chunks.filter((chunk) => chunk && chunk.trim().length > 0);
  for (const href of styleSources.refetch) {
    try {
      const res = await page.request.get(href);
      if (res.ok()) cssChunks.push(await res.text());
      else info(`样式重取失败（${res.status()}）：${href}`);
    } catch (err) {
      info(`样式重取异常（${err.message}）：${href}`);
    }
  }
  if (cssChunks.length === 0) fail("没读到任何样式表——内联 CSS 会得到无色稿");
  const css = cssChunks.join("\n\n");
  info(`样式表 ${cssChunks.length} 片，合计 ${Buffer.byteLength(css, "utf8")} 字节`);

  // 成品里不能再出现绝对 `/_next/...` 资源：CSS 里 next/font 的 woff2 取回后内联成
  // base64 data: URI。只在带脚本的两种模式做（纯静态稿维持原行为，不加体积）。
  const cssAssets = [];
  if (WITH_REACT || WITH_SHIM) {
    for (const match of css.matchAll(/url\(\s*["']?(\/_next\/[^"')]+)["']?\s*\)/g)) {
      const href = match[1];
      if (cssAssets.some((asset) => asset.href === href)) continue;
      const res = await page.request.get(new URL(href, TARGET_URL).href);
      if (!res.ok()) fail(`CSS 资源下载失败（${res.status()}）：${href}`);
      const buf = Buffer.from(await res.body());
      cssAssets.push({
        href,
        dataUri: `data:${mimeFor(href)};base64,${buf.toString("base64")}`,
        bytes: buf.length,
      });
    }
    if (cssAssets.length > 0) {
      info(
        `CSS 绝对资源内联：${cssAssets.length} 个 / ` +
          `${(cssAssets.reduce((sum, a) => sum + a.bytes, 0) / 1024).toFixed(1)} KB → data: URI`,
      );
    }
  }

  // `--with-js` 的静态快照形态：先点开 100 文件用例、再把所有折叠卡点开，
  // 让「一张卡都不少、全部展开」真的进 DOM（shim 只负责之后 hide/show）。
  if (WITH_SHIM) {
    const toggledLongList = await page.evaluate(() => {
      const toggle = document.querySelector('[data-testid="toggle-long-list"]');
      if (toggle && toggle.getAttribute("aria-expanded") !== "true") {
        toggle.click();
        return true;
      }
      return false;
    });
    if (toggledLongList) await page.waitForTimeout(350);
    const openedCards = await page.evaluate(() => {
      let opened = 0;
      for (const card of document.querySelectorAll('[data-testid="file-changes-card"]')) {
        if (card.getAttribute("data-expanded") === "true") continue;
        const header = card.querySelector('[data-testid="file-changes-header"]');
        if (header) {
          header.click();
          opened += 1;
        }
      }
      return opened;
    });
    if (openedCards) await page.waitForTimeout(350);
    const snapshotShape = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid="file-changes-card"]'));
      return {
        cards: cards.length,
        expanded: cards.filter((card) => card.getAttribute("data-expanded") === "true").length,
        rows: document.querySelectorAll('[data-testid="file-changes-row"]').length,
        longList: Boolean(document.querySelector('[data-testid="toggle-long-list"]')),
      };
    });
    info(
      `--with-js 快照形态：卡片 ${snapshotShape.cards} 张（展开 ${snapshotShape.expanded}）· ` +
        `文件行 ${snapshotShape.rows} · 100 文件用例 ${snapshotShape.longList ? "已渲染" : "不存在"}`,
    );
  }

  const outerHtml = await page.evaluate(() => document.documentElement.outerHTML);

  // ── --with-react：收集「水合后 DOM 里的脚本」+「运行时动态拉取的 chunk」 ──
  // 一律在水合完成后再收（动态 chunk 是 layout 里 next/dynamic 拉起来的，早收会漏）。
  let jsAssets = null;
  if (WITH_REACT) {
    const collected = await page.evaluate(() => ({
      // 只要 src 脚本，且按 DOM 顺序（顺序即原始执行顺序）。
      scripts: Array.from(document.querySelectorAll("script[src]")).map((s) => ({
        src: s.getAttribute("src"),
        type: s.getAttribute("type"),
        noModule: s.hasAttribute("nomodule"),
      })),
      preloads: Array.from(
        document.querySelectorAll('link[rel="modulepreload"][href]'),
      ).map((l) => l.getAttribute("href")),
      cssHrefs: Array.from(
        document.querySelectorAll('link[rel="stylesheet"][href]'),
      ).map((l) => l.getAttribute("href")),
      // 动态 chunk 只出现在 performance 资源里（webpack 的 loader 会把 script 摘掉）。
      resourceNames: performance.getEntriesByType("resource").map((e) => e.name),
    }));

    const fetchText = async (src, label) => {
      const abs = new URL(src, TARGET_URL).href;
      const res = await page.request.get(abs);
      if (!res.ok()) fail(`${label} 下载失败（${res.status()}）：${abs}`);
      return res.text();
    };

    const scriptEntries = [];
    for (const s of collected.scripts) {
      scriptEntries.push({ ...s, code: await fetchText(s.src, "内联脚本") });
    }
    const preloadEntries = [];
    for (const href of collected.preloads) {
      preloadEntries.push({ href, code: await fetchText(href, "modulepreload") });
    }

    // 已知路径（去 query）——动态 chunk 要排掉这些，避免重复执行。
    const knownPaths = new Set(
      [...collected.scripts.map((s) => s.src), ...collected.preloads].map(
        (u) => new URL(u, TARGET_URL).pathname,
      ),
    );
    const dynamicChunks = [];
    for (const name of collected.resourceNames) {
      if (!/\.js(\?|$)/.test(name)) continue;
      const url = new URL(name, TARGET_URL);
      if (!url.pathname.startsWith("/_next/static/chunks/")) continue;
      if (knownPaths.has(url.pathname)) continue;
      knownPaths.add(url.pathname);
      dynamicChunks.push({ href: name, code: await fetchText(name, "动态 chunk") });
    }

    // CSS 里的绝对 /_next 资源（next/font 的 woff2）→ base64 data: URI（上面已统一收好）。
    jsAssets = {
      scriptEntries,
      preloadEntries,
      dynamicChunks,
      cssAssets,
      cssHrefs: collected.cssHrefs,
      escaped: { scriptClose: 0, htmlComment: 0 },
    };
    info(
      `--with-react：<script src> ${scriptEntries.length} 个（${(
        scriptEntries.reduce((sum, e) => sum + Buffer.byteLength(e.code, "utf8"), 0) / 1024
      ).toFixed(1)} KB）· modulepreload ${preloadEntries.length} 个 · ` +
        `动态 chunk ${dynamicChunks.length} 个（${dynamicChunks
          .map((c) => c.href.replace(`${TARGET_URL}/`, ""))
          .join(", ") || "无"}）`,
    );
  }

  await browser.close();
  page = null;

  // ───────────────────────── 2. 组装自包含单文件 ─────────────────────────
  let html = `<!DOCTYPE html>\n${outerHtml}`;

  // `--with-js` 的成品是「静态快照 + 轻量脚本」，不是 React 应用：在文件顶部写死这句话，
  // 免得后来的人（或 agent）把它当成可水合产物。
  if (WITH_SHIM) {
    html = html.replace(
      /^<!DOCTYPE html>\n/i,
      () =>
        "<!DOCTYPE html>\n<!--\n  静态快照 + 轻量脚本（非 React 运行时）\n" +
        "  generated by frontend/scripts/export-hydrated.mjs --with-js\n" +
        "  这份 HTML 是水合后定格的静态标记；末尾的 vanilla 脚本只重放\n" +
        "  「卡头展开/折叠 · 文件行点击写 open-file-log · 主题切换 · 100 文件用例显隐」，\n" +
        "  没有 React 运行时 / hydration / router / inspector。React 状态、路由跳转、\n" +
        "  真实 onOpenFile 打开文件都不存在。\n-->\n",
    );
  }

  if (WITH_REACT && jsAssets) {
    // 2a. <script src> 原地换成内联块（**保持 DOM 顺序**）。原标签的 type 保留
    //     （本页全是 classic script，将来若出现 type=module 也照原样），nomodule 保留
    //     （polyfills 不能在现代浏览器执行）；async 去掉——内联块本来就在解析位同步执行，
    //     顺序比原来那批 async 外链更确定。
    let inlinedScripts = 0;
    html = html.replace(
      /<script\b([^>]*?)src="([^"]+)"([^>]*)>\s*<\/script>/gi,
      (_whole, before, src, after) => {
        const entry = jsAssets.scriptEntries.find((e) => e.src === decodeAttr(src));
        if (!entry) fail(`DOM 里有脚本但没取到内容：${src}（属性：${before}${after}）`);
        inlinedScripts += 1;
        const attrs = [
          entry.type ? `type="${escapeAttr(entry.type)}"` : "",
          entry.noModule ? "nomodule" : "",
          `data-inlined-from="${escapeAttr(inlineLabel(src))}"`,
        ]
          .filter(Boolean)
          .join(" ");
        jsAssets.escaped.scriptClose += countOf(entry.code, "</script");
        jsAssets.escaped.htmlComment += countOf(entry.code, "<!--");
        return `<script ${attrs}>\n${jsSafe(entry.code)}\n</script>`;
      },
    );
    if (inlinedScripts !== jsAssets.scriptEntries.length) {
      fail(
        `内联脚本数 ${inlinedScripts} ≠ 收集数 ${jsAssets.scriptEntries.length}` +
          `（水合 DOM 序列化后的 <script src> 标签与收集清单对不上）`,
      );
    }

    // 2b. <link rel=modulepreload> 换成 type=module 的内联块（本页 0 个，留通用性）。
    html = html.replace(/<link\b([^>]*?)rel="modulepreload"([^>]*?)>/gi, (_whole, before, after) => {
      const attrs = `${before}${after}`;
      const href = /href="([^"]+)"/.exec(attrs)?.[1];
      const entry = jsAssets.preloadEntries.find((e) => e.href === decodeAttr(href));
      if (!entry) fail(`modulepreload 没取到内容：${href}`);
      jsAssets.escaped.scriptClose += countOf(entry.code, "</script");
      jsAssets.escaped.htmlComment += countOf(entry.code, "<!--");
      return `<script type="module" data-inlined-preload="${escapeAttr(href)}">\n${jsSafe(entry.code)}\n</script>`;
    });

    // 2c. 动态 chunk：插到 <head> 最前面。它们在 webpack runtime 安装前只是
    //     `self.webpackChunk_N_E.push(...)` 进队列，runtime 初始化时统一安装；
    //     等 bootstrap 去 `__webpack_require__.e()` 时该 chunk 已是 installed，
    //     不再发请求。放在 main-app 之前是为了「安装先于 bootstrap」的确定性。
    if (jsAssets.dynamicChunks.length > 0) {
      const headOpen = /<head\b[^>]*>/i.exec(html);
      if (!headOpen) fail("没有 <head>，无法放置动态 chunk 注册脚本");
      const blocks = jsAssets.dynamicChunks
        .map((chunk) => {
          jsAssets.escaped.scriptClose += countOf(chunk.code, "</script");
          jsAssets.escaped.htmlComment += countOf(chunk.code, "<!--");
        return `<script data-inlined-dynamic="${escapeAttr(inlineLabel(chunk.href))}">\n${jsSafe(chunk.code)}\n</script>`;
        })
        .join("\n");
      html = html.replace(headOpen[0], () => `${headOpen[0]}\n${blocks}`);
    }

    // 2d. RSC flight 载荷里的资源 URL：React 水合时会按载荷重新插入 <link>，指到
    //     dev 服务器就会发请求。改写成本地 data: URI ——
    //     layout.css（CSS 已在唯一 <style> 里）→ `data:text/css,`；favicon → `data:,`。
    for (const href of jsAssets.cssHrefs) {
      if (!href) continue;
      html = html.split(href).join("data:text/css,");
    }
    html = html.split("/favicon.ico").join("data:,");
  }

  // 带 --with-react 时脚本块会留在成品里，后续「按字符串改 <link>/<style>/</head>」的
  // 手术必须先躲开它们：bundle 里有 `</head>`、`<style>`、`<link>` 字样，正则/索引
  // 会被带偏（第一版就踩了：`</head>` 命中的是 bundle 里的字符串，样式被塞进 JS 里）。
  let scriptBlocks = null;
  if (WITH_REACT) {
    scriptBlocks = [];
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (block) => {
      scriptBlocks.push(block);
      return `\u0000EXPORT_SCRIPT_BLOCK_${scriptBlocks.length - 1}\u0000`;
    });
  }

  // 不带 --with-react：照旧剥掉所有 <script>（--with-js 的 shim 在样式处理之后再加）。
  if (!WITH_REACT) {
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    html = html.replace(/<script\b[^>]*\/>/gi, "");
  }
  // <link> 一律不留（两种模式都自包含）。
  html = html.replace(/<link\b[^>]*>/gi, "");

  // 收掉页面自带的全部 <style>：它们的规则已经按 styleSheets 顺序并入 css（上面
  // 逐片取 cssRules，<style> 与同源 <link> 都覆盖到了）。DOM 里现有 12 片样式
  // （antd cssinjs / goober / 组件内动画 + Next stylesheet），不合并就做不到
  // 「单个 <style>」，也会让 `</style>` 计数 > 1。
  const inlineStylesBefore = (html.match(/<style\b/gi) || []).length;
  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

  // CSS 里的绝对 /_next 资源（next/font 的 woff2）→ base64 data: URI（离线不读文件/网络）。
  let cssText = css;
  if ((WITH_REACT || WITH_SHIM) && cssAssets.length > 0) {
    for (const asset of cssAssets) {
      cssText = cssText.split(asset.href).join(asset.dataUri);
    }
  }

  // 内联样式：单个 <style>，插到 </head> 之前（CSS 文本里的 </style 先转义，防截断）。
  const safeCss = cssText.replace(/<\/style/gi, "<\\/style");
  const styleTag = `<style data-export="hydrated-dom">\n${safeCss}\n</style>`;
  if (!/<\/head>/i.test(html)) fail("水合后的 DOM 里没有 </head>，无法内联样式");
  // 替换内容里有 bundle/CSS 文本，必须用函数形式：字符串 replacement 会把 `$&`、`` $` ``
  // `$'` 当特殊模式，静默篡改注入的代码（第一版动态 chunk 就被这样改坏过）。
  html = html.replace(/<\/head>/i, () => `${styleTag}</head>`);
  info(`原有 <style> ${inlineStylesBefore} 片 → 合并为 1 片`);

  // 把脚本块原样放回（占位符与 bundle 内容不会撞：NUL 不会出现在 JS 源码里）。
  if (scriptBlocks) {
    html = html.replace(/\u0000EXPORT_SCRIPT_BLOCK_(\d+)\u0000/g, (_match, index) => {
      const block = scriptBlocks[Number(index)];
      if (block === undefined) fail(`脚本占位符还原失败：#${index}`);
      return block;
    });
  }

  // `--with-js`：轻量脚本放 </body> 前（样式已内联，它不参与样式计算）。
  if (WITH_SHIM) {
    if (!/<\/body>/i.test(html)) fail("没有 </body>，无法追加轻量脚本");
    html = html.replace(/<\/body>/i, () => `${SHIM_SCRIPT}\n</body>`);
    info(`--with-js：已追加轻量脚本 ${Buffer.byteLength(SHIM_SCRIPT, "utf8")} 字节（静态快照可交互，非 React 运行时）`);
  }

  // ───────────────────────── 3. 校验 ─────────────────────────
  // 计数一律在「去掉 <style> 块」的标记面做：CSS 里也有 .wmde-markdown 选择器，
  // 混着数会把「样式规则」当成「正文元素」（上一版 0 个正文却显得有 markdown
  // 字样，就是这个坑的近亲）。带脚本的两种模式再剥掉 <script> 块：bundle/脚本里
  // 有 `</style>`、`<template>`、`data-testid="file-changes-card"` 之类字样，混着
  // 数会把 JS 字符串当标记。
  const htmlNoScripts =
    WITH_REACT || WITH_SHIM ? html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "") : html;
  const markup = htmlNoScripts.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  const markupNoScripts = markup;

  // 期望的 <script> 元素数：--with-react 是放回去的脚本块数，--with-js 恰好 1 段 shim。
  const expectedScriptCount = WITH_REACT
    ? scriptBlocks
      ? scriptBlocks.length
      : 0
    : WITH_SHIM
      ? 1
      : 0;

  const counts = {
    titleClose: countOf(markup, "</title>"),
    styleClose: countOf(htmlNoScripts, "</style>"),
    headClose: countOf(markup, "</head>"),
    bodyOpen: (markup.match(/<body\b/gi) || []).length,
    bodyClose: countOf(markup, "</body>"),
    // 按**元素**数（class 属性里以整词出现），不按字符串出现次数：wmde-markdown 库
    // 会给后代元素加 `wmde-markdown-var` 之类前缀类，按子串数会虚高一个量级
    // （实测 138 个正文块 vs 7038 次子串命中），虚高的数会掩盖「正文真缺」。
    markdown: (markup.match(/class="[^"]*"/g) || []).filter((attr) =>
      /(^|[\s"])wmde-markdown([\s"']|$)/.test(attr),
    ).length,
    markdownMentions: countOf(markup, "wmde-markdown"),
    metaDetail: countOf(markup, "turn-meta-detail"),
    turnBlock: countOf(markup, "turn-block"),
    template: (markup.match(/<template\b/gi) || []).length,
    // 真实 <script> 元素数：--with-react 用脚本块数，其余在标记面数（--with-js 的
    // shim 已被剥掉，所以单独按 `html` 里 shim 标签计数）。
    script: WITH_REACT
      ? scriptBlocks
        ? scriptBlocks.length
        : 0
      : WITH_SHIM
        ? (html.match(/<script\b[^>]*data-export-shim/gi) || []).length
        : (html.match(/<script\b/gi) || []).length,
    // `<link` 只在标记面数：bundle 里也有 `"<link"` 字符串。
    link: (markup.match(/<link\b/gi) || []).length,
  };

  // 内联之后必须**没有** `<script src>`、也没有绝对 `/_next/...` 引用。
  const scriptSrcLeft = (markup.match(/<script\b[^>]*\bsrc=/gi) || []).length;
  const nextRefs = [...new Set((html.match(/\/_next\/[^"'`\s)]*/g) || []))];

  // 残留的 CSR 占位（<template>）里是否还夹着 markdown 正文。
  const templates = markupNoScripts.match(/<template\b[\s\S]*?<\/template>/gi) || [];
  const templateWithMarkdown = templates.filter((t) => /wmde-markdown|markdown-text/.test(t)).length;

  // 轮间 hairline（2026-10-21 用户裁决「轮间 1px hairline 多余」）：turn-block 上
  // 不得再出现 border-b / border-border，只留 pb-7 的留白。
  const turnBlockTags = markupNoScripts.match(/<[a-z]+[^>]*data-testid="turn-block"[^>]*>/gi) || [];
  const turnBlockWithHairline = turnBlockTags.filter((tag) => /border-b|border-border/.test(tag)).length;
  const turnBlockWithoutWhitespace = turnBlockTags.filter((tag) => !/\bpb-7\b/.test(tag)).length;

  const problems = [];
  for (const [name, expected] of [
    ["titleClose", 1],
    ["styleClose", 1],
    ["headClose", 1],
    ["bodyOpen", 1],
    ["bodyClose", 1],
  ]) {
    if (counts[name] !== expected) problems.push(`${name}=${counts[name]}（应为 ${expected}）`);
  }
  if (counts.markdown < MIN_MARKDOWN) {
    problems.push(`.wmde-markdown=${counts.markdown} < ${MIN_MARKDOWN}（答复正文没进稿）`);
  }
  if (counts.metaDetail < MIN_META) {
    problems.push(`turn-meta-detail=${counts.metaDetail} < ${MIN_META}`);
  }
  if (templateWithMarkdown > 0) {
    problems.push(`残留 ${templateWithMarkdown} 个含 markdown 的 <template> CSR 占位`);
  }
  if (counts.script !== expectedScriptCount) {
    problems.push(
      `<script> × ${counts.script}（应为 ${expectedScriptCount}：` +
        `${WITH_REACT ? "--with-react 脚本块" : WITH_SHIM ? "--with-js 轻量脚本 1 段" : "纯静态 0 段"}）`,
    );
  }
  if ((WITH_REACT || WITH_SHIM) && scriptSrcLeft !== 0) {
    problems.push(`残留 <script src> × ${scriptSrcLeft}（有脚本没被内联）`);
  }
  if (counts.link !== 0) {
    problems.push(`残留 <link> × ${counts.link}（不满足自包含）`);
  }
  if (turnBlockWithHairline > 0) {
    problems.push(`${turnBlockWithHairline} 个 turn-block 仍带 border-b/border-border（轮间 hairline 未清）`);
  }
  if (turnBlockWithoutWhitespace > 0) {
    problems.push(`${turnBlockWithoutWhitespace} 个 turn-block 缺 pb-7（轮间留白被删过头）`);
  }

  if (problems.length > 0) fail(`校验未通过：\n  - ${problems.join("\n  - ")}`);

  // ───────────────────────── 4. 落盘 ─────────────────────────
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, html, "utf8");
  const bytes = Buffer.byteLength(html, "utf8");

  // ───────────────────── 5. 可选：file:// 截图（离线自证） ─────────────────────
  let shotInfo = null;
  if (SHOT_FILE) {
    const shotPath = path.resolve(SHOT_FILE);
    await mkdir(path.dirname(shotPath), { recursive: true });
    const shotBrowser = await chromium.launch();
    try {
      const shotPage = await shotBrowser.newPage({
        viewport: { width: 1600, height: 1000 },
        deviceScaleFactor: 1,
      });
      await shotPage.goto(pathToFileURL(OUT_FILE).href, {
        waitUntil: "load",
        timeout: HYDRATION_TIMEOUT_MS,
      });
      // 离线稿没有 JS：直接核 DOM 里答复正文的数量（证明答案真的在稿里）。
      const offline = await shotPage.evaluate(() => ({
        markdown: document.querySelectorAll(".wmde-markdown").length,
        metaDetail: document.querySelectorAll('[data-testid="turn-meta-detail"]').length,
        answerFontSize: (() => {
          const el = document.querySelector(".seg-text-body .wmde-markdown");
          return el ? getComputedStyle(el).fontSize : null;
        })(),
        processFontSize: (() => {
          const el = document.querySelector(
            '[data-testid="turn-progress-column"] div[role="button"]',
          );
          return el ? getComputedStyle(el).fontSize : null;
        })(),
      }));
      if (offline.markdown < MIN_MARKDOWN) {
        fail(`离线稿 file:// 打开后 .wmde-markdown=${offline.markdown} < ${MIN_MARKDOWN}`);
      }
      await shotPage.screenshot({ path: shotPath });
      shotInfo = { path: shotPath, ...offline };
    } finally {
      await shotBrowser.close();
    }
  }

  // ───────────────── 5b. 可选：--verify file:// 交互实测 ─────────────────
  let verify = null;
  if (VERIFY_SHOT) {
    const verifyPath = path.resolve(VERIFY_SHOT);
    await mkdir(path.dirname(verifyPath), { recursive: true });
    info("--verify：file:// 打开成品，实跑交互 + 零网络断言…");
    verify = await verifyOffline(OUT_FILE, verifyPath, WITH_REACT ? "react" : "shim");
  }

  const degraded = Boolean(verify && !verify.ok);
  const jsList = jsAssets
    ? [
        ...jsAssets.scriptEntries.map((e) => ({ kind: "script", label: e.src, code: e.code })),
        ...jsAssets.preloadEntries.map((e) => ({ kind: "modulepreload", label: e.href, code: e.code })),
        ...jsAssets.dynamicChunks.map((e) => ({ kind: "dynamic", label: e.href, code: e.code })),
      ]
    : [];
  const jsBytes = jsList.reduce((sum, e) => sum + Buffer.byteLength(e.code, "utf8"), 0);

  console.log("");
  console.log(
    degraded
      ? "[export-hydrated] ⚠️ 静态校验通过，但 file:// 实测未通过（见下）"
      : "[export-hydrated] ✅ 校验通过",
  );
  console.log(`  out                : ${OUT_FILE}`);
  console.log(`  bytes              : ${bytes.toLocaleString("en-US")}`);
  console.log(
    `  mode               : ${
      WITH_REACT
        ? "--with-react（React bundle 内联实验）"
        : WITH_SHIM
          ? "--with-js（静态快照 + 轻量脚本，非 React 运行时）"
          : "纯静态快照（无脚本）"
    }`,
  );
  console.log(`  </title>           : ${counts.titleClose}`);
  console.log(`  </style>           : ${counts.styleClose}`);
  console.log(`  </head>            : ${counts.headClose}`);
  console.log(`  <body>             : ${counts.bodyOpen}`);
  console.log(`  </body>            : ${counts.bodyClose}`);
  console.log(`  .wmde-markdown     : ${counts.markdown} 个元素 / ${counts.markdownMentions} 次字样   (元素 ≥ ${MIN_MARKDOWN})`);
  console.log(`  turn-meta-detail   : ${counts.metaDetail}   (≥ ${MIN_META})`);
  console.log(`  turn-block         : ${counts.turnBlock}`);
  console.log(`  <template> 残留     : ${counts.template}（含 markdown 的 ${templateWithMarkdown}）`);
  console.log(`  <script> / <link>  : ${counts.script} / ${counts.link}`);
  console.log(
    `  轮间 hairline       : ${turnBlockWithHairline} 个 turn-block 带线（应为 0） · ` +
      `${turnBlockTags.length} 个都留 pb-7（缺白处 ${turnBlockWithoutWhitespace}）`,
  );
  console.log(`  水合时正文字号      : ${hydrated.answerFontSize}`);
  if (WITH_REACT && jsAssets) {
    console.log(
      `  --with-react 脚本    : ${jsList.length} 个 / ${(jsBytes / 1024).toFixed(1)} KB` +
        `（script ${jsAssets.scriptEntries.length} · modulepreload ${jsAssets.preloadEntries.length}` +
        ` · dynamic ${jsAssets.dynamicChunks.length}）`,
    );
    for (const item of jsList) {
      console.log(
        `    - [${item.kind}] ${inlineLabel(item.label)}  ${(Buffer.byteLength(item.code, "utf8") / 1024).toFixed(1)} KB`,
      );
    }
    console.log(
      `  转义次数            : </script ${jsAssets.escaped.scriptClose} 处 · ` +
        `<!-- ${jsAssets.escaped.htmlComment} 处`,
    );
  }
  if (WITH_SHIM) {
    console.log(
      `  --with-js 脚本      : 1 段 / ${(Buffer.byteLength(SHIM_SCRIPT, "utf8") / 1024).toFixed(1)} KB（vanilla shim）`,
    );
  }
  if (cssAssets.length > 0) {
    console.log(
      `  CSS 内联资源        : ${cssAssets.length} 个 / ${(
        cssAssets.reduce((sum, a) => sum + a.bytes, 0) / 1024
      ).toFixed(1)} KB → base64 data: URI`,
    );
  }
  console.log(
    `  残留 /_next 引用     : ${nextRefs.length} 处${
      nextRefs.length ? ` → ${nextRefs.slice(0, 6).join(" | ")}${nextRefs.length > 6 ? " …" : ""}` : ""
    }`,
  );
  if (shotInfo) {
    console.log(`  screenshot         : ${shotInfo.path}`);
    console.log(
      `  离线稿实测          : .wmde-markdown=${shotInfo.markdown} · turn-meta-detail=${shotInfo.metaDetail} · ` +
        `正文=${shotInfo.answerFontSize} · 过程行=${shotInfo.processFontSize}`,
    );
  }
  if (verify) {
    const h = verify.hydration || {};
    console.log(
      `  --verify 运行时     : ${verify.mode === "react" ? "React（要求水合痕迹）" : "vanilla shim"}`,
    );
    console.log(
      verify.mode === "react"
        ? `  水合痕迹            : ${h.hydrated ? `有（React 内部 key ${h.reactKeys} 个）` : "无 —— React 回退到客户端渲染"}`
        : `  shim 接管           : ${verify.shim.active ? "是" : "否"}（data-export-shim=${
            verify.shim.marker || "无"
          }）`,
    );
    const t = verify.firstCardToggle;
    if (t) {
      console.log(
        `  首卡头点击          : before=${JSON.stringify(t.before)} → 折叠=${JSON.stringify(t.afterCollapse)}` +
          ` → 展开=${JSON.stringify(t.afterExpand)}  ${t.ok ? "✓" : "✗"}`,
      );
    }
    const t2 = verify.secondCardToggle;
    if (t2) {
      console.log(
        `  第二张卡切换        : before=${JSON.stringify(t2.before)} → 折叠=${JSON.stringify(t2.collapsed)}` +
          ` → 展开=${JSON.stringify(t2.expanded)}  ${t2.ok ? "✓" : "✗"}`,
      );
    }
    if (verify.openFile) {
      console.log(
        `  文件行点击          : ${JSON.stringify(verify.openFile.path)} → open-file-log=` +
          `${JSON.stringify(verify.openFile.after)}（原 ${JSON.stringify(verify.openFile.before)}）  ` +
          `${verify.openFile.ok ? "✓" : "✗"}`,
      );
    }
    if (verify.theme) {
      console.log(
        `  dark 主题按钮       : data-theme=${JSON.stringify(verify.theme.theme)} · ` +
          `aria-pressed=${JSON.stringify(verify.theme.pressed)}  ${verify.theme.ok ? "✓" : "✗"}`,
      );
    }
    if (verify.longList) {
      console.log(
        `  100 文件用例显隐    : 可见行 ${verify.longList.visibleBefore} → ${verify.longList.visibleAfter}` +
          ` → ${verify.longList.visibleRestored}  ${verify.longList.ok ? "✓" : "✗"}`,
      );
    }
    console.log(
      `  http(s) 请求        : ${verify.network.httpRequests.length} 个` +
        `${verify.network.httpRequests.length ? ` → ${verify.network.httpRequests.join(" | ")}` : "（零网络 ✓）"}`,
    );
    console.log(
      `  console error       : ${verify.consoleErrors.length} 条` +
        `${verify.consoleErrors.length ? ` → ${verify.consoleErrors.slice(0, 5).join(" | ")}` : "（无 ✓）"}`,
    );
    console.log(
      `  pageerror           : ${verify.pageErrors.length} 条` +
        `${verify.pageErrors.length ? ` → ${verify.pageErrors.slice(0, 5).join(" | ")}` : "（无 ✓）"}`,
    );
    if (verify.skipped.length) console.log(`  跳过的检查          : ${verify.skipped.join(" | ")}`);
    console.log(`  screenshot         : ${verify.screenshot}`);
  }
  console.log("");

  if (degraded) {
    const failed = [];
    if (verify.mode === "react") {
      if (!(verify.hydration && verify.hydration.hydrated)) failed.push("没有水合痕迹（React 未接管）");
    } else if (!(verify.shim && verify.shim.active)) {
      failed.push("轻量脚本没有接管（window.__STATIC_SNAPSHOT_SHIM__ 缺失）");
    }
    if (!(verify.firstCardToggle && verify.firstCardToggle.ok)) failed.push("首卡头点击/展开不符合判据");
    if (!(verify.secondCardToggle && verify.secondCardToggle.ok)) failed.push("第二张卡点击/展开不符合判据");
    if (!(verify.openFile && verify.openFile.ok)) failed.push("文件行点击没有改写 open-file-log");
    if (!(verify.theme && verify.theme.ok)) failed.push("dark 主题按钮没有改写 html[data-theme]");
    if (!verify.network.ok) failed.push(`有 ${verify.network.httpRequests.length} 个 http(s) 请求`);
    if (verify.consoleErrors.length) failed.push(`console error × ${verify.consoleErrors.length}`);
    if (verify.pageErrors.length) failed.push(`pageerror × ${verify.pageErrors.length}`);
    if (verify.skipped.length) failed.push(`跳过检查 × ${verify.skipped.length}`);
    fail(`离线实测未通过（成品已落盘，可人工复核）：\n  - ${failed.join("\n  - ")}`);
  }
} catch (err) {
  if (page) await page.close().catch(() => {});
  await browser.close().catch(() => {});
  console.error(`\n[export-hydrated] ❌ FAIL: ${err && err.loud ? err.message : err && err.stack ? err.stack : String(err)}\n`);
  process.exit(1);
}
