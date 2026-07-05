---
author: qinyi
created_at: 2026-07-05 00:56:00
change: 2026-07-05-agent-log-type-tags
status: draft
---

# Agent 执行日志类型细分 · design.md

## 1. 背景

Agent 执行日志查看器（`frontend/src/components/agent-log-viewer.tsx`）当前把**所有工具调用**都归到一个「工具」类，区分不出来：

- agent 调用 `sillyspec` CLI（在 Bash 里跑 `sillyspec run execute`）和调用技能（Skill 工具）、读文件、搜索代码、派子任务——在日志里**长得一样**，都标「工具」。
- 现状根因（已查证）：
  - `AgentRunLog` 表（`backend/app/modules/agent/model.py:285-358`）只有 `channel`（stdout/stderr/tool_call/user_input/pending_input）一个分类列，**无 `type`/`tag`/`metadata` 列**。
  - `content_redacted` 用文本协议前缀（`[TOOL_USE]`/`[ASSISTANT]`/...）做「软分类」，但工具种类信息只埋在 tool_call JSON 的 `tool`/`args.command` 字段里，未结构化。
  - daemon `task-runner.ts:1708-1798` 在 tool_use 时只发 `{tool_name, tool_input, tool_use_id}`，**没有「这是 sillyspec 调用 / 这是技能调用」的标签**。
  - 前端 `classifyLog`（`frontend/src/components/agent-log/normalize.ts:334`）从 channel+前缀推导 10 个 `SemanticCategory`，无 sillyspec/skill 子类型；筛选 UI（`agent-log-viewer.tsx:711`）只有这 10 个按钮。

用户诉求：把工具调用类**细分到每个工具**（SillySpec CLI / 技能 / Bash / 读 / 写 / 搜索 / 子任务 / 网搜 / MCP / ...），通过**标签**清晰看出来，并能**多选筛选**。

## 2. 设计目标

- **G1**：每条工具调用日志带一个结构化 `tool_kind` 标签，识别 sillyspec CLI、技能、Bash、读写、搜索、子任务、网搜、MCP 等常见工具。
- **G2**：前端在现有「日志类型」筛选之下，新增一层「工具类型」筛选，多选高亮，两层正交可叠加。
- **G3**：每条工具调用日志行渲染专属彩色徽标（中文名 + 图标），沿用现有 `semanticCategoryMeta` 视觉模式。
- **G4**：后端 API 支持 `?tool_kind=` 筛选，便于后续按工具类型查询/统计。
- **G5**：daemon 与 backend 双路径打标（batch 走 task-runner、interactive 走 `_extract_sdk_messages`），保证两种会话模式都有标签。

## 3. 非目标

- **N1**：**不**对 sillyspec 子命令（brainstorm/plan/execute/verify/...）再细分，所有 sillyspec 调用统一 `tool_kind=sillyspec`（D-001@v1）。
- **N2**：**不**对技能名再细分，所有技能调用统一 `tool_kind=skill`（用户确认）。
- **N3**：**不**回填历史日志，旧日志 `tool_kind=NULL`，前端兼容显示通用「工具」徽标。
- **N4**：**不**改 agent_run / session / lease 生命周期状态机，仅在已落库的 `agent_run_logs` 行上增加展示维度。
- **N5**：**不**改现有 10 个 `SemanticCategory` 与第一层筛选按钮。
- **N6**：**不**做按标签的统计/聚合页面（YAGNI，仅预留 DB 列与索引支撑未来）。

## 4. 拆分判断

- 单功能横切三端（daemon 采集 / backend 落库 + API / frontend 展示），3 Phase 顺序依赖，**不**是 3 个独立可交付模块。
- 非批量模式（非「模板 × 数据」）。
- 不拆分子变更，单变更 `2026-07-05-agent-log-type-tags` 推进。

## 5. 总体方案

选定 **方案 B**（D-003@v1）：`AgentRunLog` 加 `tool_kind` 结构化列（参照 `AgentArtifact.kind` 先例 `model.py:550`），daemon 与 backend 双层识别打标，前端读结构化字段并加第二层筛选。理由：结构化可查询可统计、有项目先例、可扩展、顺手消化 agent-run-pipeline-fix 留下的「AgentRunLog 缺结构化分类列」旧账。

### Phase 1 · 后端数据基础

1. `AgentRunLog` 加 `tool_kind: str | None` 列（String(32)，nullable，加索引支持筛选查询）。
2. 新 alembic 迁移，`down_revision` 严格接**当前真实 head**（执行时 `alembic heads` 确认，避开迁移链断裂）。
3. `AgentRunLogEntry` schema 加 `tool_kind` 字段。
4. GET `/workspaces/{ws}/agent/runs/{run_id}/logs` 加可选 `?tool_kind=` query（逗号分隔多选，与前端多选对齐）。
5. 单测：迁移正反、落库填列、API 筛选。

### Phase 2 · 识别层（daemon + backend 双兜底）

抽纯函数 `classify_tool_kind(tool_name, args) -> str | None`（Python + TS 各一份**同逻辑**，注释互引）。

- **daemon（batch 路径，主）**：`task-runner.ts:1708-1798` 的 tool_use 分支已能拿到 `md.tool_name` + `md.tool_input`（line 1710/1728）；调 `classifyToolKind` 得 `tool_kind`，写入 **tool_call JSON 那条 message 的顶层 `tool_kind` 字段**（与 `event_type`/`content`/`channel` 同级，参照 `parent_tool_use_id` 注入模式 task-runner.ts:1794-1798）。配对的 stdout `[TOOL_USE]` 文本行**不**带 `tool_kind`（前端 `classifyLog` 把它分到 `SemanticCategory=log`，不在工具筛选维度；前端如需可通过 `tool_use_id` 配对借用，但 DB 列层面只 tool_call 行有值）。
- **backend（interactive 路径，主）**：`run_sync/service.py:_extract_sdk_messages`（1081-1137）处理结构化 SDK tool_use block（`btype==="tool_use"`，有 `tool_name` + `input`），调 Python 版 `classify_tool_kind` 识别，落库填 `tool_kind` 列。
- **backend（batch 路径，兜底）**：`submit_messages`（282-398）落库时 `msg.get("tool_kind")` 优先（新 daemon 已带）；缺则仅对 `channel='tool_call'` 行 `JSON.parse(content)` 取 `tool`/`args` 调 `classify_tool_kind` 兜底（旧 daemon 无 `tool_kind` 字段时启用；stdout 文本行不兜底）。
- **SillySpec 识别规则**（D-001@v1）：`tool_name==="Bash"` 且 `args.command` 含 `sillyspec` 子串 → `sillyspec`；覆盖 `sillyspec run xxx`、`npx sillyspec`、复合命令 `git add && sillyspec run execute`。
- **MCP 识别规则**（D-002@v1）：`tool_name` 以 `mcp__` 开头 → 统一 `tool_kind=mcp`，不细分到具体 server/tool（避免按钮爆炸）。
- 单测：`classify_tool_kind` 全枚举覆盖 + 边界（复合命令、未知工具、None）。

### Phase 3 · 前端展示与筛选

1. `lib/agent.ts` `AgentRunLogEntry` 加 `tool_kind?: string | null`。
2. 新增 `agent-log/tool-kind-meta.ts`：`toolKindMeta(tool_kind) -> {label, Icon, badgeClass}` 映射，沿用 `semanticCategoryMeta` 配色风格（border-{c}-200 bg-{c}-50 text-{c}-700）。
3. `agent-log-viewer.tsx`：
   - 现有 10 个 SemanticCategory 按钮**保留**为第一层（日志类型）。
   - 新增第二层「工具类型」筛选按钮组（SillySpec/技能/命令行/读文件/写文件/搜索/子任务/网搜/清单/MCP/其他），多选高亮；在第一层选中「工具」或「全部」时显示。
   - 每条 `tool_call` 日志行渲染工具徽标（type 徽标 + 工具徽标并列）。
   - 第二层筛选逻辑：`active` 集合为空→显示全部工具调用；非空→只显示 `tool_kind ∈ active` 的工具调用行（非工具行不受影响）。
4. 样式参考 `.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/design.md` 与现有 `semanticCategoryMeta`。
5. 单测：徽标映射、两层筛选正交性、`tool_kind=null` 兼容显示。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/agent/model.py` | `AgentRunLog` 加 `tool_kind` 列（line 285-358 区域） |
| 新增 | `backend/migrations/versions/20260705xxxx_add_agent_run_log_tool_kind.py` | alembic 迁移：add column + index；down_revision 接真实 head |
| 修改 | `backend/app/modules/agent/schema.py` | `AgentRunLogEntry` 加 `tool_kind: str \| None`（line 128-140 区域） |
| 新增 | `backend/app/modules/agent/tool_kind.py` | Python 版 `classify_tool_kind` + `TOOL_KIND_VALUES` 枚举常量 |
| 修改 | `backend/app/modules/daemon/run_sync/service.py` | `_extract_sdk_messages`（1081-1137）+ `submit_messages`（282-398）落库填 `tool_kind`；**两处 publish payload 也要加 `tool_kind`**：`published_logs.append`（400+，SSE `/stream` 实时推）+ session channel `session_payload`（147-154，interactive 实时流），否则前端实时流缺标签 |
| 修改 | `backend/app/modules/agent/router.py` | GET `/logs` 加 `tool_kind: str \| None = Query(None)` query 参数 |
| 新增 | `backend/tests/.../test_agent_run_log_tool_kind.py` | 后端单测 |
| 新增 | `sillyhub-daemon/src/tool-kind.ts` | TS 版 `classifyToolKind` + `TOOL_KIND_VALUES` |
| 修改 | `sillyhub-daemon/src/task-runner.ts` | tool_use 分支（1708-1798）打 `tool_kind` 到 message metadata |
| 新增 | `sillyhub-daemon/src/tool-kind.test.ts` | daemon 单测 |
| 修改 | `frontend/src/lib/agent.ts` | `AgentRunLogEntry` 加 `tool_kind`（46-68 区域） |
| 新增 | `frontend/src/components/agent-log/tool-kind-meta.ts` | `toolKindMeta` 映射 |
| 修改 | `frontend/src/components/agent-log-viewer.tsx` | 第二层筛选按钮 + 工具徽标渲染 |
| 修改 | `frontend/src/components/agent-log/normalize.ts` | （可选）`classifyLog` 不动，仅导出 `toolKindMeta` 引用 |
| 新增 | `frontend/.../agent-log-viewer.test.tsx`（补） | 前端两层筛选 + 兼容显示单测 |

## 7. 接口定义

### Python · `classify_tool_kind`

```python
# backend/app/modules/agent/tool_kind.py
TOOL_KIND_VALUES: tuple[str, ...] = (
    "sillyspec", "skill", "bash", "read", "write",
    "search", "task", "web", "todo", "plan",
    "ask", "schedule", "mcp", "other",
)

def classify_tool_kind(
    tool_name: str | None,
    args: dict | None,
) -> str | None:
    """从 tool_name + args 推导 tool_kind。

    Returns:
        TOOL_KIND_VALUES 之一，或 None（非工具调用 / tool_name 缺失）。
    """
    if not tool_name:
        return None
    name = tool_name.lower()
    if name == "bash":
        cmd = ((args or {}).get("command") or "")
        return "sillyspec" if "sillyspec" in cmd else "bash"
    if name == "skill":
        return "skill"
    if name == "read":
        return "read"
    if name in {"write", "edit", "multiedit", "notebookedit"}:
        return "write"
    if name in {"grep", "glob"}:
        return "search"
    if name in {"task", "agent"}:
        return "task"
    if name in {"websearch", "webfetch"}:
        return "web"
    if name in {"todowrite", "taskcreate", "taskupdate", "taskget", "tasklist"}:
        return "todo"
    if name == "exitplanmode":
        return "plan"
    if name == "askuserquestion":
        return "ask"
    if name.startswith("cron") or name == "schedulewakeup":
        return "schedule"
    if name.startswith("mcp__"):
        return "mcp"
    return "other"
```

### TypeScript · `classifyToolKind`

```typescript
// sillyhub-daemon/src/tool-kind.ts
// 与 backend/app/modules/agent/tool_kind.py 保持同逻辑，互引注释。
export const TOOL_KIND_VALUES = [
  'sillyspec','skill','bash','read','write','search','task',
  'web','todo','plan','ask','schedule','mcp','other',
] as const;
export type ToolKind = typeof TOOL_KIND_VALUES[number];

export function classifyToolKind(
  toolName: string | undefined | null,
  args: Record<string, unknown> | undefined,
): ToolKind | null {
  if (!toolName) return null;
  const name = toolName.toLowerCase();
  if (name === 'bash') {
    const cmd = String((args as any)?.command ?? '');
    return cmd.includes('sillyspec') ? 'sillyspec' : 'bash';
  }
  if (name === 'skill') return 'skill';
  if (name === 'read') return 'read';
  if (['write','edit','multiedit','notebookedit'].includes(name)) return 'write';
  if (['grep','glob'].includes(name)) return 'search';
  if (['task','agent'].includes(name)) return 'task';
  if (['websearch','webfetch'].includes(name)) return 'web';
  if (['todowrite','taskcreate','taskupdate','taskget','tasklist'].includes(name)) return 'todo';
  if (name === 'exitplanmode') return 'plan';
  if (name === 'askuserquestion') return 'ask';
  if (name.startsWith('cron') || name === 'schedulewakeup') return 'schedule';
  if (name.startsWith('mcp__')) return 'mcp';
  return 'other';
}
```

### REST API

```http
GET /workspaces/{ws}/agent/runs/{run_id}/logs?tool_kind=sillyspec,skill
# 返回 channel=tool_call 且 tool_kind IN (sillyspec, skill) 的日志行；
# 不传 tool_kind → 返回全部（向后兼容）。
```

## 7.5 生命周期契约表

**不适用**。本次变更涉及 `agent_run` / `daemon` 字样，但**仅**在已完成的 `agent_run_logs` 行上增加展示维度（加列 + 落库填值 + 渲染），**不改变** session / lease / agent_run 的状态机、claim/heartbeat/complete/end 等生命周期事件。日志写入路径仍是现有的 `RunSyncService.submit_messages` → `AgentRunLog(...)` 构造，仅在构造参数多传一个 `tool_kind`。无新增生命周期事件，无新 DTO 字段绑定到生命周期。

## 8. 数据模型

`agent_run_logs` 表新增列：

| 列名 | 类型 | nullable | 默认 | 索引 | 说明 |
|---|---|---|---|---|---|
| `tool_kind` | VARCHAR(32) | YES | NULL | 单列索引 `ix_agent_run_logs_tool_kind` | 工具种类标签，仅 `channel='tool_call'` 行有值；旧日志为 NULL |

迁移：

```python
def upgrade():
    op.add_column("agent_run_logs",
        sa.Column("tool_kind", sa.String(32), nullable=True))
    op.create_index(
        "ix_agent_run_logs_tool_kind", "agent_run_logs", ["tool_kind"])

def downgrade():
    op.drop_index("ix_agent_run_logs_tool_kind", table_name="agent_run_logs")
    op.drop_column("agent_run_logs", "tool_kind")
```

`down_revision` 在 execute 阶段执行 `alembic heads` 拿到当前真实 head 后填入，避开迁移链断裂（R-01）。

## 9. 兼容策略（brownfield）

- **旧日志**：`tool_kind=NULL`，前端 `toolKindMeta(null)` → 渲染通用「工具」徽标（与现状一致），第二层筛选不命中。**不回填**（N3）。
- **daemon 未升级**：旧 daemon 上报的 message 不带 `tool_kind`，backend 落库时调 `classify_tool_kind` 兜底识别——只要 tool_name 在 payload 里，新 backend 仍能打标。只有 tool_name 也缺时才为 NULL。
- **API 向后兼容**：`?tool_kind=` 不传 → 返回全部日志（与现状一致）。
- **前端向后兼容**：`AgentRunLogEntry.tool_kind` 可选，旧 SSE 事件无该字段时按 `null` 处理。
- **回退路径**：迁移可 `downgrade`（drop column + index），代码回退后旧逻辑完全恢复，无数据损失（旧日志本就无此列）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | alembic 迁移链断裂（多分支并行 down_revision 撞 head） | P0 | execute 时先 `alembic heads` 确认唯一 head；`down_revision` 接真实 head；verify 在 PG（不只 SQLite）跑迁移；本项目未上线可重置（`down -v` 重建） |
| R-02 | interactive 路径漏打标（batch 经 task-runner，interactive 经 `_extract_sdk_messages`） | P0 | 双兜底：daemon task-runner + backend `_extract_sdk_messages` 都调识别函数；记忆 [[scan-stage-interactive-dispatch]] 明示双路径分流 |
| R-03 | 前端两层筛选按钮拥挤（11 个工具按钮） | P1 | 第二层仅在「工具」相关视图激活时显示；按钮支持横向滚动/折叠；沿用第一层按钮紧凑样式 |
| R-04 | MCP 工具数量多导致标签爆炸 | P1 | D-002@v1：所有 `mcp__` 前缀统一 `tool_kind=mcp`，不细分 |
| R-05 | daemon 与 backend 两份识别逻辑漂移（Python/TS） | P1 | 共享单测用例表（同输入→同输出），注释互引；TS 文件头注明「与 Python 版同步」 |
| R-06 | 复合命令误标（`sillyspec` 出现在非调用上下文） | P2 | 子串匹配足够（agent 跑 sillyspec 的方式可控，误标成本低；D-001@v1 已权衡） |
| R-07 | 旧日志显示「工具」徽标与有标签行视觉混淆 | P2 | 旧日志徽标用灰色 `tk-none` 风格区分（原型已示） |
| R-08 | publish payload 漏 `tool_kind`（published_logs + session_payload 两处），SSE 实时流缺标签 | P1 | §6 已点明两处都要加；execute 时单测验证 SSE 推送的 dict 含 tool_kind 字段 |

## 11. 决策追踪

| 决策 ID | 标题 | 状态 | 覆盖章节 / FR |
|---|---|---|---|
| D-001@v1 | SillySpec 识别策略（command 含 `sillyspec` 子串即标，不分子命令） | accepted | §5 Phase 2、§7、R-06 |
| D-002@v1 | MCP 工具统一 `tool_kind=mcp`（不细分 server/tool） | accepted | §5 Phase 2、§7、R-04 |
| D-003@v1 | 技术方案 = 加 `tool_kind` 结构化列（方案 B） | accepted | §5、§6、§8 |

无未解决决策。剩余风险见 §10。

## 12. 自审

- ✅ **需求覆盖**：G1 结构化标签、G2 两层筛选、G3 彩色徽标、G4 API 筛选、G5 双路径打标，全部覆盖对话式探索结论（所有工具各自标签 / 工具类下细分 / 按钮多选 / 不分子级 / 只对新日志）。
- ✅ **Grill/决策覆盖**：design 引用所有当前版本 D-001@v1 / D-002@v1 / D-003@v1（§11）。
- ✅ **约束一致性**：参照 `AgentArtifact.kind`（model.py:550）既有模式；徽标沿用 `semanticCategoryMeta`（agent-log-viewer.tsx:93）既有配色；样式系统遵守 CLAUDE.md 规则 16。
- ✅ **真实性**：所有表名/字段名/类名/行号来自 Explore 调研报告（model.py:285-358 / run_sync/service.py:1081-1137,282-398 / task-runner.ts:1708-1798 / normalize.ts:334 / agent-log-viewer.tsx:93,711 / agent.ts:46-68）。新增文件标注「新增」。
- ✅ **YAGNI**：不做子命令细分（N1）、不做技能名细分（N2）、不回填（N3）、不做统计页（N6）。方案 C（metadata JSON 列）被否决（over-engineering）。
- ✅ **验收标准**：§5 各 Phase 末尾有具体可测试项（迁移正反、API 筛选、单测全枚举、双路径打标）。
- ✅ **非目标清晰**：N1-N6 明确界定。
- ✅ **兼容策略**：§9 给出旧日志、旧 daemon、API、前端、回退五条路径。
- ✅ **风险识别**：R-01 ~ R-07 含 P0 迁移链断裂、P0 interactive 漏标、P1 按钮拥挤/MCP/逻辑漂移。
- ✅ **生命周期契约表**：§7.5 显式判定不适用（不改 session/lease/agent_run 状态机，仅加展示维度）。

**自审结论：通过，进入 Step 12 Design Grill 交叉审查。**
