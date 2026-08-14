---
title: profile system_prompt 注入 任务分解
change_key: 2026-08-13-profile-system-prompt-injection
status: draft
created_at: 2026-08-13T14:50:00+08:00
author: WhaleFall
---

# Tasks: profile.system_prompt 注入 + 持久化

## Wave 1：后端透传（基础，无依赖）

### task-01：_apply_profile_to_lease 加写 system_prompt
- [x] 文件：`backend/app/modules/agent/service.py`
- [x] `_apply_profile_to_lease` 合并 profile 键时加 `system_prompt`（profile.system_prompt 非空才写）
- [x] 验证：单测断言 lease.metadata 含 system_prompt

### task-02：_PROFILE_PAYLOAD_FIELDS 加字段
- [x] 文件：`backend/app/modules/daemon/lease/context.py`
- [x] 加 `("system_prompt","systemPrompt")`
- [x] 删 line 299「system_prompt 不在此列」过时注释
- [x] 验证：_apply_profile_passthrough 自动双写（generic 机制，加字段即生效）

## Wave 2：后端持久化端点（独立）

### task-03：PATCH /changes/{id}/stage-profile
- [x] 文件：`backend/app/modules/change/router.py` + `schema.py`
- [x] schema：`StageProfileUpdate { profile_id: str | None }`
- [x] router：PATCH 存 `change.stages[current_stage]["profile_id"]`
- [x] 验证：单测存 + 读回

## Wave 3：daemon SDK 注入（依赖 Wave 1）

### task-04：daemon claim→input 透传 systemPrompt
- [x] 文件：`sillyhub-daemon/src/daemon.ts`
- [x] 3 处 execPayload→input（line 3304/3658/3766 附近）加 `systemPrompt: execPayload.systemPrompt`
- [x] 依赖：task-02（claim payload 含 systemPrompt）

### task-05：daemon session create 注入 systemPrompt
- [x] 文件：`sillyhub-daemon/src/interactive/session-manager.ts`
- [x] CreateSessionInput 加 `systemPrompt?: string`
- [x] create() 透传 input.systemPrompt → state/spec
- [x] `_buildDriverOptions` 设 `driverOpts.systemPrompt = {type:'preset',preset:'claude_code',append:spec.systemPrompt}`
- [x] 依赖：task-04

## Wave 4：前端持久化（独立，可与 Wave 1-3 并行）

### task-06：前端 stageProfileId 恢复 + 存
- [x] 文件：`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` + `lib/changes.ts`
- [x] lib/changes.ts 加 `updateStageProfile(wsId, cid, profileId)` → PATCH
- [x] stageProfileId 初始化从 `change.stages[current_stage].profile_id` 读
- [x] onStageProfileChange 调 API 存 + setState
- [x] 切阶段 useEffect 重读对应 profile_id
- [x] 依赖：task-03（PATCH 端点）

## Wave 5：类型 + 验证（依赖全部）

### task-07：gen:types + 端到端验证
- [x] `pnpm gen:types`（PATCH 端点进 api-types.ts）
- [x] 端到端：选档案「Kimi 技术经理」触发 quick → 日志含 system_prompt 文本
- [x] 重进页面档案恢复
- [x] 不选档案零回归
- [x] 依赖：task-01~06 全部

## 依赖关系

```
Wave1: task-01 → task-02
Wave2: task-03 (独立)
Wave3: task-02 → task-04 → task-05
Wave4: task-03 → task-06
Wave5: task-01~06 → task-07
```
