# 设计文档（Design）— McpToken 管理 UI

---
author: qinyi
created_at: 2026-08-11 14:35:00
scale: large
risk_level: unit-sufficient
---

## 1. 背景

变更 `2026-08-06-public-mcp-server` 已交付后端：`POST/GET/DELETE /api/workspaces/{workspace_id}/mcp-tokens` 三端点（mcp_gateway/router.py），签发 workspace 级 MCP 访问凭据（明文 sha256 入库、仅 POST 201 返一次）。但**前端无任何页面调用**——`createMcpToken` 仅出现在生成的 `api-types.ts`，无 UI、无 hook、无路由。

实证缺口（2026-08-11 配置 `local.yaml` mcp 段时踩到）：用户要在 SillyHub 签一个 McpToken 接 sillyspec 派发，发现**既无界面**（侧边栏「MCP 配置」管的是 workspace 消费的 mcpServers，settings/api-keys 只签 `shk_live_` API Key），**`shk_live_` API Key 也签不了**（通用 `/api` 鉴权拒 API Key，只有 platform_sync 端点认；`/api/auth/me` 用它 → 401）。最终只能 `docker exec` 进 backend 容器调 `McpTokenService` 直建。这是 `2026-08-06-public-mcp-server` 只建后端+测试、未做管理 UI 的产品债。

## 2. 设计目标

- 补一个 workspace 内的 McpToken 管理页：**签发**（scope 多选 read/dispatch/converge，明文仅一次弹窗复制）/ **列表**（无明文，含 last_used_at/revoked_at）/ **吊销**（返 204，二次确认）。
- 1:1 复用 `settings/api-keys` 已验证的页面模式（`PageHeader`+`StatCard`+`SectionCard` 表格+独立 `CreateDialog`），保持视觉与交互一致。
- 零后端改动、零 schema/migration、零新权限（端点已就绪，权限 `WORKSPACE_WRITE`）。

## 3. 非目标（Non-Goals）

- **不做** McpWebhook 管理 UI（同模块另一组端点 `/api/workspaces/{id}/mcp-webhooks`，绑定 token 的回调，独立后续 change）。
- **不做** 任何后端改动（三端点 + DTO 已在 `2026-08-06-public-mcp-server` 交付，本变更纯前端）。
- **不改** 现有 `/workspaces/[id]/mcp` 只读页（该页展示 workspace 消费的 mcpServers，语义不同，保持不动）。
- **不做** 通用凭据管理组件抽象（api-keys 与 mcp-tokens 字段差异大——前者用户级带 expires_at/key_prefix，后者 workspace 级带 scope 多选无 expires——YAGNI，2 实例不值得抽象）。
- **不做** tab 级客户端权限隐藏（D-001@v1：客户端无 workspace-scoped WRITE 信号源，tab 对所有 bound 成员可见，靠服务端 403 兜底）。

## 4. 拆分判断

单变更、不拆分、不走批量。理由：单一功能域（workspace 内 McpToken CRUD）、~4 文件、紧贴一个参考模式（api-keys）。无 3+ 独立模块、无多角色视图、无跨页面状态流转，不满足拆分条件。McpWebhook UI 明确列为独立后续 change，不并入。

## 5. 总体方案

放置：workspace 路由 `/workspaces/[id]/mcp-tokens`（McpToken 是 workspace 级资源）。权限模型：靠**服务端 `WORKSPACE_WRITE` 兜底**——三端点均要求该权限（router.py:56 WorkspaceWriter），viewer（只读成员）调用直接 403。`WorkspaceBindingGuard` 只验 workspace binding 是否存在（不暴露 role/permission），不提供客户端权限信号。

**tab 可见性决策 D-001@v1（Design Grill C9）**：`workspace-tabs.tsx` 是静态 `as const` 数组、无 tab 级权限字段先例，且客户端无 workspace-scoped WRITE 信号源（MemberBindingView 仅 daemon_id/root_path/shared；`/api/auth/me` 权限是 platform∪all-workspace 并集）。故 **tab 对所有 bound 成员可见**（不按权限隐藏），viewer 点入由服务端 403 拦截、前端展示"无权限"空态（不泄漏 token 存在性）。与 `settings/api-keys`（用户级凭据）区分。

技术栈对齐 api-keys 页：**手写 `useState`+`useEffect`+`useCallback` + 手写 fetch**（**非 react-query**，与 api-keys 页一致），组件复用 `@/components/layout`（`PageContainer`/`PageHeader`/`SectionCard`）、`@/components/ui/*`（`Button`/`StatusBadge`/`EmptyState`）、`@/lib/errors`（`errMessage`/`useNotify`）。`StatCard` 是 api-keys 页**本地组件**（非 `@/components/layout` 共享），新页内联复制（与参考页同模式）。

无 Wave 拆分需求（单页 + 1 弹窗 + 1 lib + 1 导航项），plan 阶段按 1-2 Wave 组织（lib + page 主体 / 弹窗 + 导航 + 测试）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/lib/mcp-tokens.ts` | API client：`listMcpTokens(wsId)`（GET → unwrap `.items`）/ `createMcpToken(wsId,{name,scope})` / `revokeMcpToken(wsId,id)` + 类型（复用 `api-types.ts` 现有 `McpTokenRead`/`McpTokenCreated`，**无新增对外字段**）。对齐 `@/lib/api-keys` 的 `apiFetch` + 生成类型别名风格 |
| 新增 | `frontend/src/app/(dashboard)/workspaces/[id]/mcp-tokens/page.tsx` | 管理主页：`PageHeader`+3 张 `StatCard`（全部/活跃/已吊销，**从 api-keys 页内联复制**——该组件是 api-keys 本地组件非共享）+ `SectionCard` 表格 + `EmptyState`。捕获 GET 403 → 展示"无权限"空态（D-001@v1） |
| 新增 | `frontend/src/components/mcp-token-create-dialog.tsx` | 签发弹窗（双 phase：form/plaintext）：name 输入 + scope 多选（默认勾 read+dispatch）+ `workspaceId` prop → 提交 → 明文仅一次展示（复制 + 警示 + 连接信息）。复刻 `api-key-create-dialog.tsx` 双 phase 模式 |
| 修改 | `frontend/src/components/workspace-tabs.tsx` | 静态 `as const` TABS 数组加「MCP 令牌」tab 项（紧邻现有「MCP」tab，真实 label='MCP'）。**不按权限隐藏**（D-001@v1），对所有 bound 成员可见 |

**字段数据流**：本变更无新增对外字段/DTO/响应体——前端类型直接 import `api-types.ts` 已生成的 `McpTokenRead{ id,name,scope,last_used_at,revoked_at,created_at }` / `McpTokenCreated{ id,token,name,scope,created_at }` / `McpTokenCreateRequest{ name,scope[] }`（api-types.ts:10675-10738）。后端零改动，故无 producer→consumer 透传链可标。

## 7. 接口定义

**lib/mcp-tokens.ts**（对齐 `@/lib/api-keys` 风格）：
```ts
export type McpScope = "read" | "dispatch" | "converge";
export interface McpTokenRead { id: string; name: string; scope: string[]; last_used_at: string|null; revoked_at: string|null; created_at: string; }
export interface McpTokenCreated { id: string; token: string; name: string; scope: string[]; created_at: string; }

export async function listMcpTokens(workspaceId: string): Promise<McpTokenRead[]>;        // GET /api/workspaces/{id}/mcp-tokens → items
export async function createMcpToken(workspaceId: string, input: { name: string; scope: McpScope[] }): Promise<McpTokenCreated>;  // POST 201
export async function revokeMcpToken(workspaceId: string, tokenId: string): Promise<void>;  // DELETE 成功 204；已吊销/不存在/越权 → 404
```

**McpTokenCreateDialog props**：`{ workspaceId: string; onCreated: () => void; onClose: () => void }`（比 ApiKeyCreateDialog 多 `workspaceId`）。提交成功后内部切到"明文展示态"，`onCreated` 触发父表格刷新。

**page.tsx 表格列**：名称(+id 尾号) / scope(徽章) / 状态(活跃●/已吊销) / 最近使用 / 创建时间 / 操作(吊销，仅未吊销行)。状态判定：`revoked_at` 存在 → 已吊销，否则活跃（无 expires 概念）。

## 7.5 生命周期契约

**不涉及生命周期契约 / 不适用 lifecycle contract**：本变更是 McpToken 凭据的 CRUD（签发/列表/吊销），不涉及 session / lease / agent_run / daemon / lifecycle / state_transition / claim / heartbeat 等生命周期事件流转。吊销置 `revoked_at`，重复 DELETE 已吊销的返 404（防存在性探测，service.revoke 已实现）——单向标志位，非状态机；与 `2026-08-06-public-mcp-server` 的 worker mission 生命周期正交。

## 8. 风险登记（Risk）

| 风险 | 等级 | 缓解 |
|---|---|---|
| 明文令牌泄漏（截图/日志） | 中 | 弹窗醒目警示 + 列表永不展示明文/前缀（后端 `McpTokenRead` 无该字段）+ 仅 POST 201 一次 |
| viewer 点入 MCP 令牌 tab | 低 | D-001@v1：tab 对所有成员可见不隐藏；viewer 点入由服务端 `WORKSPACE_WRITE` 403 兜底，前端展示"无权限"空态（不泄漏 token 存在性） |
| 与现有「MCP」tab 命名混淆 | 低 | 新 tab 命名「MCP 令牌」区分（现有 tab 实际 label='MCP'）；副标题注明"外部客户端访问凭据" |
| gen:types 漂移（虽后端无改动） | 低 | 类型已在 `api-types.ts`（line 10675-10738），execute 前确认存在即可，无需重跑 gen:types |

## 9. 自审（Self-Review）

- ✅ 后端契约已逐行核实（router.py:114-191）：权限 `WORKSPACE_WRITE`、DTO 字段、明文仅 POST 201、吊销成功 204/重复 404、跨 workspace → 404。
- ✅ 参考模式已读全（api-keys/page.tsx 257 行）：手写 fetch 非 react-query，组件复用路径确认；StatCard 为本地组件需内联复制（已写入 §5/§6）。
- ✅ workspace 子导航落点确认（`workspace-tabs.tsx` 静态 `as const` 数组，加一项即可；现有 tab 真实 label='MCP'）。
- ✅ 无新增对外字段 → 无数据流透传缺口。
- ✅ Non-goals 明确（McpWebhook / 后端 / 改只读 mcp 页 / tab 客户端权限隐藏）。
- ✅ 零后端改动 → 无 schema/migration/permission 风险。
- ✅ Design Grill 独立审查通过（specVerdict/qualityVerdict 双 pass，12 项核实一致），P1 阻塞 C9 已由用户决策 D-001@v1（方案③，tab 全可见 + 服务端 403 兜底）解决。
- 待 plan/execute 落地：McpTokenCreateDialog 明文展示态具体 UI（按设计系统总纲）；page.tsx 捕获 GET 403 的"无权限"空态展示；workspace-tabs.tsx tab 项确切字段（key/path/label，execute 时核对数组结构）。
