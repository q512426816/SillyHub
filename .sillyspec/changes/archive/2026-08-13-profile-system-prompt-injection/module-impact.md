---
title: module-impact · profile.system_prompt 注入 + stageProfileId 持久化
change_key: 2026-08-13-profile-system-prompt-injection
author: WhaleFall
---

# Module Impact：profile.system_prompt 注入 + stageProfileId 持久化

## 受影响模块

### backend/agent（service.py）
- `_apply_profile_to_lease`：lease.metadata 加第 6 键 `system_prompt`（profile.system_prompt 非空才写），与 mcp_refs/skill_refs/effective_allowed_roots/profile_version/llm_provider_id 同路。
- 影响：dispatch 写 lease 时携带 system_prompt，供 daemon 透传。零回归（空不写键）。

### backend/daemon/lease（context.py）
- `_PROFILE_PAYLOAD_FIELDS`：加 `("system_prompt","systemPrompt")`，`_apply_profile_passthrough` 自动双写 camelCase+snake_case 进 claim payload。
- 删除 line 299「system_prompt 不在此列」过时注释（D-012@v2 已废弃）。

### backend/change（router.py + schema.py）
- 新端点 `PATCH /changes/{id}/stage-profile`（`update_stage_profile`），存 `change.stages[current_stage]["profile_id"]`（每阶段独立 D-003，profile_id=None 清除）。
- 新 DTO `StageProfileUpdate { profile_id: str | None }`。
- 无 DB 迁移（stages 是 JSON 列）。

### sillyhub-daemon（daemon.ts / session-manager.ts / claude-sdk-driver.ts / types.ts）
- `daemon.ts`：interactive `SessionManager.create` 路径透传 `systemPrompt: execPayload.systemPrompt`；execPayload 构造处从 `rawExec.systemPrompt ?? rawExec.system_prompt ?? payload.systemPrompt` 填充。
- `session-manager.ts`：CreateSessionInput 加 `systemPrompt?`；`_buildDriverOptions` 设 `{type:'preset',preset:'claude_code',append}`；create 透传；PersistedSessionRecord 落盘 + restore 重注入（§5.6）。
- `claude-sdk-driver.ts`：逐字段挑写 `options.systemPrompt`（非 spread）；非 claude driver 编译期隔离（D-005）。
- `types.ts`：LeasePayload / PersistedSessionRecord 加 `systemPrompt?`。

### frontend（changes.ts / [cid]/page.tsx / api-types.ts）
- `lib/changes.ts`：`updateStageProfile(wsId, cid, profileId)` → PATCH。
- `[cid]/page.tsx`：stageProfileId 用 useEffect 从 `change.stages[current_stage].profile_id` 恢复（非 useState initializer）；onChange 调 API 存（D-003 每阶段独立）。
- `api-types.ts` + `backend/openapi.json`：gen:types 重生成（PATCH 端点类型）。

## 不受影响 / 零回归保证

- **run/lease 生命周期状态机**：systemPrompt 是 session 启动参数，不改 pending→running→completed（design §7）。
- **provider/model/凭证/allowed_roots 透传**：未碰（D-003@v1 已通）。
- **batch / --print 路径**：未注入 systemPrompt（§1.3 非目标，仅 interactive/stage run）。
- **skill_refs / mcp_refs interactive 实际生效**：未碰（原 GAP-4/5，留后续）。
- **PPM 模块**：零影响（profile_id/snapshot 全 nullable，null 零新增查询）。

## 模块文档同步

- `agent.md`（backend）：人工备注追加本变更索引（systemPrompt 注入链路）。
- daemon / change 模块文档：本变更未触及既有契约边界，无需结构性更新（行为为新增透传，非契约改动）。
