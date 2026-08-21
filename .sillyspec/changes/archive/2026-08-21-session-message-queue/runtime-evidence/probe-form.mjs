import { createRequire } from "node:module";
const require2 = createRequire(new URL("../../../../frontend/package.json", import.meta.url));
const { chromium } = require2("@playwright/test");

const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage();
await p.goto("http://localhost:3000/login");
await p.getByPlaceholder("登录名").fill("verify-queue");
await p.getByPlaceholder("请输入密码").fill("Verify123!@#");
await p.getByRole("button", { name: /登\s*录|登录/ }).click();
await p.waitForURL((u) => !String(u).includes("/login"), { timeout: 15000 });
await p.goto("http://localhost:3000/sessions");
await p.getByLabel("会话消息输入").waitFor({ state: "visible", timeout: 20000 });
await p.locator('[aria-label^="选择机器"]').first().click();
await p.waitForTimeout(1500);
const machines = await p.locator('[aria-label^="选择机器"]').allInnerTexts();
const agents = await p
  .locator('[aria-label^="选择智能体"]')
  .evaluateAll((els) =>
    els.map((e) => `${e.getAttribute("aria-label")} | disabled=${e.disabled} | ${e.innerText.replace(/\n/g, "/")}`),
  );
console.log("machines:", JSON.stringify(machines));
console.log("agents:", JSON.stringify(agents, null, 1));
await b.close();
