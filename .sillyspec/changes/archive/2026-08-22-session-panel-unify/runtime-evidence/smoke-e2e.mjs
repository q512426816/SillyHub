/**
 * 2026-08-22-session-panel-unify verify 阶段 runtime evidence 冒烟脚本。
 *
 * 目标（design §4.B / plan 全局验收 4-5 / task-07 延后项）：
 *   1. 五个消费面真实渲染冒烟（真实 backend :8001，非 mock）：
 *      S1 /sessions 页（page 分支，选中真实会话看时间线）
 *      S2 /runtimes 弹窗（dialog 分支 + InteractiveSessionChatSection 双组件）
 *      S3 /workspaces/[id]/sessions（WorkspaceSessionSection）
 *      S4 /workspaces/[id]/changes/[cid]（ChangeSessionsCard）
 *   2. antd 基元机械断言：dialog 操作按钮/发送按钮 .ant-btn、主发送 .ant-btn-primary、
 *      提供方徽标 .ant-tag、状态徽标 .ant-badge（TurnStatusBadge）
 *   3. 双主题实证：顶栏 Palette 切换 → html[data-theme] 翻转 + 主按钮计算色变化截图
 *
 * 鉴权：本地铸造的只读 admin JWT（HS256 + deploy/.env SECRET_KEY，运行期 20 分钟，
 * 零密码改动零状态写入——比上变更「临时改密再还原 hash」更无痕）。
 * 只读冒烟：不发送消息、不创建/结束会话，仅导航+点击列表/弹窗+切主题。
 *
 * 运行：仓库根 node .sillyspec/changes/2026-08-22-session-panel-unify/runtime-evidence/smoke-e2e.mjs
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require2 = createRequire(new URL("../../../../frontend/package.json", import.meta.url));
const { chromium } = require2("@playwright/test");

const BASE = "http://localhost:3000";
const API = "http://127.0.0.1:8001";
const TOKEN = process.env.SMOKE_JWT;
if (!TOKEN) { console.error("缺 SMOKE_JWT 环境变量"); process.exit(1); }
const WS_ID = "b97f8231-9404-43bd-89de-38c281c4d875";
const CHANGE_ID = "a9cb4730-c4dc-4621-95a9-557626d156f6";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "artifacts");
fs.mkdirSync(OUT, { recursive: true });

const evidence = { steps: [], network: [], consoleErrors: [], assertions: [] };
const log = (s, d) => { const l = `[${new Date().toISOString()}] ${s} ${d ?? ""}`; evidence.steps.push(l); console.log(l); };
const assert = (name, ok, detail) => { evidence.assertions.push(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); };

async function waitForServer(url, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(url); if (r.ok || r.status < 500) return true; } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

// ── 0. dev server 自管（已在跑则复用） ──────────────────────
let devProc = null;
let serverReady = await waitForServer(BASE, 3000);
if (!serverReady) {
  log("STEP0-start-dev-server");
  devProc = spawn("pnpm", ["dev"], {
    cwd: path.resolve(HERE, "../../../../frontend"),
    shell: true, detached: true, stdio: "ignore",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  serverReady = await waitForServer(BASE, 150_000);
}
if (!serverReady) { console.error("dev server 未就绪"); process.exit(1); }
log("STEP0-dev-server-ready", `${BASE}${devProc ? "（本次拉起）" : "（复用已运行）"}`);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
await context.addInitScript(([token]) => {
  // 注意 persist version:1（version 0 会被 zustand 丢弃）+ 守卫要求 user 非空
  localStorage.setItem("multi-agent-platform.session", JSON.stringify({
    state: {
      hydrated: true,
      user: {
        id: "43f2e40a-0efc-559a-8a82-981306f42751",
        email: "admin@migrated.local",
        displayName: "系统管理员",
        is_platform_admin: true,
      },
      accessToken: token,
      refreshToken: null,
    },
    version: 1,
  }));
  localStorage.setItem("sillyhub-theme", "ai-native");
}, [TOKEN]);
const page = await context.newPage();
page.on("console", (m) => { if (m.type() === "error") evidence.consoleErrors.push(m.text().slice(0, 260)); });
page.on("response", (r) => {
  const u = r.url();
  if (u.includes("/api/") && r.status() >= 400) evidence.network.push(`HTTP ${r.status()} ${u.replace(API, "").slice(0, 110)}`);
});

async function themeSnap(tag) {
  const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  const shot = path.join(OUT, `${tag}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  return { theme, shot: path.basename(shot) };
}
async function toggleTheme() {
  await page.locator('button[aria-label^="切换主题"]').first().click();
  await page.waitForTimeout(600);
}
const antBtn = (name) => page.locator(`button.ant-btn:has-text("${name}")`);

try {
  // ── S1 /sessions（page 分支） ─────────────────────────────
  await page.goto(`${BASE}/sessions`, { waitUntil: "domcontentloaded" });
  await page.locator('[aria-label="会话列表"]').waitFor({ state: "visible", timeout: 30_000 });
  log("STEP1-sessions-page-loaded", page.url());
  // 选第一条会话（真实数据，仅点击选中——只读）
  const row = page.locator('[aria-label^="会话 "]').first();
  await row.waitFor({ state: "visible", timeout: 20_000 });
  await row.click();
  await page.waitForTimeout(2500);
  const sendBtn = page.locator("button.ant-btn-primary[title='发送']").first();
  const sendVisible = await sendBtn.isVisible().catch(() => false);
  assert("S1 发送按钮=antd primary", sendVisible, sendVisible ? "title=发送 class=ant-btn-primary" : "未见（无选中会话？）");
  const badgeCount = await page.locator(".ant-badge").count();
  assert("S1 TurnStatusBadge=antd Badge", badgeCount > 0, `页内 .ant-badge 数=${badgeCount}（含选中会话时间线状态徽标）`);
  const s1a = await themeSnap("01-sessions-ainative");
  assert("S1 初始主题=ai-native", s1a.theme === "ai-native", `data-theme=${s1a.theme}`);
  // 双主题证据源用主题 token 单一源 CSS 变量（--color-brand-600 随主题翻转；按钮可能因会话终态禁用而同色）
  const brandA = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-brand-600").trim());
  await toggleTheme();
  const s1b = await themeSnap("02-sessions-blue");
  const brandB = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-brand-600").trim());
  assert("S1 主题切换生效", s1b.theme === "blue", `data-theme=${s1b.theme}`);
  assert("S1 双主题品牌色翻转", !!brandA && !!brandB && brandA !== brandB, `--brand-600 ${brandA} → ${brandB}`);
  await toggleTheme(); // 切回
  log("STEP1-sessions-done", `截图 ${s1a.shot}/${s1b.shot}`);

  // ── S2 /runtimes 弹窗（dialog 分支 + ChatSection） ────────
  await page.goto(`${BASE}/runtimes`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  // 机器卡是受控手风琴：先展开第一台（在线机器）再找运行时卡的会话按钮
  const machineHead = page.locator('header[role="button"][aria-expanded="false"]').first();
  if (await machineHead.isVisible().catch(() => false)) {
    await machineHead.click();
    await page.waitForTimeout(1500);
    log("STEP2-machine-expanded");
  }
  // 精确选择器：title 含「会话」会误中「清理本地缓存（specs/会话日志/…）」按钮
  const openBtn = page.locator('button[title="打开该运行时的会话窗口"]').first()
    .or(page.locator('button[title="运行时离线，点击只读浏览会话历史"]').first());
  await openBtn.first().waitFor({ state: "visible", timeout: 30_000 });
  await openBtn.first().click();
  await page.waitForTimeout(3500);
  log("STEP2-runtime-dialog-opened");
  for (const name of ["新建会话", "结束会话"]) {
    const ok = await antBtn(name).first().isVisible().catch(() => false);
    assert(`S2 弹窗「${name}」=antd Button`, ok);
  }
  const tagCount = await page.locator(".ant-tag").count();
  assert("S2 提供方徽标=antd Tag", tagCount > 0, `.ant-tag 数=${tagCount}`);
  const dSend = await page.locator("button.ant-btn-primary[title='发送']").first().isVisible().catch(() => false);
  assert("S2 弹窗发送按钮=antd primary", dSend);
  const s2a = await themeSnap("03-runtimes-dialog-ainative");
  // 主题按钮被弹窗遮罩挡住：先关弹窗（Radix Escape）再切主题，重开取证
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  await toggleTheme();
  await openBtn.first().click();
  await page.waitForTimeout(2500);
  const s2b = await themeSnap("04-runtimes-dialog-blue");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await toggleTheme();
  log("STEP2-dialog-done", `截图 ${s2a.shot}/${s2b.shot}`);

  // ── S3 workspace 会话区 ───────────────────────────────────
  await page.goto(`${BASE}/workspaces/${WS_ID}/sessions`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const s3send = await page.locator("button.ant-btn-primary[title='发送']").first().isVisible().catch(() => false);
  assert("S3 workspace 会话区发送按钮=antd primary", s3send, s3send ? "" : "（选中前输入区未挂载？截图佐证）");
  const s3 = await themeSnap("05-workspace-sessions");
  log("STEP3-workspace-sessions", `data-theme=${s3.theme} 截图 ${s3.shot}`);

  // ── S4 change 详情会话卡 ──────────────────────────────────
  await page.goto(`${BASE}/workspaces/${WS_ID}/changes/${CHANGE_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const s4 = await themeSnap("06-change-detail");
  const hasCard = await page.locator("text=/会话/").first().isVisible().catch(() => false);
  log("STEP4-change-detail", `data-theme=${s4.theme} 截图 ${s4.shot} 会话卡=${hasCard}`);

  // ── 汇总 ─────────────────────────────────────────────────
  const failed = evidence.assertions.filter((a) => a.startsWith("❌"));
  log("SUMMARY", `断言 ${evidence.assertions.length} 条，失败 ${failed.length}；console错误 ${evidence.consoleErrors.length}；4xx/5xx ${evidence.network.length}`);
} catch (err) {
  log("FATAL", String(err).slice(0, 400));
  await page.screenshot({ path: path.join(OUT, "error.png") }).catch(() => {});
} finally {
  const md = [
    `# Runtime Evidence 冒烟日志（smoke-e2e.mjs）`, "",
    `时间：${new Date().toISOString()}；链路：Chrome headless → dev server ${BASE}（main 新代码）→ backend ${API}（真实数据）`, "",
    "## 断言", ...evidence.assertions, "",
    "## 步骤", ...evidence.steps, "",
    "## console 错误", ...(evidence.consoleErrors.length ? evidence.consoleErrors : ["（零）"]), "",
    "## HTTP ≥400", ...(evidence.network.length ? evidence.network : ["（零）"]), "",
  ].join("\n");
  fs.writeFileSync(path.join(OUT, "evidence-log.md"), md);
  await browser.close();
  if (devProc) { try { process.kill(-devProc.pid); } catch {} }
  console.log("evidence 写入", path.join(OUT, "evidence-log.md"));
}
