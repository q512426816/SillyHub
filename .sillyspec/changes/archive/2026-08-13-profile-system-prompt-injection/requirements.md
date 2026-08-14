---
title: profile system_prompt 注入 需求
change_key: 2026-08-13-profile-system-prompt-injection
status: draft
created_at: 2026-08-13T14:50:00+08:00
author: WhaleFall
---

# Requirements: profile.system_prompt 注入 + 持久化

## FR-01：backend 写 system_prompt 进 lease.metadata

`_apply_profile_to_lease` 加写 `system_prompt` 键（从 profile.system_prompt，空则不写）。

## FR-02：backend 透传 system_prompt 进 claim payload

`_PROFILE_PAYLOAD_FIELDS` 加 `("system_prompt","systemPrompt")`，`_apply_profile_passthrough` 自动双写。

## FR-03：daemon claim→CreateSessionInput 透传 systemPrompt

daemon.ts 3 处 execPayload→input 加 `systemPrompt: execPayload.systemPrompt`。

## FR-04：daemon SDK 注入 systemPrompt

`_buildDriverOptions` 设 `driverOpts.systemPrompt = {type:'preset',preset:'claude_code',append:spec.systemPrompt}`，create() 透传到 spec，claude driver 透传到 SDK。

## FR-05：stageProfileId 每阶段独立持久化（后端）

新 PATCH `/changes/{id}/stage-profile` 存 `change.stages[<current_stage>]["profile_id"]`。

## FR-06：stageProfileId 前端恢复 + 存

初始化从 `change.stages[current_stage].profile_id` 读；onChange 调 PATCH 存；切阶段重读。

## NFR-01：向后兼容

profile.system_prompt 空 → 不写键 → 行为同今天。不选档案（跟随默认）→ 无 system_prompt 注入。主线 run / provider/凭证/roots 透传零回归。

## NFR-02：无 DB 迁移

change.stages 是 JSON 列，加 profile_id 子键无 schema 改动。

## NFR-03：仅 claude provider 注入

非 claude provider（glm/codex）driverOpts.systemPrompt 不设（不崩）。

## 验收

见 [design.md §11](./design.md#11-验收标准)。
