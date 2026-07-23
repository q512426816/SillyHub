---
author: qinyi
created_at: 2026-07-09T17:20:00+08:00
scale: large
---

# 设计文档（Design）— 变更详情页内嵌会话

## 1. 背景

平台已具备「会话/对话」能力：在 `/runtimes` 页面通过 `RuntimeSessionDialog` + `InteractiveSessionPanel` 可与 Claude/Codex 多轮对话。但这些会话是 **runtime 级别**的——`AgentSession` 表（`backend/app/modules/agent/model.py:373`）只关联到 `runtime_id`，**不知道自己是围绕哪个变更、哪个工作空间展开的**，也没有工作目录/变更文档上下文。

用户在「变更中心 → 变更详情页」（`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`）推进一个变更时，常想就这个变更提问、排查、讨论（例如"design.md 里 D-001 为什么这么定""task-03 报错怎么排查"）。当前只能跑到 runtimes 页面另开会话，且会话不知道当前变更是什么，需要手动把变更标题、文档路径、改了哪些文件一遍遍贴进去。

本变更解决：**在变更详情页内嵌一个会话区块，打开即自动给定上下文（工作目录 + 变更信息），且只能看到与此变更关联的会话。**

## 2. 设计目标

- **G-1 内嵌复用**：变更详情页内嵌会话区块，复用现有 `InteractiveSessionPanel`，不重复造对话 UI。
- **G-2 自动上下文**：打开/新建会话时自动注入变更标题、当前阶段、工作目录、变更文档路径、已变更文件清单。
- **G-3 变更级过滤**：会话历史只列出与该变更关联的会话；一个变更可有多条会话，可切换、可新建。
- **G-4 干净关联**：在服务端建立 session↔change 关系，支持跨成员可见、跨设备一致。
- **G-5 零回归**：runtimes 页面的既有会话路径行为不变。

## 3. 非目标

- **N-1 不改会话权限语义**：`manual_approval` / `ask_user_only` 沿用现有 interactive 会话配置，不在本变更调整审批/放行策略。
- **N-2 不替换 Agent 执行日志**：变更详情页现有的 `AgentRunPanel`（SillySpec 流程调度日志）保留，与新会话区块并存独立。会话是「自由问答/调试」，执行日志是「流程推进」。
- **N-3 不做会话与 SillySpec 阶段的自动联动**：会话不会自动触发 brainstorm/plan/execute；那是 agent-run 调度的事。
- **N-4 不做会话改名/置顶/搜索**：列表展示用「首条消息摘要 + 时间」，改名等留后续。
- **N-5 不做跨工作空间的会话聚合视图**。

## 4. 拆分判断

单一核心功能（变更详情页嵌入会话 + 服务端关联），不到「3 个独立可交付模块 / 多角色 / 审批流」的拆分阈值，不满足批量模式（任务 < 10、非模板×数据）。**不拆分、不批量，单变更推进。** 详见 Step 5 评估。

## 5. 总体方案

采用用户选定的**方案 A：服务端加列 + 后端拼上下文**。分三 Wave：

- **Wave 1（后端地基）**：`AgentSession` 加 `change_id` + `workspace_id` 列 + Alembic 迁移；`SessionCreateRequest` / `create_session` / `AgentSessionRead` 扩展；dispatch 透传 workspace_id 让 cwd 解析生效。
- **Wave 2（后端上下文 + 列表）**：新增「按 change 拼装变更上下文前导」并注入首条 developer 消息；新增变更级会话列表端点。
- **Wave 3（前端接入）**：变更详情页内嵌会话区块（左历史 + 右复用 `InteractiveSessionPanel`），扩展组件 props 透传 `changeId`/`workspaceId`。

数据流（创建一条变更会话）：

```
变更详情页 [新建会话 + 输入]
   │ createSession({provider, prompt, model, manual_approval, ask_user_only,
   │                change_id, workspace_id})   ← 新增两字段
   ▼
POST /api/daemon/sessions
   │ DaemonService.create_session(change_id, workspace_id, …)
   │   ① AgentSession(change_id=, workspace_id=, cwd=<workspace 本地根>, …)
   │   ② 拼装【变更上下文前导】(标题/阶段/工作目录/文档路径/已变更文件)
   │   ③ prepare_interactive_dispatch(workspace_id 透传 → context.py 解析 cwd/root_path)
   ▼
daemon (Claude SDK)：首条 developer 消息=变更上下文前导，user 消息=用户输入
   ▼
GET /api/workspaces/{wid}/changes/{cid}/sessions  ← 列出该变更全部会话
```

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/agent/model.py` | `AgentSession`（:373）新增 `change_id`、`workspace_id` 列 + 索引 |
| 新增 | `backend/app/migrations/versions/<rev>_add_change_workspace_to_agent_sessions.py` | Alembic 迁移：加列+索引，down 接当前真实 head |
| 修改 | `backend/app/modules/daemon/router.py` | `SessionCreateRequest`（:1502）加 `change_id?`/`workspace_id?`；`create_session` 端点（:1675）透传 |
| 修改 | `backend/app/modules/daemon/session/service.py` | `create_session`（:319）签名加 `change_id`/`workspace_id`，写入 session，透传 dispatch，拼装上下文前导 |
| 修改 | `backend/app/modules/daemon/schema.py` | `AgentSessionRead`（:18）回显 `change_id`/`workspace_id` |
| 新增 | `backend/app/modules/daemon/session/context.py`（或在 service 内） | `build_change_context_preamble(change_id) -> str`：拉 Change/ChangeDocument/已变更文件拼前导 |
| 修改 | `backend/app/modules/change/router.py`（prefix `/workspaces/{workspace_id}`，:52） | 新增 `GET /changes/{change_id}/sessions` 变更级会话列表端点 |
| 修改 | `backend/app/modules/daemon/lease/context.py` | 确保 `prepare_interactive_dispatch` 路径在 lease_meta 带 workspace_id 时解析 cwd（现有 `_resolve_*` 逻辑已具备，需接线） |
| 修改 | `frontend/src/lib/daemon.ts` | `SessionCreateRequest`（:799）+ `createSession`（:831）加 `change_id?`/`workspace_id?`；新增 `listChangeSessions(wid,cid)` |
| 修改 | `frontend/src/components/daemon/interactive-session-panel.tsx` | props（:114）加可选 `changeId?`/`workspaceId?`；`handleSend`（:404）的 `createSession`（:427）带上 |
| 新增 | `frontend/src/components/changes/change-session-section.tsx` | 变更详情页内嵌区块：左历史列表 + 右 `InteractiveSessionPanel` + 「新建会话」 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` | 在「Agent 执行日志」区块之后插入 `<ChangeSessionSection workspaceId changeId />` |

> 注：迁移文件名 `<rev>` 在实现时按 `alembic heads` 确认的当前 head 生成，避免迁移链断裂（见 [[migration-chain-fragmentation-pattern]]）。

## 7. 接口定义

### 7.1 扩展 `SessionCreateRequest`（`daemon/router.py:1502`，`frontend/src/lib/daemon.ts:799`）

```python
class SessionCreateRequest(BaseModel):
    provider: str
    prompt: str
    model: Optional[str] = None
    manual_approval: bool = False
    ask_user_only: bool = False
    change_id: Optional[UUID] = None      # 新增：变更绑定
    workspace_id: Optional[UUID] = None   # 新增：工作空间绑定（冗余，便于过滤/解析 cwd）
```

### 7.2 `DaemonService.create_session(...)`（`daemon/session/service.py:319`）

```python
async def create_session(self, *, user_id, provider, prompt, model,
                         manual_approval=False, ask_user_only=False,
                         change_id=None, workspace_id=None) -> AgentSession:
    # ① 解析工作目录（workspace_id → 本地项目根，复用现有路径解析）
    cwd = await self._resolve_cwd_for_workspace(workspace_id) if workspace_id else None
    # ② 拼装变更上下文前导（X-01：已变更文件复用 list_change_files service）
    preamble = await build_change_context_preamble(self.db, change_id) if change_id else None
    session = AgentSession(user_id=..., runtime_id=..., provider=...,
                           change_id=change_id, workspace_id=workspace_id, cwd=cwd, ...)
    # ③ dispatch（X-02：lease_meta 带 workspace_id，context.py 解析 cwd/root_path；
    #    纯后端注入——AgentRunLog 存干净 prompt，dispatch prompt = preamble+prompt）
    dispatch_prompt = (preamble + "\n\n---\n\n" + prompt) if preamble else prompt
    dispatch = await placement.prepare_interactive_dispatch(
        ..., workspace_id=workspace_id, prompt=dispatch_prompt, ...)
    # AgentRunLog(channel="user_input") 仍写干净 prompt（不含前导），保证列表标题/回放干净（X-04）
```

### 7.3 新增 `GET /api/workspaces/{workspace_id}/changes/{change_id}/sessions`

```python
@router.get("/changes/{change_id}/sessions")
async def list_change_sessions(workspace_id: UUID, change_id: UUID,
                               session: SessionDep,
                               _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))]) -> list[AgentSessionListItem]:
    """返回该变更下全部会话（跨成员，D-005），按 last_active_at desc。
    X-03：鉴权复用 change router 既有 require_permission(CHANGE_READ)。"""
```

返回字段：`id, provider, status, turn_count, author{user_id,display_name}, last_active_at, title(首条 user 消息摘要)`。

## 7.5 生命周期契约表

本变更涉及 `session` / `agent_run` / `daemon` / `cwd` 关键词，按下表对齐（复用既有 interactive 生命周期，仅新增 change/workspace 绑定字段）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| create session（变更绑定） | frontend | backend | provider, prompt, model, manual_approval, ask_user_only, **change_id★**, **workspace_id★** | session active（+绑定 change/workspace） |
| resolve cwd | backend | backend(internal) | workspace_id → 本地项目根 | 写入 AgentSession.cwd |
| inject context | backend | daemon(SDK) | change_id→【变更上下文前导】拼到 dispatch prompt 前（`前导+用户消息`），AgentRunLog(user_input) 存干净用户消息 | 首轮 prompt 组装 |
| dispatch lease | backend | daemon | leaseId, claimToken, agentRunId, **workspace_id**(透传), cwd | lease pending → running |
| submit turn | daemon | backend | leaseId, claimToken, agentRunId | append messages |
| turn result | daemon | backend | runId, status, output | running → completed/failed |
| session end | daemon/frontend | backend | sessionId, reason | active → ended |

★=本次新增字段。其余事件为既有 interactive 生命周期，本变更不改其语义，仅保证 change/workspace 字段贯穿。

## 8. 数据模型

`AgentSession`（`agent/model.py:373`，表 `agent_sessions`）新增：

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `change_id` | UUID(FK → changes.id) | nullable, ON DELETE SET NULL | 变更绑定；变更被删时置空（不级联删会话） |
| `workspace_id` | UUID(FK → workspaces.id) | nullable, ON DELETE SET NULL | 冗余便于过滤与 cwd 解析 |

索引：`ix_agent_sessions_change_id`（列表过滤高频）。`workspace_id` 复合查询时与 change_id 一起用，暂不加额外索引（YAGNI，观察后再定）。

> 不改 `AgentRun.change_id`（既有调度 run 专用）。变更会话的首个 AgentRun 的 change_id 也会被写入（与 session.change_id 一致），保证 `agent_run_logs`/usage 等既有 run 维度统计仍能按变更聚合。

## 9. 兼容策略（brownfield）

- **未传 change_id/workspace_id 时行为不变**：runtimes 页面会话不传这两字段，`create_session` 走原逻辑，`AgentSession` 两列为 NULL，与现有数据完全兼容。
- **回退路径**：迁移 down 做 `DROP COLUMN`；前端组件新增 props 全可选，不传即不绑定，runtimes 调用零改动。
- **不改变的 API/表**：现有 `GET /api/daemon/sessions`、`/sessions/{id}`、`/inject`、`/stream`、`/interrupt`、`/end`、`/reopen` 全部不动；新列表端点是独立新增。
- **旧会话**：历史 AgentSession 的 change_id/workspace_id 为 NULL，不出现在任何变更的会话列表（正确，它们本就不属于任何变更）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | Alembic 迁移与并行变更撞 revision / 分叉 head，backend 启动 crash-loop | P0 | 实现时先 `alembic heads` 确认单一 head，revision id 全局唯一，down 接真实 head；verify 用 PG（非 SQLite）验证（见 [[migration-chain-fragmentation-pattern]]） |
| R-02 | `prepare_interactive_dispatch` 现不写 workspace_id，变更会话 cwd 解析不到 | P1 | Wave 1 接线：lease_meta 带 workspace_id，复用 `lease/context.py` 既有 `_resolve_*` 解析 cwd/root_path；补单测守护 |
| R-03 | 上下文前导注入方式（developer 消息 vs system prompt）与 SDK 行为不一致 | P1 | **Grill 已决（X-02）**：lease/protocol 无 system_prompt 通道，采用纯后端方案——dispatch prompt = `前导+用户消息`，AgentRunLog(user_input) 仍写干净用户消息（列表标题/回放干净，X-04）。零 daemon 改动；`appendSystemPrompt` 留作未来更优解 |
| R-04 | 「已变更文件清单」来源（ChangeFileTree / diff）尚未确认字段 | P2 | **Grill 已决（X-01）**：复用既有 `list_change_files` service（端点 `GET /workspaces/{wid}/changes/{cid}/files`，前端 change-files.ts:55 在用），前导构建器直接调用取文件路径列表 |
| R-05 | 跨成员可见会话的隐私（团队成员看到彼此调试记录） | P2 | D-005 默认跨成员可见；design 审查已提示，用户可在后续要求改为「仅本人」 |
| R-06 | 前端 InteractiveSessionPanel 扩展 props 破坏 runtimes 调用 | P2 | 新增 props 全可选 + runtimes 页面回归测试守护 |

## 11. 决策追踪

当前版本决策见 `decisions.md`：D-001@v1（关联模型=加列）、D-002@v1（会话能力边界=复用）、D-003@v1（工作目录=workspace 根）、D-004@v1（上下文注入=后端拼前导）、D-005@v1（历史列表=跨成员可见）。覆盖情况：

- D-001 → §5 / §6 / §8 / §9
- D-002 → §3 N-1 / §5
- D-003 → §5 / §7.2 / §7.5（resolve cwd）/ R-02
- D-004 → §5 / §7.2 / §7.5（inject context）/ R-03
- D-005 → §7.3 / R-05

无未解决决策；R-03/R-04 为实现期需核实的技术细节，已在风险登记标注。

## 12. 自审

| 检查项 | 结果 |
|---|---|
| 需求覆盖（G-1~G-5） | ✅ 全覆盖：内嵌复用(G-1)/自动上下文(G-2,§7.5)/变更级过滤(G-3,§7.3)/干净关联(G-4,§8)/零回归(G-5,§9) |
| Grill/决策覆盖 | ✅ design 引用 D-001~D-005 全部当前版本（§11） |
| 约束一致性 | ✅ 复用既有 interactive 生命周期、daemon-client 路径解析、change router 前缀风格（§7.3） |
| 真实性 | ✅ 表名/字段/行号均来自真实代码（AgentSession model.py:373、create_session service.py:319、SessionCreateRequest router.py:1502、InteractiveSessionPanel props interactive-session-panel.tsx:114）；迁移文件标注「新增」，rev 待定 |
| 生命周期契约表 | ✅ §7.5 含完整表，★标注本次新增字段，字段出现在 §7.1 DTO |
| YAGNI | ✅ 未纳入改名/置顶/搜索/跨工作空间聚合（N-4/N-5） |
| 验收标准 | ⚠️ 将在 tasks.md 细化为可测条目（AC：变更详情页能新建/切换会话、上下文前导出现、列表只含本变更会话、runtimes 页零回归） |
| 非目标清晰 | ✅ §3 N-1~N-5 |
| 兼容策略 | ✅ §9 |
| 风险识别 | ✅ §10 R-01~R-06 |

自审通过，进入 Design Grill 交叉审查。

## 13. Design Grill Result

status: **passed**（无 P0/P1 unresolved blocker；4 处精化均为有代码证据的技术细化，无需用户判断）

### Cross-Check Matrix

| ID | 层级 | 交叉点 | 证据 A | 证据 B | 结论 | 决策 |
|---|---|---|---|---|---|---|
| X-01 | feasibility | R-04 已变更文件来源 | design §10 R-04 | `list_change_files` 端点 `GET /workspaces/{wid}/changes/{cid}/files`（api-types.ts:854, change-files.ts:55） | 前导构建器直接复用该 service 取文件路径 | R-04 已决（降级为已知） |
| X-02 | feasibility | R-03 前导注入可行性 | design §7.2/§7.5 | lease/protocol 无 system_prompt 通道（context.py/protocol.py grep 空）；prompt 经 lease 交 daemon 组装 SDK 消息（service.py:378/403） | 纯后端：dispatch prompt=`前导+用户消息`，AgentRunLog 存干净用户消息；零 daemon 改动 | R-03 已决 |
| X-03 | consistency | §7.3 列表端点鉴权 | design §7.3 | change router 既有 `require_permission(Permission.CHANGE_READ)`（router.py:70） | 新端点沿用 CHANGE_READ | §7.3 已更新 |
| X-04 | consistency | D-005 列表标题来源 | design §7.3/D-005 | X-02 决定 dispatch prompt 含前导 | 标题取自 AgentRunLog(user_input) 干净消息，非 dispatch prompt | design §7.2 已注明 |

### Question Distribution

| 分类 | 数量 | 含义 |
|---|---|---|
| immediately_answered | 4 | X-01~X-04，有代码证据，直接修正 design |
| needs_thinking | 0 | — |
| unresolved | 0 | — |

### Unresolved Blockers

无。可进入 plan。
