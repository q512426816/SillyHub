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
    // 纯逻辑测试（无 DOM）切 node 环境，省 jsdom 每文件初始化（全量
    // collect/environment 累计 300s+ 的大头是 jsdom 启动）。白名单精确匹配
    // src/lib 下确定无 DOM 的 .test.ts——5 个用 renderHook / fake EventSource
    // 依赖 jsdom 的文件不在此列（use-*、daemon-session）。若某文件后续引入
    // DOM 依赖，从白名单移除即可。
    environmentMatchGlobs: [
      [
        "src/lib/__tests__/{admin,agent,api,client-path,daemon-audit,daemon-permission,daemon-usage,format-token,mcp-tokens,menu-permissions,permission,ppm-workday,query-client,scan-docs-tree,token-refresh,workspace-path}.test.ts",
        "node",
      ],
      ["src/lib/{daemon,errors,workspace-binding,workspaces}.test.ts", "node"],
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
