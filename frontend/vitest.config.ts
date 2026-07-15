import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // 全量并行时 jsdom environment setup 累积变慢，个别组件测试（如
    // page-team-toggle）在全量下会超 5s 默认上限 → 提到 15s 治 flaky 超时
    // （不拖慢通过的测试，仅放宽上限）。
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
