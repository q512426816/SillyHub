---
title: profile.system_prompt 注入 + stageProfileId 持久化
change_key: 2026-08-13-profile-system-prompt-injection
status: draft
created_at: 2026-08-13T14:50:00+08:00
author: WhaleFall
---

# Proposal: profile.system_prompt 注入 + stageProfileId 持久化

## 一句话

补全智能体档案绑定：profile.system_prompt 经 SDK systemPrompt（preset claude_code + append）注入到 agent（复用 lease.metadata 透传），stageProfileId 每阶段独立持久化到 change.stages。

## 动机

归档变更 `2026-08-12-dispatch-bind-agent-profile` 把档案绑定做了一半——provider/凭证/allowed_roots 透传已通，但 system_prompt 注入（GAP-2/3）和 stageProfileId 持久化明确排除留本变更。现状：选了档案 system_prompt 不生效（两头断：backend 不写 + daemon 没实现 claudeMd prepend），重进页面档案选择丢失。

## 方案概要

- **system_prompt 注入**：废弃原 D-012@v2 的 claudeMd prepend，改走 SDK 原生 `systemPrompt={preset:claude_code, append}`（保留 claude 默认能力 + 追加）。复用 `_PROFILE_PAYLOAD_FIELDS` 现有透传机制（lease.metadata → claim payload → daemon → SDK）。
- **stageProfileId 持久化**：每阶段独立存 `change.stages[stage].profile_id`，新 PATCH 端点，前端初始化恢复 + onChange 存。

## 规模评估

- scale: **large**（跨 backend + daemon + frontend，5 后端 + 2 daemon + 3 前端 = 10 文件，涉及 daemon TS session create + 新 API + 前端状态）
- tier: self
- risk_level: unit-sufficient（不改 run/lease 生命周期状态机，仅 session 启动参数 + 前端持久化）

## 不在范围内（Non-Goals）

- skill_refs / mcp_refs interactive 路径修复（原 GAP-4/5）
- 不改 provider/model/凭证/allowed_roots 透传（已通）
- 不补 daemon 的 claudeMd prepend（D-012@v2 废弃）
- 非 claude provider 的 systemPrompt（本次只 claude）

## 依赖

- 无外部依赖。
- 前置 `2026-08-12-dispatch-bind-agent-profile`（已归档）的 D-003@v1 透传机制。

## 详见

- [design.md](./design.md) — 完整技术设计（4 Phase + 生命周期契约表）
- [requirements.md](./requirements.md) — 需求与验收
- [tasks.md](./tasks.md) — 实现任务分解
