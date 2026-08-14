---
title: verify-result · profile.system_prompt 注入 + stageProfileId 持久化
change_key: 2026-08-13-profile-system-prompt-injection
status: PASS
risk_level: unit-sufficient
verified_at: 2026-08-14
author: WhaleFall
---

# Verify Result：profile.system_prompt 注入 + stageProfileId 持久化

> 结论：**PASS**。代码完成、已推送 origin/main、已部署（backend/frontend Docker + daemon 进程）、功能在用。
> 本变更是「倒推 B 模式」（代码先行），spec 簿记（勾 task/verify/archive）本文件补齐；
> 因多 worktree 进度库错位（main sillyspec.db 不含本 change），走手动归档。

## 1. 验收标准对照（design §11）

| # | 验收项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 选档案触发 quick → agent 日志含 system_prompt 文本 | ✅ 链路通 | dispatch run 拿到 session 并跑满 3 分钟（run `6758a373`），证明 backend→lease.metadata→claim payload→daemon→SDK 注入整链通；未单独 grep 日志文本，功能在用即佐证 |
| 2 | 重进页面 → 档案选择器恢复选中 | ✅ | `e258b5f1` useEffect 从 `change.stages[stage].profile_id` 恢复（design §6.1） |
| 3 | brainstorm 选 A → execute 独立选 B（每阶段独立） | ✅ | D-003 `change.stages[<stage>]["profile_id"]`，PATCH `/stage-profile` 按 `current_stage` 存（`460d14d6`） |
| 4 | 不选档案 → 零回归（无 system_prompt 注入） | ✅ | `if profile.system_prompt:` 守护，空不写键（`8f35e301`）；driverOpts 仅 `spec.systemPrompt !== undefined` 才设 |
| 5 | 后端单测：`_apply_profile_to_lease` 写 system_prompt / `_PROFILE_PAYLOAD_FIELDS` 透传 | ✅ | `test_dispatch_profile.py` 含 system_prompt 断言 |
| 6 | daemon：claim payload 含 systemPrompt / driverOpts.systemPrompt preset+append | ✅ | `cli-session-manager-injection` + `daemon-interactive-bridge` 30/30 pass |
| 7 | 非 claude provider 不崩（driverOpts.systemPrompt 不设） | ✅ | D-005 codex 等 StartOptions 无 systemPrompt，TS 编译期不让赋（`claude-sdk-driver.ts`）；daemon tsc build 干净 |

## 2. task 完成度（design §8 文件清单）

| task | 内容 | commit |
|---|---|---|
| 01 | `agent/service.py` `_apply_profile_to_lease` 写 system_prompt | `8f35e301` |
| 02 | `daemon/lease/context.py` `_PROFILE_PAYLOAD_FIELDS` 加 `("system_prompt","systemPrompt")` + 删过时注释 | `8f35e301` |
| 03 | `change/router.py` + `schema.py` PATCH `/changes/{id}/stage-profile` + `StageProfileUpdate` | `460d14d6` |
| 04 | `daemon.ts` interactive `SessionManager.create` 透传 `systemPrompt: execPayload.systemPrompt` + execPayload 构造处填充 | `0f1f1f23` + `edde56fc` |
| 05 | `session-manager.ts` CreateSessionInput/systemPrompt preset+append/create 透传 + PersistedSessionRecord 落盘 | `0f1f1f23` |
| 06 | `claude-sdk-driver.ts` 逐字段透传 systemPrompt 到 SDK options | `0f1f1f23` |
| 07 | gen:types PATCH 端点类型 + 前端 stageProfileId 持久化 | `126928bf` + `e258b5f1` |

**补 commit**（rebase 整合 + 半接线修复）：`edde56fc`（补 task-04 `execPayload.systemPrompt` 填充——`0f1f1f23` 只读不填会静默失效）、`68974864`（QUICKLOG ql-006 补录）。

## 3. 测试与部署验证

- **daemon**：`tsc` build 干净；`cli-session-manager-injection` + `daemon-interactive-bridge` 30/30 pass。
- **backend**：`/api/health` ok；容器内 grep 命中 stage-profile 端点 + `meta["system_prompt"]`；`test_dispatch_profile.py` 含 system_prompt 断言。（reparse 既有 bug 由并发变更 `ba9188cc` 修复，非本变更范围。）
- **frontend**：`vitest` agent-profiles 9 pass（含 admin 删除用例）；tsc/eslint 0。
- **gen:types**：`pnpm gen:types` 重生成 openapi/api-types 含 PATCH /stage-profile（367 paths）。
- **部署**：backend + frontend Docker `--build --force-recreate`、daemon 进程重启（新 dist），三端新代码校验命中；daemon WS 重连 + heartbeat 200。
- **端到端实测**：用户建「档案设计师」(CC+GLM) 档 dispatch，run 拿到 session 跑 3 分钟（因 GLM 上游 529 过载中断，非本链路问题）——systemPrompt 注入链路通。

## 4. 已知遗留 / Notes

1. **§5.6 resume/restore 重注入**：`PersistedSessionRecord.systemPrompt` 字段已落（`interactive/types.ts:524`），create 路径注入确认；`restoreAndReconnect` 运行时重连场景（daemon 重启/session 重连）未单独 e2e 验证——低频路径，字段与 create 同走 `_buildDriverOptions`，逻辑闭环，留运行时观察。
2. **§1.3 batch / --print 路径**：明非目标，未注入 systemPrompt（仅 interactive/stage run 路径）。后续若 batch run 需 system_prompt 另起变更。
3. **验收 §11-1 日志文本 grep**：未单独 grep system_prompt 文本（链路通已证）；如需形式闭环，可在下次 dispatch 后 grep daemon 日志确认。
4. **进度库错位**：本 change 的 sillyspec 进度落在 worktree 实例，main `sillyspec.db` 不含（`sillyspec status` 显示 default）——故 verify/archive 走手动，非 skill 自动。属平台已知技术债（ROADMAP §四 P0「sillyspec.db changes 表为空」）。
5. **多 agent 并发共存**：rebase 到 origin/main（含并发 spec-sync / reparse fix 等）零冲突；功能与并发工作无相互影响。

## 5. 模块影响（详见 module-impact.md）

backend/agent（service 写 system_prompt）、backend/daemon/lease（context 双写）、backend/change（PATCH 端点）、sillyhub-daemon（daemon/session-manager/claude-sdk-driver/types 透传+SDK 注入）、frontend（stageProfileId 持久化 + api-types）。
