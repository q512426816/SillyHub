---
author: qinyi
created_at: 2026-07-09T11:08:00
change: 2026-07-09-ask-user-question-approval
---

# Design · AskUserQuestion 审批中心集成

> 修订（Design Grill step12 交叉审查后）：修正 JOIN 路径（C1）、跳转路由（C8）、端点 router 归属（C7）；细化 run_summary/session_type（D-003）；SessionPermissionRequest 新字段全可选 + SSE 路降级（C4）；DialogContextBar 明确为兄弟包裹层（C5）；SSE 连接数上限（C10）。

## 1. 背景

用户在审批中心 `/approvals` 发现 AskUserQuestion（agent 向用户提问的结构化问答）触发后**看不到卡片**（scan/stage + 普通对话两场景都没有），且即便显示也「光审批不知道在审什么」——缺来源上下文与跳转。

用户需求（2026-07-09）：AskUserQuestion 要能在审批中心 `/approvals` 真实审批 + 附带描述（questions 的 header/question/options）+ **来源上下文** + **可跳转**，覆盖 scan/stage 与普通对话两类会话。

## 2. 目标 / 非目标

### 目标
- **FR-1 可见**：AskUserQuestion 触发后，`/approvals` 审批中心显示卡片（scan/stage + 普通对话两场景）
- **FR-2 结构化问答**：卡片渲染 header/question/options/description（复用既有 `AskUserDialogCard`），非 allow/deny
- **FR-3 覆盖两类会话**：scan/stage 自动执行 + 普通交互式对话
- **FR-4 来源上下文 + 跳转**（D-002）：每张卡含来源上下文条（工作区/场景/会话/运行/时间/上下文一句话）+ 跳转入口
- **FR-5 实时 + 刷新不丢**：SSE 实时推增量 + 数据库兜底（dialog 永久等待用户，刷新后仍可见）

### 非目标
- 不修改 daemon/backend 的 AskUserQuestion PERMISSION_REQUEST 持久化链路（D-001，链路已通）
- 不做 AskUserQuestion 历史回看（已回答的，YAGNI，后续可扩）
- 不改 runtime 会话弹窗（interactive-session-panel 已正常分流 AskUserDialogCard）
- 不改 workspace 工具网关审批（listPendingApprovals，与 dialog 无关）

## 3. 现状分析

### 3.1 链路（已通，D-001）
```
daemon session-manager._buildCanUseToolCallback
  └─ toolName==='AskUserQuestion' 拦截（session-manager.ts:1107）
     └─ resolver.register({dialogKind:'AskUserQuestion', dialogPayload: toolInput})（:1130）
        └─ PERMISSION_REQUEST{dialog_kind, dialog_payload}（permission-resolver.ts:162）
           └─ backend handle_permission_request（permission_service.py:174）
              ├─ is_dialog=True → _upsert_dialog_row 持久化 session_dialog_requests（:361）
              └─ publish permission_request SSE{dialog_kind, dialog_payload}（:284）
                 └─ 前端订阅 agent_session:{id} SSE
```

### 3.2 断点（前端审批中心）
- runtime 会话弹窗（interactive-session-panel）：订阅 SSE + 按 dialog_kind 分流 → AskUserDialogCard ✓（用户确认有卡片）
- `/approvals` 审批中心 SessionPermissionPanel：
  - **断点①**：`approvals/page.tsx:102` `listWorkspaceAgentSessions(workspaceId, "scan")` 只聚合 scan 类型 session，**普通对话 session 不订阅**
  - **断点②**：`session-permission-panel.tsx:111` 渲染统一用 `PermissionApprovalCard`，**未按 dialog_kind 分流到 `AskUserDialogCard`**

### 3.3 复用资产
- `AskUserDialogCard`（frontend/src/components/ask-user-dialog-card.tsx）：结构化问答完整实现（props 仅 `{request, onResolved?}`），**零改动复用**（外层包 DialogContextBar，不侵入）
- `PermissionApprovalCard`：普通 canUseTool allow/deny 卡
- `SessionDialogRequest` 模型（backend/app/modules/daemon/model.py）：字段齐全（dialog_kind/dialog_payload/answer/...，request_id unique）
- `permission_service.list_pending_dialogs`（permission_service.py:405）：per-session pending 查询逻辑
- `list_workspace_active_sessions`（agent/service.py:804）：workspace 维度三表 JOIN（AgentSession → AgentRun → AgentRunWorkspace）模式，**复用其 JOIN 模式**

## 4. 方案设计（方案 C：实时 + 刷新不丢）

### 4.1 后端：workspace 级 dialog 查询端点（新增，只读）

新增 `GET /api/workspaces/{workspace_id}/dialogs`（**挂 `agent/router.py`**——workspace-aware router，URL 落地 `/api/workspaces/{id}/dialogs`；daemon router prefix 是 `/daemon` 挂上去会变形，C7 修正）：
- 用 `require_permission(TASK_READ)` 从 `{workspace_id}` 路径参数做 workspace 成员校验（与 `/workspaces/{id}/agent-sessions` 同权限域，C7）
- 聚合 workspace 下所有 session 的 **pending** `SessionDialogRequest`
- **JOIN 路径（C1 修正）**：`SessionDialogRequest → AgentRun → AgentRunWorkspace.workspace_id`（M:N 关联表，AgentSession **无** workspace_id 列）。复用 `list_workspace_active_sessions`（agent/service.py:798-806）的三表 JOIN 模式过滤 workspace_id
- **只读，不修改既有 PERMISSION_REQUEST 链路**（D-001）

返回 DTO（`WorkspaceDialogRead`，扩展现有 `SessionDialogRead`）：
```
WorkspaceDialogRead（新增）:
  # 既有 SessionDialogRead 字段
  id, session_id, run_id, request_id, tool_name,
  dialog_kind, dialog_payload, status, answer, created_at, answered_at
  # D-002/D-003 来源上下文字段（全部可选，可空）
  workspace_id, workspace_name,
  session_type,        # scan / chat / stage（D-003 规则见下）
  run_summary,         # 任务 prompt 派生（D-003，可空→前端占位）
```

**session_type 推导规则（D-003，C3 修正）**：
- `stage`：`AgentRun.change_id` 非空（stage run 关联变更）
- `scan`：`config.mode == "scan"` 且 `change_id` 为空
- `chat`（对话）：`config.mode != "scan"`（普通交互式对话）

**run_summary 数据源（D-003，C2 修正）**——AgentRun 无 prompt 列，取任务 prompt：
- scan/stage：取 `lease.metadata.prompt`（placement.py 写入的执行指令，router.py:2184 pending-leases 走此路径）
- 对话：取首条 `user` channel 的 `AgentRunLog.content`（用户首句消息）
- 为空（取不到）→ DTO 返回 `null`，前端占位「会话进行中」

实现：`permission_service`（或新 `workspace_dialog_service`）加 `list_pending_dialogs_for_workspace(workspace_id, user_id)`，复用 `SessionDialogRead.from_model` + JOIN 取上下文（lease.metadata / AgentRunLog 首条 / change_id）。permission_service 跨模块读 agent 模型（已有先例：permission_service.py:211 import AgentSession）。

### 4.2 前端：渲染分流

`SessionPermissionPanel`（session-permission-panel.tsx）渲染卡片时按 `dialog_kind` 分流（对齐 interactive-session-panel:251 模式）：
```tsx
{cards.map(req => req.dialog_kind
  ? <AskUserDialogCard request={req} onResolved={...}/>      // 结构化问答
  : <PermissionApprovalCard request={req} onResolved={...}/>) // allow/deny
}
```

### 4.3 前端：聚合范围扩大 + 数据兜底

- `approvals/page.tsx`：`scanSessions`（现 filter `"scan"`）改为 workspace 下所有 active interactive session（scan + chat）——`listWorkspaceAgentSessions(wsId)` 去 mode 参数
- **数据兜底**：初始加载 + 定期刷新（React Query `refetchInterval`，约 10s）调 `GET /workspaces/{id}/dialogs`，作为 pending 初始集合（刷新不丢，FR-5）
- **SSE 实时**：SessionPermissionPanel 保留 SSE 订阅推实时增量
- **去重**：按 `request_id` 合并 SSE 推入与查询结果（幂等，`SessionDialogRequest.request_id` unique；session-permission-panel.tsx:57 现有去重逻辑已具备）

### 4.4 前端：来源上下文条 + 跳转（D-002）

**DialogContextBar**（新小组件）作为 `AskUserDialogCard`/`PermissionApprovalCard` 的**兄弟包裹层**（父组件 SessionPermissionPanel 渲染，**不侵入**卡组件内部，C5）：
- 内容：工作区名 · 场景 badge（scan/对话/stage）· 会话 ID（链接）· 运行 ID（链接）· 时间 · 上下文一句话（run_summary，空则占位「会话进行中」）
- 卡片头加「查看会话 →」跳转按钮

**跳转目标（C8 修正）**：会话链接 → **`/runtimes?session=<session_id>`**（runtime 页是全局 `/runtimes`，用 `?session=` query 定位 session 弹窗，runtimes/page.tsx:382/812 `searchParams.get("session")`）；运行链接 → agent run 面板（按 run_id）

**SessionPermissionRequest 扩展（C4 修正）**——`frontend/src/lib/daemon.ts` 类型加来源字段（**全部可选 `?`**）：
- SSE 路径：backend `permission_request` SSE（permission_service.py:284-296）**只发** session_id/run_id/request_id/tool_name/dialog_kind/dialog_payload，**不发** 来源字段。因此 SSE 实时新弹的卡片来源字段缺省：
  - `workspace_name`：前端用已知 `workspaceId` 本地补（页面上下文已有）
  - `session_type` / `run_summary`：显示占位「加载中」，等下一次 `GET /workspaces/{id}/dialogs` 刷新（≤10s）回填
- 查询路径：`GET /workspaces/{id}/dialogs` 响应带全部来源字段，直接填充
- 两路按 `request_id` 合并：查询回填的字段覆盖 SSE 占位

## 5. 数据模型 / 契约

### 5.1 现有（不动）
- `SessionDialogRequest`（backend/app/modules/daemon/model.py）：id/session_id/run_id/request_id(uniq)/tool_name/dialog_kind/dialog_payload/status/answer/created_at/answered_at/answered_by

### 5.2 新增/扩展
- `GET /api/workspaces/{workspace_id}/dialogs` → `WorkspaceDialogRead[]`（新 DTO，§4.1；来源字段全可选）
- `SessionPermissionRequest`（frontend lib/daemon.ts）：加可选来源字段（workspace_name/session_type/run_summary），兼容 SSE（缺省）+ 查询（齐全）两路

### 5.3 生命周期契约表
| 事件 | 触发 | 消费 | 关键字段 |
|---|---|---|---|
| AskUserQuestion 触发 | daemon canUseTool 拦截（session-manager.ts:1107） | backend 持久化 + SSE | dialog_kind / dialog_payload |
| permission_request SSE | backend handle_permission_request（:284） | SessionPermissionPanel + interactive-session-panel | dialog_kind / dialog_payload / tool_name / session_id / run_id（**不含**来源上下文字段，C4） |
| 用户提交回答 | AskUserDialogCard → respondSessionPermission | backend `_respond_dialog` → PERMISSION_RESPONSE | dialog_result.answers |
| permission_resolved SSE | backend `_respond_dialog`（:670） | 前端移除卡片 | request_id / decision |
| 工作区 pending 查询 | 前端 refetchInterval / 刷新 | `GET /workspaces/{id}/dialogs` → `WorkspaceDialogRead[]` | 全字段含来源（D-003） |

dialog **不超时**（permission_service.py:199 / permission-resolver.ts:200），永久等待用户——FR-5「刷新不丢」依据。

## 6. 决策引用
- **D-001@v1**（premise）：链路通，断点在前端 SessionPermissionPanel，不修 daemon/backend PERMISSION_REQUEST 链路 → §3.1/§4 全文遵循
- **D-002@v1**（boundary）：审批卡片必须带来源上下文 + 跳转 → §4.1 DTO 扩展 / §4.4 前端渲染
- **D-003@v1**（architecture）：run_summary 取任务 prompt + session_type 用 change_id 区分 stage → §4.1 推导规则 / DTO 字段

## 7. 验收标准
- **AC-1**：scan/stage run 触发 AskUserQuestion，`/approvals` 审批中心 SessionPermissionPanel 显示问答卡（header/question/options）
- **AC-2**：普通对话触发 AskUserQuestion，`/approvals` 审批中心同样显示问答卡
- **AC-3**：卡片含来源上下文条（工作区/场景 scan对话stage/会话/运行/时间/上下文一句话），会话链接跳转 `/runtimes?session=<id>`、运行链接可跳转
- **AC-4**：刷新 `/approvals` 页面后，未回答的 AskUserQuestion 卡片仍在（数据库兜底，≤10s 内来源字段回填）
- **AC-5**：新 AskUserQuestion 触发时实时弹（SSE，<2s）；SSE 路来源字段占位「加载中」，查询回填后正常显示
- **AC-6**：无 dialog_kind 的普通审批仍渲染 PermissionApprovalCard（allow/deny）
- **AC-7**：backend `GET /workspaces/{id}/dialogs` 权限校验（非成员 403）、JOIN 路径正确（SessionDialogRequest→AgentRun→AgentRunWorkspace）、跨 session 返回上下文（session_type/run_summary）
- **AC-8**：三端测试全绿（backend 端点 JOIN/权限/上下文 + frontend 渲染分流/聚合去重/上下文条/跳转）

## 8. 风险与对策
- **R-1 SSE 连接数（C10）**：聚合 scan+chat 后，workspace 下所有 active session 各开一个 SSE。对策：`list_workspace_active_sessions` 加 `limit`（如 top 50 by 最近活跃）+ 前端 SSE 连接数硬上限（超出不订阅，靠查询端点兜底）；必要时后续改 workspace 级聚合 SSE channel（YAGNI 当前）
- **R-2 跳转路由（C8）**：已修正为 `/runtimes?session=<id>`（真实路由）。对策：复用 runtimes/page.tsx 现有 `?session=` query 解析
- **R-3 上下文 JOIN 性能**：workspace 级查询 JOIN AgentRun/AgentRunWorkspace + lease/log 取 prompt。对策：workspace 维度 pending 量小（dialog 罕见且 pending 短期），session_id/run_id 已索引；run_summary 取 log 首条用 `LIMIT 1 ORDER BY created_at`
- **R-4 双通道去重竞态**：SSE 推入与查询结果同 request_id 并发。对策：前端按 request_id 幂等合并，查询回填覆盖 SSE 占位

### 回退路径（brownfield 兼容）
本次为纯增量：新增只读端点 + 前端聚合/渲染改造，**无 schema 迁移**（SessionDialogRequest 不动）、**无 daemon 改动**（D-001）、**无数据迁移**。回退方式：前端 `approvals/page.tsx` 的 session 聚合 filter 改回 `"scan"` + 渲染不分流 + 移除新端点路由，即恢复变更前行为，零数据影响。

## 9. 影响模块
- **backend**：`agent/router.py`（+ `GET /workspaces/{id}/dialogs` 路由，workspace-aware）、`daemon/permission_service.py`（+ `list_pending_dialogs_for_workspace` 读方法，JOIN AgentRun/AgentRunWorkspace + lease/log 取上下文）、`daemon/schema.py`（+ `WorkspaceDialogRead` DTO）。注：端点挂 agent router 但实现复用 daemon permission_service 读逻辑（跨模块读已有先例）
- **frontend**：`approvals/page.tsx`（聚合范围 scan+chat）、`permissions/session-permission-panel.tsx`（渲染分流 + 来源上下文条 + 跳转）、`lib/daemon.ts`（`SessionPermissionRequest` 加可选来源字段 + 新 `listWorkspaceDialogs`）、新 `DialogContextBar` 组件（兄弟包裹层）
- **daemon**：**无改动**（D-001）
- **复用**：`AskUserDialogCard` / `PermissionApprovalCard`（零改动）/ `SessionDialogRequest` 模型 / `list_workspace_active_sessions` JOIN 模式

## 10. Design Grill 交叉审查结论（step12）
交叉审查发现 3 P0（C1 JOIN 路径 / C8 跳转路由 / C2 run_summary 无源）+ 4 P1（C3 stage 识别 / C4 SSE+查询兼容 / C5 组件契约 / C7 router 归属）+ 1 P2（C10 SSE 上限），全部在本修订修正：C1→三表 JOIN、C2/C3→D-003、C4→字段全可选+SSE降级、C5→兄弟包裹层、C7→挂 agent router、C8→`/runtimes?session=`、C10→加 limit。Unresolved Blockers（U1 run_summary 源 / U2 stage 区分）经用户确认落入 D-003。status: passed（修正后）。
