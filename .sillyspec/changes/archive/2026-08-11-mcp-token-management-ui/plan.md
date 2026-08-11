---
plan_level: light
author: qinyi
created_at: 2026-08-11 15:05:00
---

# 轻量计划（Light Plan）：McpToken 管理 UI

## 来源
brainstorm 变更 `2026-08-11-mcp-token-management-ui` 结论：workspace 内新独立页 `/workspaces/[id]/mcp-tokens`，1:1 镜像 `settings/api-keys`（workspace-scoped 版），纯前端、零后端改动。设计见 `design.md`，需求见 `requirements.md`（FR-01~06），决策见 `decisions.md`（D-001@v1）。

## 范围
- `frontend/src/lib/mcp-tokens.ts`（NEW）— API client 三函数 + 复用 api-types 类型
- `frontend/src/app/(dashboard)/workspaces/[id]/mcp-tokens/page.tsx`（NEW）— 管理主页完整（主体 + 403 空态 + 吊销 + 弹窗接入）
- `frontend/src/components/mcp-token-create-dialog.tsx`（NEW）— 签发弹窗
- `frontend/src/components/workspace-tabs.tsx`（MODIFY）— 加「MCP 令牌」tab
- 单测：`workspaces/[id]/mcp-tokens/__tests__/` + `lib/__tests__/` + `components/__tests__/`

单模块（frontend），无 schema/DB/状态机/agent 调度改动。

## Tasks（Wave 间串行，Wave 内并行）

### Wave 1（并行，三个不同文件无冲突）
- [x] task-01: 新增 `lib/mcp-tokens.ts` — listMcpTokens(GET→unwrap .items)/createMcpToken(POST 201)/revokeMcpToken(DELETE)，对齐 `@/lib/api-keys` 风格（覆盖：FR-01, FR-02, FR-03 数据层）
- [x] task-03: 新增 `components/mcp-token-create-dialog.tsx` — 双 phase（form→plaintext）复刻 `api-key-create-dialog.tsx`；form: name(1-100)+scope 多选(默认 read+dispatch)；plaintext: 明文一次展示+复制+警示+连接信息；props 加 workspaceId（覆盖：FR-02）
- [x] task-04: 修改 `components/workspace-tabs.tsx` — 静态 as const TABS 数组加「MCP 令牌」项（紧邻现有「MCP」tab，全可见不隐藏）（覆盖：FR-04, D-001@v1）

### Wave 2（依赖 Wave 1：task-01 + task-03）
- [x] task-02: 新增 `workspaces/[id]/mcp-tokens/page.tsx` 完整实现 — PageHeader + 3 StatCard（内联复制自 api-keys）+ SectionCard 表格 + EmptyState + 手写 useState/useEffect load + GET 403 无权限空态（D-001@v1）+ 吊销二次确认 + 签发弹窗接入（合并自原 task-02/03/04/06，同改 page.tsx 须单 task 避免并行覆盖）（覆盖：FR-01, FR-02, FR-03, FR-05, FR-06, D-001@v1）

### Wave 3（依赖 Wave 2）
- [x] task-05: vitest 单测（lib 三函数 mock fetch + 弹窗双 phase + page 403 空态 + 吊销确认）+ 回归核查（api-keys 页、workspace 其他 tab、mcp 只读页零影响）（覆盖：AC-06）

## 验收
- AC-01: `lib/mcp-tokens.ts` 三函数对接 live backend（8001）端到端可用：list unwrap `.items`、create 收明文、revoke 返 204。
- AC-02: 签发弹窗双 phase：form 提交 → POST 201 → 明文**仅展示一次**（复制按钮 + 警示 + 连接信息）；关闭后明文不可再获取。
- AC-03: viewer（只读成员）进入页面 → `GET 403` → 显示"无权限"空态，非崩溃、不泄漏 token 存在性（D-001@v1）。
- AC-04: 吊销二次确认 → DELETE → 列表刷新、该 token 标已吊销；已吊销行无吊销按钮。
- AC-05: workspace 子导航出现「MCP 令牌」tab，紧邻「MCP」，对所有 bound 成员可见（D-001@v1）。
- AC-06: vitest 全绿 + `pnpm typecheck`/tsc 0 错；现有 api-keys 页与 workspace 其他页零回归。

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-02（GET 403 兜底空态）, task-04（tab 全可见） | AC-03, AC-05 |
