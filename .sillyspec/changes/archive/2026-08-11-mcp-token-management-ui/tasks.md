# 任务（Tasks）— McpToken 管理 UI

---
author: qinyi
created_at: 2026-08-11 14:55:00
---

> 详细 Wave 分组 + 依赖关系在 plan 阶段落地。此处为任务总表（执行单元清单）。

## Wave 1：数据层 + 页面主体

- [ ] task-01：新增 `frontend/src/lib/mcp-tokens.ts` — `listMcpTokens`/`createMcpToken`/`revokeMcpToken` 三函数（apiFetch + 复用 api-types 类型，GET unwrap `.items`），对齐 `@/lib/api-keys` 风格。
- [ ] task-02：新增 `frontend/src/app/(dashboard)/workspaces/[id]/mcp-tokens/page.tsx` — `PageHeader`（标题 + workspace 面包屑 + 刷新/签发按钮）+ 3 张 `StatCard`（内联复制自 api-keys）+ `SectionCard` 表格（FR-01 列）+ `EmptyState`。手写 `useState`/`useEffect` load。
- [ ] task-03：page.tsx 捕获 `GET 403` → 展示"无权限"空态（FR-05，D-001@v1）。
- [ ] task-04：page.tsx 吊销交互 — 二次确认 + `revokeMcpToken` + 刷新（FR-03）。

## Wave 2：签发弹窗 + 导航 + 测试

- [ ] task-05：新增 `frontend/src/components/mcp-token-create-dialog.tsx` — 双 phase（form/plaintext），复刻 `api-key-create-dialog.tsx` 模式。form：name + scope 多选（默认 read+dispatch）。plaintext：明文一次展示 + 复制 + 警示 + 连接信息（FR-02）。
- [ ] task-06：弹窗接入 page.tsx「签发」按钮（`workspaceId` prop + `onCreated` 刷新）。
- [ ] task-07：修改 `frontend/src/components/workspace-tabs.tsx` — 静态 `as const` TABS 数组加「MCP 令牌」项（紧邻「MCP」tab，全可见 D-001@v1，execute 时核对数组 key/path/label 字段）。
- [ ] task-08：vitest 单测 — lib 三函数（mock fetch）+ 弹窗双 phase 切换 + page 403 空态 + 吊销确认。
- [ ] task-09：回归核查 — 现有 api-keys 页、workspace 其他 tab、`/workspaces/[id]/mcp` 只读页零影响。

## 全局验收

- [ ] 三操作端到端对接 live backend（8001）可用。
- [ ] viewer 进入页面看到无权限提示非崩溃。
- [ ] vitest 全绿 + tsc 0 错。
- [ ] design.md §6 文件清单全覆盖，无遗漏。
