---
title: profile system_prompt 注入 实现计划
change_key: 2026-08-13-profile-system-prompt-injection
stage: plan
scale: large
created_at: 2026-08-13T15:35:00+08:00
author: WhaleFall
---

# 任务清单（Tasks）：profile.system_prompt 注入 + 持久化

## 概述

补全智能体档案绑定：profile.system_prompt 经 SDK systemPrompt（preset claude_code + append）注入 + stageProfileId 每阶段独立持久化。详见 [design.md](./design.md)。

**关键修订（Design Grill 独立 QA 发现，已纳入）**：
- daemon.ts 只改 interactive 1 处（3304），3655/3766 batch 不动（非目标）
- resume/重连路径必须重注入 systemPrompt（§5.6 PersistedSessionRecord + restoreAndReconnect）
- _apply_profile_to_lease 现写 5 键（含 llm_provider_id），加 system_prompt 第 6 键
- 前端用 useEffect 恢复（非 useState initializer，change 异步加载）

## Wave 分组

### Wave 1：后端透传（基础，无依赖）

- [ ] task-01: _apply_profile_to_lease 加写 system_prompt
  - 文件：`backend/app/modules/agent/service.py` + `backend/app/modules/agent/tests/test_dispatch_profile.py`
  - goal：backend 创建 lease 时把 profile.system_prompt 写进 lease.metadata
  - implementation：service.py `_apply_profile_to_lease` 合并 profile 键处加 `if profile.system_prompt: meta["system_prompt"] = profile.system_prompt`（与现有 5 键 effective_allowed_roots/mcp_refs/skill_refs/profile_version/llm_provider_id 并列，第 6 键）
  - 验收标准：lease.metadata 含 system_prompt 键（非空时）；空则不写（行为同今天）
  - 验证：pytest test_dispatch_profile.py 断言 lease.metadata["system_prompt"]
  - constraints：空值守护；不改现有 5 键
  - allowed_paths：backend/app/modules/agent/service.py, backend/app/modules/agent/tests/test_dispatch_profile.py
  - depends_on：无
  - provides：lease_metadata_system_prompt[system_prompt]

- [ ] task-02: _PROFILE_PAYLOAD_FIELDS 加 system_prompt 透传
  - 文件：`backend/app/modules/daemon/lease/context.py` + `backend/app/modules/agent/tests/test_dispatch_metadata.py`
  - goal：claim payload 自动透传 system_prompt（复用现有 generic 机制）
  - implementation：context.py `_PROFILE_PAYLOAD_FIELDS` 加 `("system_prompt","systemPrompt")`；删 line 299 过时注释。`_apply_profile_passthrough` 已 generic，加字段即自动双写 claim payload
  - 验收标准：claim payload 含 systemPrompt + system_prompt 双写
  - 验证：pytest test_dispatch_metadata.py 断言 payload 含 systemPrompt
  - constraints：仅加字段+删注释，不改 _apply_profile_passthrough 逻辑
  - allowed_paths：backend/app/modules/daemon/lease/context.py, backend/app/modules/agent/tests/test_dispatch_metadata.py
  - depends_on：task-01
  - provides：claim_payload_system_prompt[systemPrompt, system_prompt]

### Wave 2：后端持久化端点（独立）

- [ ] task-03: PATCH /changes/{id}/stage-profile 存每阶段 profile_id
  - 文件：`backend/app/modules/change/router.py` + `backend/app/modules/change/schema.py`
  - goal：前端能存/清 change.stages[current_stage].profile_id
  - implementation：schema.py 加 `StageProfileUpdate { profile_id: str | None }`；router.py 加 PATCH `/workspaces/{ws}/changes/{cid}/stage-profile`，读 current_stage，写 stages[stage]["profile_id"]
  - 验收标准：PATCH 存后 GET 返回 stages[stage].profile_id 正确；None 清除
  - 验证：pytest PATCH 存+读回
  - constraints：每阶段独立（D-003）；dict copy 防 JSON in-place 不 dirty
  - allowed_paths：backend/app/modules/change/router.py, backend/app/modules/change/schema.py
  - depends_on：无
  - provides：stage_profile_endpoint[endpoint_path, stage, profile_id]

### Wave 3：daemon SDK 注入（依赖 Wave 1；内部 task-04→05→06 串行，execute 引擎勿并行批跑）

- [ ] task-04: daemon claim→CreateSessionInput 透传 systemPrompt（interactive 1 处）
  - 文件：`sillyhub-daemon/src/daemon.ts`
  - goal：daemon interactive create 路径拿到 systemPrompt
  - implementation：daemon.ts line 3304 附近（interactive SessionManager.create）加 `systemPrompt: execPayload.systemPrompt`。**只改 3304**，3655/3766 batch 不动
  - 验收标准：claim payload 有 systemPrompt 时 CreateSessionInput.systemPrompt 收到
  - 验证：tsc 编译；grep 确认只 interactive 1 处
  - constraints：只改 interactive（3304）；batch 不动
  - allowed_paths：sillyhub-daemon/src/daemon.ts
  - depends_on：task-02
  - provides：create_input_system_prompt[systemPrompt]

- [ ] task-05: daemon SessionManager create + resume 注入 systemPrompt
  - 文件：`sillyhub-daemon/src/interactive/session-manager.ts`
  - goal：session create 与 resume/重连都注入 systemPrompt（preset+append）
  - implementation：①CreateSessionInput 加 `systemPrompt?: string`；②create() 透传 input.systemPrompt→state + spec；③_buildDriverOptions 加 `if (spec.systemPrompt) driverOpts.systemPrompt={type:'preset',preset:'claude_code',append:spec.systemPrompt}`；④resume（§5.6）：PersistedSessionRecord 加 systemPrompt create 落盘；restoreAndReconnect（2400+）从 record 恢复→state→spec
  - 验收标准：create + resume 都设 driverOpts.systemPrompt；daemon 重启后 system_prompt 不丢
  - 验证：tsc 编译；断言 create + restoreAndReconnect 后 driverOpts.systemPrompt
  - constraints：resume 必须覆盖（Design Grill 最大缺口）；preset:claude_code 保留默认能力
  - allowed_paths：sillyhub-daemon/src/interactive/session-manager.ts
  - depends_on：task-04
  - provides：session_system_prompt_injection[create_path, resume_path, driverOpts_shape]

- [ ] task-06: claude-sdk-driver 透传 systemPrompt 到 SDK
  - 文件：`sillyhub-daemon/src/interactive/claude-sdk-driver.ts`
  - goal：driver 把 driverOpts.systemPrompt 写进 SDK StartOptions
  - implementation：claude-sdk-driver.ts options 构造处（322-388 逐字段模式）加 `if (opts.systemPrompt !== undefined) options.systemPrompt = opts.systemPrompt`
  - 验收标准：SDK StartOptions.systemPrompt 设置；非 claude driver 编译期不让赋（D-005）
  - 验证：tsc 编译；grep options.systemPrompt
  - constraints：仅 claude driver；逐字段（非 spread）
  - allowed_paths：sillyhub-daemon/src/interactive/claude-sdk-driver.ts
  - depends_on：task-05
  - provides：sdk_system_prompt[StartOptions.systemPrompt]

### Wave 4：前端持久化（依赖 Wave 2）

- [ ] task-07: 前端 stageProfileId useEffect 恢复 + PATCH 存
  - 文件：`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` + `frontend/src/lib/changes.ts` + `frontend/src/lib/api-types.ts`
  - goal：选档案持久化，重进页面/切阶段恢复
  - implementation：①lib/changes.ts 加 `updateStageProfile` → PATCH；②page.tsx useState(null) + useEffect 依赖 [current_stage, stages] 恢复（非 useState initializer）；③handleStageProfileChange（乐观+调 API）；④pnpm gen:types（PATCH 进 api-types.ts）
  - 验收标准：选档案→刷新恢复；切阶段各阶段独立；api-types.ts 含 PATCH 类型
  - 验证：tsc + 浏览器手动
  - constraints：useEffect 非 initializer；gen:types 前确认 node_modules 健康
  - allowed_paths：frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx, frontend/src/lib/changes.ts, frontend/src/lib/api-types.ts
  - depends_on：task-03
  - provides：frontend_profile_persistence[restore, persist]

### Wave 5：验证（依赖全部）

- [ ] task-08: daemon build + 端到端验证
  - 文件：无源码改动（gen:types 已在 task-07）
  - goal：daemon 重建 + 全链路验证
  - implementation：①daemon tsc build + pnpm bundle；②端到端：选档案「Kimi 技术经理」触发 quick → 日志含 system_prompt 文本；③重进页面档案恢复；④不选档案零回归
  - 验收标准：日志含 system_prompt 文本；重进恢复；不选档案无注入
  - 验证：浏览器手动 + grep 日志含「Kimi 驱动」
  - constraints：daemon rebuild 断现有 session 可接受
  - allowed_paths：无（验证型）
  - depends_on：task-01~07 全部

## 依赖关系图

```
Wave1: task-01 ─→ task-02
Wave2: task-03 (独立)
Wave3: task-02 ─→ task-04 ─→ task-05 ─→ task-06 (串行)
Wave4: task-03 ─→ task-07
Wave5: task-01~07 ─→ task-08
```

## 覆盖矩阵（design 文件清单 → task）

| design 文件 | task |
|------|------|
| backend/agent/service.py | task-01 |
| backend/daemon/lease/context.py | task-02 |
| backend/change/router.py + schema.py | task-03 |
| backend/agent/tests/test_dispatch_profile.py + test_dispatch_metadata.py | task-01/02 |
| sillyhub-daemon/src/daemon.ts | task-04 |
| sillyhub-daemon/src/interactive/session-manager.ts | task-05 |
| sillyhub-daemon/src/interactive/claude-sdk-driver.ts | task-06 |
| frontend/[cid]/page.tsx + lib/changes.ts + api-types.ts | task-07 |

（11 文件全覆盖）

## 可行性校验

- ✅ 无循环依赖（task-01→02→04→05→06 线性；task-03→07 线性；task-08 汇聚）
- ✅ 无 DB 迁移（stages JSON 列）
- ✅ 无状态机改动（system_prompt 是 session 启动参数）
- ✅ resume 路径已纳入（task-05，Design Grill 最大缺口）
- ✅ daemon.ts 只 interactive 1 处（task-04，batch 非目标）
- ✅ 前端 useEffect 非 initializer（task-07，Design Grill 修正）
- ✅ Wave 3 内 task-04→05→06 串行标注
- ⚠️ daemon rebuild 会断现有 session（可接受，task-08 验证时）

## 实现路径

→ `sillyspec run execute --change 2026-08-13-profile-system-prompt-injection`
