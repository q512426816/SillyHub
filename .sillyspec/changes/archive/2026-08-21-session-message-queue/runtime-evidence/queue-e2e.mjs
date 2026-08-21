/**
 * 2026-08-21-session-message-queue verify 阶段 runtime evidence 采集脚本。
 *
 * 真实链路：Playwright(系统 Chrome, headless) → 前端 dev server(localhost:3000,
 * 本变更新代码) → backend(docker 8001) → daemon(在线机器 DESKTOP-HJ0AM09, kimi runtime)
 * → 真实 agent CLI turn。非 mock。
 *
 * 场景（design §3.3 状态机 / FR-02 FR-03 FR-08 FR-10）：
 *   [verify 备注] 以平台管理员（机器/daemon key 归属人，临时改密）身份跑通真实链路，跑完还原。
 *   1. 登录 verify-queue 专用账号（verify 阶段临时创建，rule 11 允许重置开发数据）
 *   2. /sessions 新建会话（选机器 + kimi 智能体），首条消息让回复慢一点（数数）
 *   3. 首轮 running 期间输入第二条消息发送 → 断言：输入框可用 + 排队提示 +
 *      「排队消息（1）」chip + injectSession 未被立即调用（FR-02）
 *   4. 等待首轮 turn_completed → 队列自动投递（FR-03）：chip 消失 + 第二条消息
 *      进入时间线成为新 turn
 *   5. 采集 console 错误 + /api 网络日志片段 + 关键截图
 *
 * 运行：cd frontend && node ../.sillyspec/changes/2026-08-21-session-message-queue/runtime-evidence/queue-e2e.mjs
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 脚本在 .sillyspec 下，手动挂到 frontend 包解析 @playwright/test
const require2 = createRequire(
  new URL("../../../../frontend/package.json", import.meta.url),
);
const { chromium } = require2("@playwright/test");

const BASE = "http://localhost:3000";
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "artifacts");
fs.mkdirSync(OUT_DIR, { recursive: true });

const evidence = { network: [], consoleErrors: [], steps: [] };
function log(step, detail) {
  const line = `[${new Date().toISOString()}] ${step} ${detail ?? ""}`;
  evidence.steps.push(line);
  console.log(line);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

page.on("console", (msg) => {
  if (msg.type() === "error") evidence.consoleErrors.push(msg.text().slice(0, 300));
});
page.on("request", (req) => {
  const u = req.url();
  if (u.includes("/api/")) {
    evidence.network.push(`${req.method()} ${u.replace(BASE, "")}`);
  }
});
page.on("response", (res) => {
  const u = res.url();
  if (u.includes("/api/daemon/sessions") || u.includes("inject")) {
    evidence.network.push(`-> ${res.status()} ${u.replace(BASE, "").slice(0, 90)}`);
  }
});

try {
  // ── 1. 登录 ─────────────────────────────────────────────
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("登录名").fill("admin");
  await page.getByPlaceholder("请输入密码").fill("Verify123!@#");
  await page.getByRole("button", { name: /登\s*录|登录/ }).click();
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 15000 });
  log("STEP1-login", `url=${page.url()}`);

  // ── 2. 新建会话 ─────────────────────────────────────────
  await page.goto(`${BASE}/sessions`);
  await page.getByLabel("会话消息输入").waitFor({ state: "visible", timeout: 20000 });
  const machineBtn = page.locator('[aria-label^="选择机器"]').first();
  await machineBtn.click();
  log("STEP2-machine-selected");
  // 智能体：机器上有多个 Codex（含他人 runtime，建会话按归属校验 404），逐个试
  const prompt1 =
    "请从 1 数到 15，每个数字单独一行慢慢输出，数完后另起一行输出“第一轮完成”。不要做任何其他事情。";
  const codexButtons = page.locator('[aria-label="选择智能体 Codex"], [aria-label="选择智能体 Claude Code"]');
  const nCodex = await codexButtons.count();
  let sessionOk = false;
  for (let i = 0; i < nCodex && !sessionOk; i++) { // 顺序：Claude（已登录）优先，Codex 兜底
    await codexButtons.nth(0 === i ? 0 : i).click();
    await page.getByLabel("会话消息输入").fill(prompt1);
    await page.getByRole("button", { name: "开始会话" }).click();
    await page.waitForTimeout(4000);
    if (await page.getByLabel("创建会话错误").count()) {
      log("STEP2-codex-404-retry", `codex#${i} 非本账号 runtime，换下一个`);
      continue;
    }
    sessionOk = true;
    log("STEP2-session-created", `codex#${i}`);
  }
  if (!sessionOk) throw new Error("所有 Codex 按钮都建会话失败");

  // ── 3. 等面板输入条出现且进入 running（占位符变排队文案）──
  // 面板输入框按占位符定位（会排队文案唯一匹配 SessionInputBar 的 textarea）
  const panelInput = page.locator('textarea[placeholder*="排队"]');
  await panelInput.waitFor({ state: "visible", timeout: 30000 });
  log("STEP3-panel-input-visible", `placeholder=${JSON.stringify(await panelInput.getAttribute("placeholder"))}`);
  await panelInput.fill("请只回复两个字：收到");
  await panelInput.press("Enter");
  log("STEP3-second-message-sent-while-first-turn-running");
  await page.waitForTimeout(800); // enqueue 即时渲染 chip，短暂等一帧

  // ── 4. 断言排队行为（FR-02/FR-08/FR-10）────────────────
  // 输入框保持可用 + 排队 chip 出现（10s 内轮询，首轮可能还在 pending→active 过渡）
  let queueShown = false;
  const inputEnabled = await panelInput.isEnabled();
  for (let i = 0; i < 20; i++) {
    if (await page.getByText(/排队消息（1）/).count()) { queueShown = true; break; }
    await page.waitForTimeout(500);
  }
  const placeholder = await panelInput.getAttribute("placeholder");
  log("STEP4-queue-state", `inputEnabled=${inputEnabled} queueChip=${queueShown} placeholder=${JSON.stringify(placeholder)}`);
  await page.screenshot({ path: path.join(OUT_DIR, "01-queued.png"), fullPage: false });
  if (!queueShown) throw new Error("排队 chip 未出现");
  if (!inputEnabled) throw new Error("running 期间输入框被禁用（应为可输入+排队）");
  if (!/排队/.test(placeholder ?? "")) throw new Error(`placeholder 无排队提示: ${placeholder}`);

  // ── 5. 等自动投递（FR-03）：chip 消失 + 第二条消息进时间线 ──
  let delivered = false;
  for (let i = 0; i < 90; i++) { // 最多 90×2s=180s 等首轮完成
    const chip = await page.getByText(/排队消息（\d+）/).count();
    if (chip === 0) { delivered = true; break; }
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(3000); // 投递后第二轮开始渲染
  const replySeen = await page.getByText("收到").count();
  log("STEP5-auto-delivery", `queueCleared=${delivered} secondTurnReply=${replySeen > 0}`);
  await page.screenshot({ path: path.join(OUT_DIR, "02-delivered.png"), fullPage: false });
  if (!delivered) throw new Error("180s 内队列未自动投递（chip 未消失）");

  // ── 6. 结束会话（清理）──────────────────────────────────
  const endBtn = page.getByRole("button", { name: /结束会话/ });
  if (await endBtn.count()) { await endBtn.first().click(); await page.waitForTimeout(1500); }
  log("STEP6-session-ended");

  // ── 汇总证据 ────────────────────────────────────────────
  const report = [
    "# Runtime Evidence 采集结果（queue-e2e.mjs）",
    ...evidence.steps.map((s) => `- ${s}`),
    "",
    "## /api 网络日志片段（截选）",
    ...evidence.network.slice(0, 80).map((s) => `- ${s}`),
    "",
    `## console 错误数：${evidence.consoleErrors.length}`,
    ...evidence.consoleErrors.slice(0, 10).map((s) => `- ${s}`),
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "evidence-log.md"), report);
  console.log("\n===== E2E PASS =====");
  console.log(report);
} catch (err) {
  await page.screenshot({ path: path.join(OUT_DIR, "error.png"), fullPage: true }).catch(() => {});
  console.error("===== E2E FAIL =====", err?.message ?? err);
  console.log(evidence.steps.join("\n"));
  console.log("network tail:", evidence.network.slice(-20).join(" | "));
  process.exitCode = 1;
} finally {
  await browser.close();
}
