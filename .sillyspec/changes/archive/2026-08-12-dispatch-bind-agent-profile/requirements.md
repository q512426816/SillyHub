---
author: WhaleFall
created_at: 2026-08-12T09:55:00
change: 2026-08-12-dispatch-bind-agent-profile
---

# Requirements: 变更详情页阶段操作区接入智能体档案

## FR-01：UI 合并

变更详情页阶段操作区从两块分散（推进横幅 + provider/model/触发智能体）合并为**一块统一操作区**：档案选择器置顶 + 「推进到下一阶段」「🤖 触发智能体」两个按钮。手动 provider/model 输入框去掉。

## FR-02：档案选择器

合并后的操作区有一个 `AgentProfileSelect` 档案选择器，列出当前 workspace 可见的档案 + 「跟随工作区默认（不选档案）」兜底项。选择对两个按钮（推进/触发）共用生效。

## FR-03：单 agent 档案透传

选了档案点推进/触发 → `agent_profile_id` 经 HTTP → service → dispatch → `start_stage_dispatch` → `_resolve_dispatch_profile` + `_apply_profile_to_lease`，把档案的 provider/model/llm_provider_id 凭证/allowed_roots_overlay 写进 lease.metadata，daemon claim 消费。

## FR-04：不选档案零回归

不选档案（兜底项）→ `agent_profile_id=None` → `_resolve_dispatch_profile` 无 hint 零 SQL 返 None → dispatch 走 `workspace.default_agent`，行为与今天 100% 一致。

## FR-05：团队模式档案分配

团队模式（execute/verify 勾「用团队执行」）：
- 主 agent 选一个档案（替换现有 main_agent_config 手动 provider/model）。
- 每个 worker 各选一个档案（StageTeamConfig 的 worker 列表，每条从手动填 agent_type/model 改为选 profile_id）。
- worker 增删/数量交互不变。

## FR-06：worker 档案透传（修 GAP-6）

`MissionExecutionService.dispatch_worker` 创建 worker lease 后补调 `_apply_profile_to_lease`，把 worker 档案的 mcp/skill/凭证/allowed_roots 写进 worker lease.metadata。worker 档案解析失败（被删/越权）→ 标 worker run failed + return None，不崩 mission。

## FR-07：MCP 双入口一致

`advance_change_stage` MCP tool（`mcp_gateway/tools.py`）同步加 `agent_profile_id` 参数，与 HTTP `/advance-stage` 入口行为一致。

## FR-08：已知 gap 标注

UI 档案选择器旁明确提示：本次仅 provider/凭证/allowed_roots 生效，system_prompt/skill/mcp 下版本支持（链路修复放下个变更）。避免用户误以为 system_prompt 已生效。

## NFR-01：兼容性

- `agent_profile_id` 所有新增参数可选，None 路径零回归。
- `team_worker_preset` 旧数据（带 agent_type/model）仍能读，schema 放宽不破坏。
- 无 DB schema 变更。

## NFR-02：类型同步

后端 schema 改后跑 `pnpm gen:types`，提交 `api-types.ts` + `backend/openapi.json`。
