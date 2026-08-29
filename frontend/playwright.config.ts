// Playwright E2E 配置（design §3.1/§6，task-01）
// 要点：
// - workers: 1 串行执行：测试数据无竞争 + 避免并发突发（计数上限由 R8 限流放宽兜底）
// - 不配置 webServer（D-001@v1）：本机手动前置起 dev/start，参考 multica 同款哲学，避免端口冲突
// - locale zh-CN 对齐界面语言；trace retain-on-failure 便于失败回溯
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    headless: true,
    locale: "zh-CN",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  reporter: [["list"], ["html", { open: "never" }]],
});
