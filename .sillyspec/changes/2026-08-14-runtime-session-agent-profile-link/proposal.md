---
author: WhaleFall
created_at: 2026-08-14 15:00:50
---

# 提案书（Proposal）

## 动机

`/runtimes` 页面的交互式会话界面上，「智能体提供方 / 智能体模型」两个字段对实际 LLM 调用几乎不起作用；与此同时平台已建好「智能体档案」能力（人格提示词 + 引擎 + 模型 + 凭证，`change` 变更流程已经能用），但会话（quick-chat）这条路径没有接上。本变更是把**既有的档案注入管道接到会话上**，让用户在会话里真正用上档案：选了档案由档案决定引擎/模型/凭证/人格，并支持会话中途换档案（换人格）而对话历史不丢。

## 关键问题

1. **会话 UI 字段是摆设**：首回合写入的 provider/model 会被后端 `_inject_provider_config`（`lease/context.py:208-294`）用「我的供应商」默认配置**覆盖**；active 态两控件禁用、inject 不传，中途也改不了。用户在会话界面无法真正控制"用哪个智能体、什么人格"。
2. **档案注入管道已通但会话没接**：`change` 选档案后的 system_prompt 注入链路（`_apply_profile_to_lease` → lease metadata → claim payload → daemon `preset:claude_code+append`）已存在并验证，但 interactive 会话路径（`DaemonSessionService.create_session`）从不调用它——同一个平台两套体验割裂。
3. **中途切换只能去设置页**：现有唯一活切换是「我的供应商」设默认 → `PROVIDER_CONFIG_CHANGED` 热切换，但那是**全局**切换且不带人格；用户需要的是**单会话内、按轮次**换档案（如一轮用"知识经理"整理、下一轮换"代码审查员"），历史连续不中断。

## 变更范围

- **Wave 1 后端接线**：`AgentSession` 加 `agent_profile_id`/`agent_profile_snapshot` 列（+迁移）；会话创建/注入 DTO 具名化并加 `agent_profile_id`；`create_session` 解析档案→派生 provider/model→调既有 `_apply_profile_to_lease`；`profile.model` 以显式标记真正生效（D-004@v2）。
- **Wave 2 daemon 热切换**：新增 `reloadWithProfile`（与 `reloadWithProvider` 共用 reload 内核）+ `pendingProfileSwitch` + `SESSION_SWITCH_PROFILE` 原子消息（D-007@v1）；turn 边界换 systemPrompt 并 resume 历史。
- **Wave 3 前端选择/切换**：会话区替换为单个「智能体档案」选择器（引擎/模型字段去掉，D-005@v1）；active 态同引擎档案切换入口；gen:types 同步。

## 不在范围内（显式清单）

- 不做 Codex 引擎的人格提示词注入（第一期仅 Claude；Codex 档案的引擎/模型/凭证仍跟随）。
- 不做跨引擎切换（Claude↔Codex 需重开新会话）。
- 不做档案 `mcp_refs/skill_refs/allowed_roots_overlay` 在会话内的实际裁剪（仅透传字段，与现状一致）。
- 不做批量 / `--print` 模式的 systemPrompt 注入。
- 不做手动模型选择（UI 模型字段移除，模型一律由档案或默认派生）。

## 成功标准（可验证）

- 未选档案的会话行为与现状完全一致（默认引擎/模型、无人格）——零回归。
- 选了 Claude 档案的会话：引擎=档案引擎、人格=档案 system_prompt（SDK preset+append 生效）、模型=档案 model（有则优先于供应商默认，D-004@v2 优先级矩阵单测钉死）、凭证=档案绑定供应商。
- 会话一轮完成后可切换同引擎档案：对话历史无缝保留（resume 重载）、新人格生效、其他会话不受影响（D-001 会话隔离）。
- 后端/daemon/前端相关测试全绿；`pnpm gen:types` 产物与后端 schema 同步提交。
