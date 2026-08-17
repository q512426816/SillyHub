---
author: qinyi
created_at: 2026-08-17 13:45:33
scale: large
---

# 设计文档（Design）— 扫描统一到会话（scan-into-session）

## 1. 背景

工作区「扫描」目前由「智能体控制台」（`/workspaces/{id}/agent`）承载：页面展示 run 列表 + 实时日志，用户点击「启动扫描」派发一个 AgentRun。但底层事实是——`start_scan_dispatch`（`backend/app/modules/agent/service.py:1709`）**已经创建 `AgentSession`**（config.mode="scan"，走 interactive lease + SESSION_INJECT 首 turn 注入，AskUserQuestion 真阻塞等人审），只是：

- 该 AgentSession **未绑定 `workspace_id`** → 工作区会话列表（`agent/router.py:605` 按 `AgentSession.workspace_id == workspace_id` 过滤）永远看不到 scan 会话；
- 前端展示走 run 日志视图（`agent/page.tsx`），没有接入会话面板（`InteractiveSessionPanel`）；
- 变更中心已完全会话驱动（删了「+新建变更」，空态引导去会话页，agent 在会话里自动立项并推进），扫描仍是 run 视角，概念不一致。

用户要求：点击扫描 → 触发会话内容进入会话中执行，摈弃「智能体控制台」概念，与变更中心的会话驱动模型对齐。

## 2. 设计目标

1. **扫描即会话**：scan 的 AgentSession 补绑 `workspace_id`，出现在工作区会话列表（带「扫描」徽标），可 attach、可干预、可审批、可 reopen 继续对话。
2. **配置卡触发 → 进入会话**：工作区配置卡「扫描」按钮保留原地触发，确认后跳转会话页并自动 attach 新建的 scan 会话（`ScanGenerateResponse` 补 `session_id` 支持深链）。
3. **移除智能体控制台**：删除 `/workspaces/{id}/agent` 页面与菜单入口；任务 run 归任务详情页（已有 run 列表 + 日志），阶段 run 归变更详情页执行日志（已有 `ChangeAgentRunLog`）。
4. **零新增机制**：复用现有会话面板全部能力（SSE 实时日志 / AskUserQuestion 审批 / 中断 / 结束 / reopen）。

## 3. 非目标（Non-Goals）

- **不重构 scan dispatch 为 `create_session` 变体**（方案 C 不做）：`start_scan_dispatch` 的 scan bundle 构建、lease 元数据、SESSION_INJECT、postSpecSync 回写链路保持不变，仅补绑定字段。
- **不在会话页新增「启动扫描」按钮**：入口保留在配置卡（用户已确认）。
- **不迁移移动端（`/m/workspaces`）扫描入口**：移动页扫描行为本轮不改，单独跟进。
- **不在工作区级提供跨 run 聚合历史视图**：用户已确认接受移除后的视图格局。
- **不改变 scan 指令内容 / 扫描流程本身**（bundle 构建、postSpecSync、scan_docs reparse 均不动）。

## 4. 拆分判断

- 功能模块：后端绑定 + 响应字段 + 前端跳转 + 深链 + 删页，是一个「配置卡 → scan-generate → 会话页 attach」的单一交互流程的组成部分，非 3 个可独立交付的功能模块。
- 角色权限：无新增角色/权限差异（沿用 workspace member / task:read 等既有权限）。
- 批量模式：不适用（非「模板 × 数据」）。
- 结论：**不拆分**，单一 change 走完整流程。方案 C（统一 create_session）记为后续演进路径，本轮不做。

## 5. 总体方案（方案 A：会话收敛·最小侵入）

> 决策覆盖：D-001@v1（方案 A 选择）、D-002@v1（扫描入口留配置卡 + 触发后进入会话页）、D-003@v1（智能体控制台完全移除）、D-004@v1（Design Grill 修订）——详见 decisions.md。

### Phase 1 — 后端：scan 会话成为一等公民

1. `agent/service.py` `start_scan_dispatch`：`AgentSession(...)` 构造补 `workspace_id=workspace_id`（L1709-1721 区间）。
2. `workspace/service.py` `scan_generate`：返回值由 `(workspace_id, agent_run_id)` 扩展为 `(workspace_id, agent_run_id, session_id)`；`_find_active_scan_run` 早返回分支从 `existing_run.agent_session_id` 取 session_id 一并返回；`start_scan_dispatch` 返回的 run 对象带 `agent_session_id`。
3. `workspace/schema.py` `ScanGenerateResponse` 补 `session_id: uuid.UUID | None`。
4. `workspace/router.py` `scan_generate` 端点组装响应时回填 session_id。
5. `daemon/schema.py` `AgentSessionListItem` 补 `mode: str | None = None`；**两个组装点都需填充**（均显式构造，非 from_attributes）：`agent/router.py` `_assemble_workspace_session_items`（工作区列表）与 `change/router.py` `list_change_sessions`（变更级列表，L378 附近）。
6. `pnpm gen:types` 刷新 `frontend/src/lib/api-types.ts` + `backend/openapi.json`（CLAUDE.md 规则 21）。

### Phase 2 — 前端：配置卡触发 → 进入会话

1. `components/workspace-config-card.tsx`：
   - `handleScan` 成功后：`router.push(/workspaces/{workspaceId}/sessions?session=${result.session_id})`；
   - 删除内嵌 scan 运行面板相关（`setActiveScanRunId` / `scanStatus` / `AgentRunPanel` onDone 回调），改为跳转；409 确认重扫逻辑保留。
2. 会话页深链 attach：`components/workspace-session-section.tsx` 读取 URLSearchParams `session` → 复用 `handleSelectById` 流程（fetch logs → setActiveSessionId）；`?session` 变化时更新选中。**竞态处理**：深链参数可能早于会话列表异步加载到达，未命中时不得静默 no-op——直接 `getAgentSessionLogs(sessionId)` + `setActiveSessionId`（不依赖列表），列表就绪后仍按既有过滤展示。
3. 会话列表徽标：`AgentSessionListItem.mode === "scan"` → 显示「扫描」badge。`components/daemon/session-list-layout.tsx` 的 `SessionListEntry` 补可选 `kind?: "scan" | "chat"` 字段，行内渲染徽标（runtimes 弹窗/变更会话不传则零回归）；workspace-session-section 组装 entry 时传 kind。
4. 移除智能体控制台：
   - 删除 `frontend/src/app/(dashboard)/workspaces/[id]/agent/`（page.tsx + __tests__/）；
   - `app/(dashboard)/workspaces/[id]/page.tsx:358` 菜单删除「智能体」入口；
   - `app/(dashboard)/workspaces/[id]/components/page.tsx` NAV_ITEMS（L33）删除「智能体」入口；
   - `lib/menu-permissions.ts`（L168-191）删除「智能体控制台」菜单组（menuKey=agent）；同步清理 `lib/__tests__/menu-permissions.test.ts`（L117/L154/L380）与 `lib/__tests__/permission.test.ts`（L245-249）的 agent 菜单断言；该组挂的 13 个 task:/code:/tool: 权限 key 由其它菜单组/权限 picker 覆盖或自然移除（核查后处理）；
   - 核查并清理仅被 agent page 引用的模块（`lib/use-agent-runs.ts` + 测试）；仍被配置卡/任务页/变更详情页使用的保留（`AgentRunPanel` 被 change-agent-run-log.tsx 复用，**保留**）；
   - **引用核查必须含导航入口 grep**：`href: "agent"` / `"/agent"` / `workspaces/${...}/agent`（含 menu-permissions、components/page、page.tsx 三处），不留死链。

### Phase 3 — 测试与验收

- 后端：新增/适配测试——`start_scan_dispatch` 建 session 带 workspace_id；`scan_generate` 返回 session_id（含早返回分支）；`AgentSessionListItem.mode` 两个组装点填充；适配既有 `test_daemon_client_scan.py`（解包三元组）/ `test_scan_provider.py` / `test_agent_sessions_include_ended.py` / `test_change_session.py`（变更级列表 mode）。
- 前端：config card 测试（成功后 router.push 断言）；workspace-session-section 深链 attach 测试；`workspaces/[id]/page.test.tsx` 渲染配置卡的 scanGenerate mock 补 session_id + push 断言；`menu-permissions.test.ts` / `permission.test.ts` agent 菜单断言清理；删除 agent page 相关测试（`agent/page.test.tsx`、`use-agent-runs.test.tsx`）。**`borrow-trigger-contract.test.ts` 保留**（其守护的契约——scanGenerate 仍是触发入口——在方案 A 中依然成立，仅当契约内容变化才适配，不删除）。
- 全量：backend pytest（模块级）、frontend vitest、lint、typecheck；gen:types 产物提交。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/app/modules/agent/service.py | start_scan_dispatch 的 AgentSession 补 workspace_id |
| 修改 | backend/app/modules/workspace/service.py | scan_generate 返回 session_id（含早返回分支） |
| 修改 | backend/app/modules/workspace/schema.py | ScanGenerateResponse 补 session_id |
| 修改 | backend/app/modules/workspace/router.py | scan_generate 端点响应回填 session_id |
| 修改 | backend/app/modules/daemon/schema.py | AgentSessionListItem 补 mode |
| 修改 | backend/app/modules/agent/router.py | _assemble_workspace_session_items 填充 mode（组装点一） |
| 修改 | backend/app/modules/change/router.py | list_change_sessions 组装点二补 mode（L378 附近） |
| 修改 | frontend/src/lib/api-types.ts | gen:types 产物（session_id / mode） |
| 修改 | backend/openapi.json | gen:types 产物 |
| 修改 | frontend/src/components/workspace-config-card.tsx | 扫描成功后跳转会话页，移除内嵌 run 面板 |
| 修改 | frontend/src/components/workspace-session-section.tsx | ?session= 深链 attach（含竞态处理）+ scan 徽标 kind 传递 |
| 修改 | frontend/src/components/daemon/session-list-layout.tsx | SessionListEntry 补可选 kind 字段 + 行内徽标渲染 |
| 删除 | frontend/src/app/(dashboard)/workspaces/[id]/agent/ | 智能体控制台页（page.tsx + __tests__/） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/page.tsx | 菜单删除「智能体」入口 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx | NAV_ITEMS 删除「智能体」入口（防死链） |
| 修改 | frontend/src/lib/menu-permissions.ts | 删除「智能体控制台」菜单组（menuKey=agent） |
| 修改 | frontend/src/lib/daemon.ts | AgentSessionListItem 类型补 mode（手写 interface，手改对齐） |
| 删除 | frontend/src/lib/use-agent-runs.ts + lib/__tests__/use-agent-runs.test.tsx | 仅 agent 页使用 |
| 测试 | backend/app/modules/workspace/tests/*、agent/tests/*、change/tests/* | 新增/适配 session_id、workspace_id、mode（两组装点）断言 |
| 测试 | frontend/src/components/workspace-config-card.test.tsx、workspaces/[id]/page.test.tsx、__tests__/workspace-session-section.test.tsx | 跳转断言 + 深链测试 + mode 徽标 |
| 测试 | frontend/src/lib/__tests__/menu-permissions.test.ts、__tests__/permission.test.ts | agent 菜单断言清理 |

## 7. 生命周期契约

涉及 session / lease / agent_run 关键事件（本变更不新增事件，仅改绑定与响应字段；事件本身走既有协议）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
| --- | --- | --- | --- | --- |
| scan-generate POST | frontend 配置卡 | backend | root_path, daemon_id | 新建 AgentSession(pending) + AgentRun(pending) + lease(pending, kind=interactive) |
| SESSION_INJECT | backend ws_hub | daemon | session_id, lease_id, run_id, prompt | AgentSession pending→active；AgentRun pending→running |
| AskUserQuestion | daemon | backend/frontend | 会话内审批（既有 PERMISSION_REQUEST 门控） | running 阻塞等待人工 |
| 会话结束 / reopen | 用户/frontend | daemon/backend | session_id | active→ended；reopen→active（复用既有能力） |

## 8. 风险登记（Risk）

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| R1 会话页深链 attach 与 activeSessionId 状态机交互 + 列表异步加载竞态 | 低 | 复用 handleSelectById 流程；深链未命中时直接 getAgentSessionLogs + setActiveSessionId（不依赖列表就绪），?session 变化同步 state |
| R2 agent 页删除波及共享组件与导航入口 | 中 | 删除前 grep 引用核查（含导航入口 href: "agent" / "/agent"）；仍被配置卡/任务页/变更详情页使用的保留（AgentRunPanel 保留） |
| R3 scan 会话标题依赖首条 user_input log | 低 | daemon create_session 已落首 prompt 为 user_input（service.py 注释，行号 397-410 已漂移至 L850-859），标题正常 |
| R4 gen:types 依赖 node_modules 健康 | 中 | 按 CLAUDE.md 规则 21：先 `pnpm exec tsc --version` 验证，必要时 `pnpm install --force` |
| R5 scan 徽标依赖 AgentSessionListItem.mode 新字段 | 低 | 后端 schema + 两组装点 + gen:types 同 change 内完成；前端手写 AgentSessionListItem（daemon.ts）同步补字段，不留类型债 |
| R6 menu-permissions 删除「智能体控制台」菜单组牵连角色权限 picker | 中 | 该组挂 13 个 task:/code:/tool: 权限 key；删除前核查这些 key 是否被其它菜单组引用，若仅该组持有则随组移除并在权限 picker 断言中同步清理 |

## 9. 自审（Self-Review）

- **一致性**：scan 会话底层已是 interactive AgentSession，本设计只是把它"扶正"（绑 workspace_id + 前端接入会话视图），与现状代码一致，非新造概念。
- **范围控制**：非目标明确（不重构 dispatch、不加会话页扫描按钮、不动移动端、不做跨 run 聚合），防 scope creep。
- **回归面**：删除 agent page 是主要风险点——引用核查覆盖组件模块（use-agent-runs 可删、AgentRunPanel 保留）**与导航入口**（menu-permissions 菜单组、components/page NAV_ITEMS、page.tsx 快捷导航三处），防死链；测试清理与实现同 change。
- **契约完整性**：生命周期表覆盖 scan 会话从创建到结束/reopen 全事件；无新增事件，字段变化集中在响应 DTO（session_id/mode），前端类型经 gen:types 对齐。
- **遗留疑问**：`_find_active_scan_run` 早返回分支的 run 若为历史老 run（agent_session_id 为 NULL），session_id 返回 null——前端跳转应容忍 null（仅跳会话页不深链，或提示已有扫描进行中）；此分支在设计中显式标注。
- **Design Grill 修订记录**（2026-08-17）：据独立审查子代理 verdict（specVerdict=pass / qualityVerdict=fail）修订——P1-1 补 menu-permissions.ts 菜单组删除（+R6 风险）、P1-2 补 components/page.tsx 导航、P2-1 保留 borrow-trigger-contract.test.ts、P2-2 补 change/router.py 第二组装点并修正 from_attributes 措辞、P2-3 补深链竞态处理、P2-4 补 page.test.tsx 测试计划、P2-5 明确 session-list-layout kind 徽标方案。
