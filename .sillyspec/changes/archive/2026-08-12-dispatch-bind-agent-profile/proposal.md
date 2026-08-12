---
author: WhaleFall
created_at: 2026-08-12T09:55:00
change: 2026-08-12-dispatch-bind-agent-profile
---

# Proposal: 变更详情页阶段操作区接入智能体档案

## 一句话

把变更详情页「推进横幅」和「provider/model+触发智能体」两块分散 UI 合并成一块统一操作区，手动选 provider/model 改为**选择智能体档案**；选了档案就把档案配置（provider/model/凭证/allowed_roots）带入 dispatch 派发链路；不选走现有默认。团队模式下主 agent + 每个 worker 各选一个档案。

## 动机

昨天（2026-08-11-agent-profile-bind-llm-provider）刚给智能体档案加了供应商凭证绑定，档案已经成为「一套配好的智能体配置」（provider/model/凭证/技能/mcp/系统提示）。但变更详情页的阶段派发入口还停留在「手动填 provider + 手动填 model」的原始形态，用不上档案。用户希望在推进阶段或重派智能体时，能直接挑一个配好的档案，让跑起来的 agent 用档案的配置。

## 现状关键事实（为什么这个改动比想象的小）

调研发现下层基建全接好了，只缺上层透传：
- `AgentService.start_stage_dispatch` 已有 `agent_profile_id` 形参（前序变更留的口子）
- `_resolve_dispatch_profile` 兜底链 + `_apply_profile_to_lease`（写 lease.metadata）都已实现
- daemon claim payload 已会读这些 metadata
- `AgentProfileSelect` 前端组件已 drop-in 就绪

所以本变更核心 = **把 `agent_profile_id` 从 HTTP 入口一路透传到已存在的形参** + UI 合并重构。daemon 不改，不用 pnpm bundle，不用重建镜像。

## 范围

**做**：
1. UI 合并：去手动 provider/model 框，加档案选择器（方案 A，已定原型）。
2. 单 agent 透传：HTTP / service / dispatch 6 处加 `agent_profile_id`。
3. 团队模式：worker_preset 加 profile_id，`dispatch_worker` 补调 `_apply_profile_to_lease`（修 GAP-6）。
4. MCP `advance_change_stage` tool 同步加参数。

**不做（非目标，放下个变更）**：
- system_prompt 注入链路修复（GAP-2/3）：本次选了档案 system_prompt 也**不生效**。
- skill_refs / mcp_refs interactive 路径修复（GAP-4/5）：本次 metadata 进 lease 但 interactive spawn 不消费。

## 不在范围内（Non-Goals）

- 修 system_prompt 链路（stage run claude_md 被清空 + daemon 未写 CLAUDE.md）——下个变更。
- 修 interactive session skill/mcp 注入——下个变更。
- 持久化档案选择到 change 记录——用户明确要每次单独选。
- daemon 任何代码改动——本变更不需要。

## 部署影响

- backend 镜像需重建（Python 代码改了）。
- 前端镜像需重建。
- daemon **不重建**（无 daemon 代码改动）。
- 无 DB 迁移。
