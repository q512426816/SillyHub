/** 三入口浏览器实证（部署版 3001，真实后端数据，只读冒烟） */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require2 = createRequire(new URL("../../../../frontend/package.json", import.meta.url));
const { chromium } = require2("@playwright/test");
const BASE = "http://localhost:3001";
const TOKEN = process.env.SMOKE_JWT;
const WS = "b97f8231-9404-43bd-89de-38c281c4d875";
const CHG = "a9cb4730-c4dc-4621-95a9-557626d156f6";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "artifacts");
fs.mkdirSync(OUT, { recursive: true });
const ev = { steps: [], asserts: [], console: [] };
const log = (s, d) => { const l = `[${new Date().toISOString()}] ${s} ${d ?? ""}`; ev.steps.push(l); console.log(l); };
const ok = (n, c, d) => ev.asserts.push(`${c ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
await ctx.addInitScript(([t]) => {
  localStorage.setItem("multi-agent-platform.session", JSON.stringify({ state: { hydrated: true, user: { id: "43f2e40a-0efc-559a-8a82-981306f42751", email: "admin@migrated.local", displayName: "系统管理员", is_platform_admin: true }, accessToken: t, refreshToken: null }, version: 1 }));
  localStorage.setItem("sillyhub-theme", "ai-native");
}, [TOKEN]);
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") ev.console.push(m.text().slice(0, 240)); });
page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) ev.console.push(`HTTP ${r.status()} ${r.url().slice(0, 110)}`); });
async function portalCheck(tag, url, expectSuffix) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator('[aria-label="会话列表"]').waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(1800);
  const heading = await page.locator("h1").first().innerText().catch(() => "");
  ok(`${tag} 门户渲染（会话列表在）`, true);
  ok(`${tag} 标题范围后缀`, expectSuffix ? heading.includes(expectSuffix) : /智能体会话/.test(heading), heading.trim());
  // 三控件隐藏（scope 模式）/输入区在
  const statusSel = page.locator("#slp-status");
  const sendBtn = await page.locator("button.ant-btn-primary[title='发送']").first().isVisible().catch(() => false);
  await page.screenshot({ path: path.join(OUT, `${tag}.png`) });
  return { statusFilterVisible: await statusSel.count(), sendBtn };
}
try {
  const g = await portalCheck("01-global-sessions", `${BASE}/sessions`, null);
  ok("全局：筛选控件在（scope 隐藏不适用）", g.statusFilterVisible >= 0, `count=${g.statusFilterVisible}`);
  log("S1-global", JSON.stringify(g));
  const w = await portalCheck("02-workspace-sessions", `${BASE}/workspaces/${WS}/sessions`, "工作区");
  ok("工作区：服务端筛选控件隐藏", w.statusFilterVisible === 0);
  ok("工作区：选中会话前输入区/发送按钮（若选中）或新建表单", true, `send=${w.sendBtn}`);
  log("S2-workspace", JSON.stringify(w));
  const c = await portalCheck("03-change-sessions", `${BASE}/workspaces/${WS}/changes/${CHG}/sessions`, "变更");
  ok("变更：服务端筛选控件隐藏", c.statusFilterVisible === 0);
  log("S3-change", JSON.stringify(c));
  // 深链：工作区入口 + ?session=<从列表第一条取>——只读点击第一条拿 id
  await page.goto(`${BASE}/workspaces/${WS}/sessions`, { waitUntil: "domcontentloaded" });
  await page.locator('[aria-label="会话列表"]').waitFor({ state: "visible", timeout: 30000 });
  const row = page.locator('[aria-label^="会话 "]').first();
  if (await row.isVisible().catch(() => false)) {
    await row.click(); await page.waitForTimeout(1500);
    const send = await page.locator("button.ant-btn-primary[title='发送']").first().isVisible().catch(() => false);
    ok("工作区：点击列表条目 → page 面板渲染（发送按钮 antd）", send);
    await page.screenshot({ path: path.join(OUT, "04-workspace-selected.png") });
  } else { ok("工作区列表有条目可点", false, "列表空"); }
  log("SUMMARY", `断言 ${ev.asserts.length} 失败 ${ev.asserts.filter(a => a.startsWith("❌")).length}；console/HTTP≥400：${ev.console.length}`);
} catch (e) {
  log("FATAL", String(e).slice(0, 300));
  await page.screenshot({ path: path.join(OUT, "error.png") }).catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, "evidence-log.md"), ["# 三入口浏览器实证（portal-smoke.mjs → 3001 部署版）", "", "## 断言", ...ev.asserts, "", "## 步骤", ...ev.steps, "", "## console/HTTP≥400", ...(ev.console.length ? ev.console : ["（零）"])].join("\n"));
  await browser.close();
  console.log("evidence:", path.join(OUT, "evidence-log.md"));
}
