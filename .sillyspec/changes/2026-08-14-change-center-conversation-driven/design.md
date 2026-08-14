---
author: qinyi
created_at: 2026-08-14 14:54:22
revised_at: 2026-08-14 15:10:00
scale: large
risk_level: contract-required
review_round: 1 (Design Grill round-1: 1 P0 + 7 P1，本版据审查修订)
---

# 设计文档（Design）— 变更中心会话驱动化

## 1. 背景

变更中心当前模型：变更只能从前端「+ 新建变更」表单创建（`create-change/page.tsx` → `proxyCreateChange`）；变更详情页是控制台（推进阶段 / 重新派发 / 选团队·智能体档案 / 运行验证门禁 / 人工审批）；交互式会话（`InteractiveSessionPanel`）已存在但只是变更详情页里「会话调试」配角。

用户要求翻转模型：**会话是第一步入口**（用户在工作区与 agent 对话，agent 靠本地 sillyspec 技能自己决定怎么走，平台不管控），平台退化为**展示板（变更文件/进度）+ 会话入口**，变更由 agent 通过 sillyspec 工具创建、数据经同步链路被动到达平台。

调研确认的命门：变更出现在平台列表必须有 `ux_changes` 行（`change/service.py list_` 只查此表），建行唯一剩余路径是 `ChangeService.reparse`（文件系统扫描）。daemon 稳态默认的**增量同步**（`spec_workspace/service.py apply_ops:914`）**不触发 reparse** → agent 本地新建的变更落盘但列表不出现。全量同步（apply_sync `_reparse_phase:781`）已触发；`platform_sync` 推进度只写 `platform_change_progress` 不建 `ux_changes` 行。依据：sillyspec 仓库 `docs/sillyspec/platform-interface-map.md`（daemon 调用 = 平台模式，CLI 链路 A REST 全跳过 `shared.js:335`，进度回传完全依赖 daemon 自有同步链路）。

**在途 change 基线声明**：本变更与 `2026-08-13-spec-sync-visibility`（W1-W3 已 commit，task-08~10/W4 未完）触及同两文件（`spec_workspace/service.py`、`spec-sync.ts`）。本变更基于其**已 commit 部分**之上实现，postSpecSync/apply_ops 两处改点以功能共存合并（其改动 = 失败透传/进度列/进度端点；本变更 = change_dirs 标注 + reparse 触发），不回退其任何改动；若其后续 Wave 先落地，本变更 rebase 后继续。

## 2. 设计目标

- 去掉前端「新建变更」表单链路（页面 + 按钮 + 后端 create 端点）。
- 工作区新增独立「会话」入口（与变更中心平级），复用交互式会话面板，会话为 workspace 级（不绑具体变更）。
- **变更自动出现**：agent 在会话里建的变更经增量同步自动进平台列表（补 reparse 触发命门）。
- 变更详情页去掉全部执行控制（推进/重新派发/验证门禁/选档案/团队配置），保留人工审批卡。
- 审批只落审批记录和阶段状态（不自动派发）；审批结果由**后端以服务身份**自动注入变更绑定的会话，agent 直接继续。

## 3. 非目标

- 不改 sillyspec 工具本身（CLI 行为、MCP 配置协议不动；依据 platform-interface-map.md 契约）。
- 不新增 `create_change` MCP 工具（agent 靠本地 sillyspec CLI 建变更）。
- **不动 MCP change 阶层 4 工具的存在性**，但 `submit_stage_review` 工具行为随 D-004 联动变更（docstring 与返回契约同步更新，见 §5 P2）。
- 不动 daemon 的调度/lease/mission/kill 机制；`advance_change_stage` 等保留，作为 agent 侧可选推进路径。
- 不做会话内审批 UI（审批入口仍在变更详情页）。
- 不做旧数据迁移/历史兼容（项目未上线，允许清数据）。

## 4. 拆分判断

单 change 多 Wave。会话入口、去表单、reparse 命门、详情页退化是一个整体语义（变更中心会话驱动化），拆成多个 change 会出现「表单没了但会话入口未上」的割裂中间态；各部分耦合在同一交互模型上（审批联动依赖绑定，绑定依赖 reparse 发现）。不走批量模式。

## 5. 总体方案（六 Phase）

### P1 后端·变更自动出现链路（命门）+ 会话绑定
- daemon `spec-sync.ts` + `hub-client.ts`：增量推送时计算本次涉及 `changes/<name>/`（含 `changes/archive/<name>/` 归档路径）的目录集合，经 `postSpecSyncIncremental`（hub-client.ts:966，body 现只有 `{ops}`，加 `change_dirs` 字段）放入请求体。
- backend `spec_workspace/schema.py`：`SpecIncrementalSyncRequest`（实名 schema.py:104）加 `change_dirs: list[str] = []`。
- backend `apply_ops` 落盘后（事务外 best-effort）：① 有标注 → 对涉及目录触发 scoped reparse；② 无标注（旧 daemon）→ 扫 ops 路径 `changes/` 前缀兜底。**归档路径（`changes/archive/` 前缀）命中时走全量 reparse**（归档 = 目录跨根移动，scoped 只增不删的语义处理不了）。
- `ChangeService.reparse` 支持 scoped，**删除守卫（P0 修正）**：scope 模式下**只做 create/update，不做 delete**——scope 外的变更不进 parsed 集合也不判删除；scope 内 key 若磁盘确认消失也不删（留全量/手动重扫描收敛）。delete 仅发生在全量 reparse（现状语义不变）。`change/parser.py` 的 `parse_workspace` 需支持按 key 过滤（或 service 层对解析结果过滤）。
- **新变更自动绑定会话**：reparse scoped/全量发现新变更（created）时，按 §8 绑定查询写 `change_session_links`。

### P2 后端·会话列表端点 + 审批语义
- 会话列表：**扩展现有** `GET /workspaces/{wid}/agent-sessions`（agent/router.py:544，现 active-only 最小字段）——加 `include_ended: bool` 参数，返回完整 `AgentSessionListItem`（实际字段：id/provider/status/turn_count/author/last_active_at/title，daemon/schema.py:71）。不新造双端点。
- 创建会话复用现有 `create_session`（已收 workspace_id），无需新端点。
- 审批四方法（proposal_review/plan_review/human_test/archive_confirm，service.py:1309+）：通过/打回只落审批记录 + 阶段状态，删除审批通过后的自动派发调用；**「打回」映射到各阶段既有 decision 词表**（revise/unclear/replan/back_to_propose/back_to_brainstorm/bug/doc_mismatch，按各端点现有合法值），前端审批卡「打回」默认映射各阶段的主打回项（如 plan→replan、proposal→revise），具体映射表在 P5 前端实现时按 lib/changes.ts:567 submitStageReview 分发逻辑对齐。
- **投影收敛（P1 修正）**：审批推进阶段落库 `ux_changes.current_stage` 时，同步 upsert `platform_change_progress`（source=platform，stage=新阶段），使读时投影（`latest_progress` 覆盖，change/service.py:1259-1271）立即收敛，消除「回显旧阶段/重复审批」窗口。
- **审批-会话注入（D-006@v2）**：审批四端点加可选参数 `notify_session: bool = true`；审批落库+投影收敛后，后端**以服务身份**（非用户身份，绕过 `inject_session` 的会话归属校验 daemon/session/service.py:704 `_get_owned_session_for_update`——多成员工作区审批人≠会话创建人不受 403）对绑定会话注入审批消息；注入 best-effort，失败不回滚审批，结果随审批响应返回（`notified_session: bool, notify_error?: str`）。
- MCP `submit_stage_review` 工具（mcp_gateway/tools.py:1029）docstring 与返回契约随上述行为同步更新（`agent_dispatch` 字段移除/恒空说明）。
- 跑 `pnpm gen:types` 同步 `api-types.ts` + `openapi.json`。

### P3 前端·独立会话页
- `workspace-tabs.tsx` 加「会话」tab；新页 `workspaces/[id]/sessions/page.tsx`：左侧 workspace 级会话列表（含已结束，`include_ended=true`）+ 发起入口，右侧复用 `InteractiveSessionPanel`；从 `change-session-section.tsx` 抽通用 `WorkspaceSessionSection`（不传 changeId）。

### P4 前端·去表单
- 删 `changes/page.tsx` 的「+ 新建变更」按钮与空态 CTA；删 `create-change/page.tsx`；空态改为引导「去会话跟 agent 对话」（链接会话页）。「重新扫描」保留作兜底。
- 后端 `change_writer` 删除端点：`/changes/create`、`/changes/proxy-create`（页面删除后无调用方），连带清理已无调用方的 `/execute` 与 `documents/*` 端点及前端 `executeChange`（lib/changes.ts:208，Grill F-5 证无调用方）。

### P5 前端·变更详情页退化 + 审批联动
- `ChangeStageActions` 删：推进（onAdvance）/重新派发（onDispatch）/运行验证门禁/选智能体档案/团队配置；**quick 阶段分支（change-stage-actions.tsx:143-199）同样删除**——quick 类变更的触发本就由 agent 在会话里跑 `sillyspec run quick`，会话驱动闭环一致。
- 保留：阶段进度条、执行日志流、变更文件卡、审核历史、任务看板（只读展示）。
- 审批卡（唯一操作）：意见输入 + **只读显示绑定会话**（取 `change_session_links` 最新）+「通过并通知绑定会话 / 打回并通知绑定会话」；**单端点调用**（审批端点带 notify_session），据响应 `notified_session` 显示结果。**降级分类**：① 注入返回 turn 冲突（agent 正在忙）→ 提示「审批已生效，agent 忙，请稍后在会话中告知继续（文案已复制）」；② 会话非 active → 提示「绑定会话已结束，去会话页开启新会话（文案已复制）」；③ 注入异常 → 通用提示 + 文案可复制。审批记录与状态已落库不受任何注入失败影响。
- 审批消息格式（后端拼）：`[平台审批] 变更 <change_key> 的 <阶段> 审批已<通过/打回（decision）>。<意见>。请继续推进。`

### P6 文档 + 测试
- 模块文档同步：backend change / spec_workspace / agent(session) / mcp_gateway / change_writer / daemon / frontend。
- 测试：apply_ops 标注触发 scoped reparse；无标注路径检测兜底；**scoped 模式不删行（范围外/范围内消失均不删）**；归档路径走全量；reparse 新变更自动绑定最近活跃会话（按 §8 查询语义）；审批不派发 + 投影收敛 + 服务身份注入（含非本人会话/turn 冲突/非 active 三类降级）；前端 vitest（会话页 / 列表空态 / 详情页退化含 quick 分支删除 / 审批卡三类降级）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/spec-sync.ts | 增量推送计算 change_dirs（ops 路径 `changes/` 与 `changes/archive/` 前缀分组取 key）。数据流：producer=`computeIncrementalOps` → `postSpecSyncIncremental` 请求体 → consumer=backend `SpecIncrementalSyncRequest.change_dirs`（缺省 [] 兼容旧请求） |
| 修改 | sillyhub-daemon/src/hub-client.ts | `postSpecSyncIncremental`（:966）签名与 body 加 `change_dirs: string[]`（Grill F-1 补） |
| 修改 | backend/app/modules/spec_workspace/schema.py | `SpecIncrementalSyncRequest`（:104）加 `change_dirs: list[str] = []` |
| 修改 | backend/app/modules/spec_workspace/service.py | `apply_ops` 事务外 best-effort：有标注→scoped reparse；无→`changes/` 前缀检测兜底；`changes/archive/` 命中→全量 |
| 修改 | backend/app/modules/change/service.py | ① `reparse(scope)` scoped + 删除守卫（scope 模式零 delete）；② created 新变更→§8 绑定查询→写 change_session_links；③ review 四方法删派发 + 投影收敛（upsert platform_change_progress）+ 服务身份注入绑定会话（notify_session 参数，best-effort） |
| 修改 | backend/app/modules/change/parser.py | `parse_workspace` 支持按 key 集合过滤（或 service 层过滤解析结果）（Grill F-3 补） |
| 新增 | backend/app/modules/change/model.py 内 ChangeSessionLink | id/change_id/session_id/created_at，unique(change_id, session_id) |
| 新增 | backend/alembic/versions/2026xxxx_add_change_session_links.py | 建表 migration |
| 修改 | backend/app/modules/agent/router.py | 扩展 `GET /workspaces/{wid}/agent-sessions`（:544）加 `include_ended` 参数返回完整 AgentSessionListItem（Grill C-5：不新增双端点） |
| 修改 | backend/app/modules/mcp_gateway/tools.py | `submit_stage_review`（:1029）docstring/返回契约随 D-004/D-006@v2 更新（Grill C-1 补） |
| 删除 | backend/app/modules/change_writer/router.py 的 create/proxy-create/execute/documents 端点 | 页面删除后无调用方（Grill F-5 连带清理）；模块文档同步 |
| 修改 | frontend/src/components/workspace-tabs.tsx | TABS 加 `sessions` |
| 新增 | frontend/src/app/(dashboard)/workspaces/[id]/sessions/page.tsx | 会话列表页（左列表含已结束 + 右面板） |
| 新增 | frontend/src/components/workspace-session-section.tsx | 从 change-session-section 抽通用组件（只传 workspaceId） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx | 删「+ 新建变更」按钮与空态 CTA；空态引导会话页 |
| 删除 | frontend/src/app/(dashboard)/workspaces/[id]/create-change/page.tsx | 表单页下线 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | 删执行控制 state/handler（含 quick 分支）；审批 handler 改单端点（notify_session） |
| 修改 | frontend/src/components/changes/detail/change-stage-actions.tsx | 删执行控制 UI（含 quick 分支 :143-199）；审批卡：意见+绑定会话只读+通过/打回并通知（三类降级提示） |
| 修改 | frontend/src/lib/changes.ts | 删 createChange/proxyCreateChange/executeChange；submitStageReview 加 notify_session 透传 |
| 修改 | frontend/src/lib/daemon.ts | agent-sessions 列表调用加 include_ended；injectSession 不再被审批卡直调（注入移后端） |
| 修改 | frontend/src/lib/api-types.ts + backend/openapi.json | `pnpm gen:types` 再生成 |
| 新增/修改 | backend spec_workspace/tests/ + change/tests/ + agent/tests/ + mcp_gateway/tests/ | §5 P6 测试清单 |
| 修改 | .sillyspec/docs/backend/modules/{change.md,spec_workspace.md,agent.md,mcp_gateway.md,change_writer.md,_module-map.yaml} + frontend 模块文档 | 文档同步 |

## 7. 接口定义

```python
# daemon → backend 增量同步（既有端点，请求体加标注；schema 实名 SpecIncrementalSyncRequest，现仅 ops 字段）
POST .../sync-incremental
{ "ops": [...], "change_dirs": ["2026-08-15-foo"] }   # change_dirs 新增，缺省 []

# workspace 会话列表（扩展现有端点，非新增）
GET /api/workspaces/{wid}/agent-sessions?include_ended=true
→ AgentSessionListItem[]  # 实际字段：id/provider/status/turn_count/author/last_active_at/title（daemon/schema.py:71）

# 审批（四个既有独立端点，行为变更 + notify_session）
POST /api/workspaces/{wid}/changes/{cid}/review/{proposal|plan|human-test|archive-confirm}
{ "decision": "<各端点合法值：approve/reject/revise/replan/...>", "comment": "...", "notify_session": true }
# 响应：change 更新 + { "notified_session": bool, "notify_error": "turn_conflict|session_inactive|..." | null }
# 行为：只落审批记录+阶段状态（不派发）；投影收敛；服务身份注入绑定会话（best-effort）

# scoped reparse（service 层签名）
ChangeService.reparse(workspace, scope: list[str] | None = None) -> ReparseStats
# scope=None 全量（含 delete，现状语义）；scope=[...] 只 create/update，零 delete；archive 路径命中走全量
```

## 7.5 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| sync-incremental（含 change_dirs） | daemon spec-sync/hub-client | backend spec_workspace | ops, change_dirs | spec_root 文件更新；触发 scoped reparse（archive 命中→全量） |
| scoped reparse | backend apply_ops | ChangeService.reparse | scope(change_dirs) | ux_changes 行 created/updated；**零 delete** |
| 新变更绑定会话 | backend reparse | change_session_links | change_id, session_id | 新增 link 行（change created 时一次） |
| create session（workspace 级） | 前端会话页 | daemon create_session | workspace_id, provider?, model? | session → active |
| submit_stage_review | 前端审批卡 / MCP | backend change service | change_id, decision, comment, notify_session | pending_review → 阶段推进/打回；**不派发 agent** |
| 投影收敛 | backend 审批 service | platform_change_progress | change_name, stage(source=platform) | latest_progress 对齐新阶段（消除读侧回显旧阶段窗口） |
| 审批结果注入 | backend 审批 service（服务身份） | daemon session inject | session_id, message | session 追加 turn；失败（turn 冲突/非 active）→ 降级提示，审批不回滚 |
| 会话 turn 完成 | daemon | backend | run_id, status, output | run → completed/failed（turn 结束触发 postSpecSync，daemon.ts:1791） |

注：lease/claim/heartbeat 机制不在本次改动范围（非目标），表中仅含本次新增/变更事件。

## 8. 数据模型

新表 `change_session_links`：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| change_id | UUID FK → changes(id) ON DELETE CASCADE | |
| session_id | UUID FK → agent_sessions(id) ON DELETE CASCADE | |
| created_at | timestamptz | |

约束：unique(change_id, session_id)。审批/详情页取该 change 最新一条 link 的 session。

**绑定查询（可测试 SQL 语义，Grill D-2 修正）**：
```sql
SELECT s.id FROM agent_sessions s
WHERE s.workspace_id = :wid AND s.deleted_at IS NULL
ORDER BY coalesce(s.last_active_at, s.created_at) DESC
LIMIT 1
```
跨成员（变更属 workspace 不属个人）；不限 status（已结束会话也可绑——注入时按非 active 降级）；排序键 = coalesce(last_active_at, created_at) desc（对齐 daemon/session/service.py:1499-1515 先例）。

不修改 `AgentSession`（其 `change_id` 单值 FK 保留，服务于既有「变更上下文会话」；一会话多变更由 link 表承载）。

## 9. 兼容策略

- 旧 daemon（无 change_dirs）→ backend 路径前缀检测兜底，行为等价；pydantic v2 缺省 `[]` 不报错。
- 新 daemon + 旧 backend：请求体多余字段被 pydantic 忽略，同步主流程不受影响。
- reparse 失败 → 告警 + 同步主流程继续；「重新扫描」按钮保留手动兜底（全量语义含 delete，负责收敛 scoped 模式不做的删除）。
- 审批注入失败（turn 冲突/会话非 active/异常）→ 审批已落库不回滚，前端三类降级提示（§5 P5）。
- **在途 change 衔接**：基于 spec-sync-visibility 已 commit 部分实现（§1 基线声明），不回退其改动。
- 未上线：change_writer 端点与 create-change 页面直接删除，不留废弃层。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 增量同步频繁触发 reparse 的性能开销 | P2 | scoped（零 delete 只 create/update）+ scandir 优化；change_dirs 空且无命中路径零触发 |
| R-02 | 绑定启发式绑偏（并行双会话同时建变更） | P2 | V1 接受：后果仅审批消息进错会话（消息含 change_key 可辨识）；后续可加显式绑定/改绑 |
| R-03 | 审批注入失败（turn 冲突/会话非 active/异常） | P2 | best-effort 不回滚审批；前端三类降级提示 + 文案可复制 |
| R-04 | reparse 在 apply_ops 内失败拖垮同步主流程 | P1 | 事务外 best-effort，失败仅告警 |
| R-05 | 详情页删执行控制后 agent 不推进导致变更停滞 | P1 | 闭环=会话驱动 + 审批联动注入 + 投影收敛；MCP advance_change_stage 保留兜底；列表「待办状态」列提示 |
| R-06 | 删 change_writer 端点/页面的回归面（测试引用、空态断言） | P2 | 全局搜引用清理（Grill F-5 已清点：前端仅 create-change 页+lib/changes.ts+测试+api-types）；测试改写 |
| R-07 | daemon 与 backend 标注契约两端版本错配窗口 | P2 | 两端按缺省容错；同仓同发 |
| R-08 | scoped reparse 误删范围外变更（Grill P0） | ~~P0~~ 已修 | scoped 模式零 delete（§5 P1 删除守卫）；delete 仅全量；测试覆盖 |
| R-09 | 审批后投影回显旧阶段/重复审批窗口（Grill C-3） | ~~P1~~ 已修 | 审批落库时 upsert platform_change_progress 收敛（§5 P2）；测试覆盖 |
| R-10 | injectSession 会话归属 403 / turn 冲突（Grill F-2） | ~~P1~~ 已修 | 注入移后端服务身份（D-006@v2）；turn 冲突/非 active 走降级；测试覆盖 |
| R-11 | MCP submit_stage_review 行为漂移未同步（Grill C-1） | ~~P1~~ 已修 | docstring/返回契约随 D-004 更新入清单；测试覆盖 |

## 11. 决策追踪

| 决策 | 内容 | 章节 |
|---|---|---|
| D-001@v1 | 去掉前端新建变更表单链路（页面+按钮+后端 create 端点，连带 execute/documents 清理） | §2/§5 P4 |
| D-002@v1 | 工作区独立会话入口（与变更平级，workspace 级不绑变更） | §5 P3 |
| D-003@v1 | 详情页去全部执行控制（含 quick 分支），保留人工审批卡 | §5 P5 |
| D-004@v1 | 审批通过/打回只落记录+状态，不自动派发；MCP 工具行为同步更新 | §5 P2 |
| D-005@v1 | daemon 增量推送带 change_dirs 标注 + backend 无标注路径检测兜底；scoped 零 delete | §5 P1 |
| D-006@v2 | 审批-会话联动：后端服务身份注入绑定会话（supersedes D-006@v1 前端 injectSession 两步——受会话归属 403 限制，多成员场景不可用） | §5 P2/P5/§7 |
| D-007@v1 | 会话绑定=创建时自动绑最近活跃会话（可测试 SQL 语义），change_session_links 多对多 | §5 P1/§8 |

## 12. 自审（Self-Review，round-1 修订版）

- ✅ 必填章节齐全；Grill round-1 全部发现已落：P0（R-08 scoped 零 delete）、C-1（R-11 MCP 同步）、C-2（§7 实名 schema/四端点 decision 词表/AgentSessionListItem 实际字段）、C-3（R-09 投影收敛）、F-1（hub-client.ts 入清单）、F-2（R-10 服务身份注入+三类降级）、C-6（§1/§9 在途基线）、D-2（§8 SQL 语义）、C-4（quick 分支删除+闭环说明）、C-5（扩展 agent-sessions 不新增双端点）、D-3（归档路径走全量）、F-3（parser.py 入清单）、F-5（execute/documents 连带清理）。
- ✅ 生命周期契约表 8 事件（新增投影收敛），全部有文件清单落点。
- ⚠️ 交 plan 的存疑点：① 打回按钮→各阶段 decision 的默认映射表（P5 实现时按 lib/changes.ts:567 对齐，不阻塞）；② spec-sync-visibility 未完 Wave 与本变更的合并次序（执行时按 §1 基线处理）。
- scale: large（跨 backend/daemon/frontend + 新表 + 端点删除/扩展 + 信息架构调整）。
