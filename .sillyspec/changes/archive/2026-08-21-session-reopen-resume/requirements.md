---
author: qinyi
created_at: 2026-08-21 11:37:05
change: 2026-08-21-session-reopen-resume
---

# 需求（Requirements）— 打通会话重新开启（reopen）链路

## 功能需求

- FR-01（resume key 落库·增量）：daemon 消息上报处理链路（`run_sync` submit_messages）中，当 run 挂有交互会话 FK 且消息携带 SDK 会话 id 时，以**最新值覆盖**写 `AgentSession.agent_session_id`；batch run（FK 为空）跳过；与消息落库同事务。
- FR-02（resume key 落库·存量）：提供 Alembic 数据迁移，对 `agent_session_id IS NULL` 且 provider ∈ {claude, codex} 且未软删的存量会话，取最后一轮 run 的 `session_id` 回填；downgrade 为 no-op。
- FR-03（恢复成功确认）：daemon `_routeSessionResume` 恢复成功后调用 `confirm-reconnected`；调用必须真实发出（runtimeId 从 SESSION_RESUME payload 显式供给，不得依赖仅 recover 链路填充的内存映射——F1）；后端将 `reconnecting → active`。
- FR-04（恢复失败收敛）：恢复失败（含 `SessionAlreadyExistsError`，其发生在进入 try 之前）调用 `mark-recovery-failed`，后端置 `failed`（可再次 reopen）；**保留既有"非 ended/failed → failed"翻转语义**（async-fail 桥接 daemon.ts:1340-1389 依赖，不得收窄为 reconnecting-only）。
- FR-05（陈旧确认防误翻）：confirm-reconnected / mark-recovery-failed 请求体新增**可选** `lease_id`；提供且与当前 lease 不匹配时幂等跳过不翻转；未提供时行为与现状完全一致（recover 链路兼容）。
- FR-06（手动重试窗口）：`reconnecting` 且 `last_active_at` 距今 > 180s 的会话允许再次 reopen（旧挂起 lease 置 cancelled，新建 lease 旋转 token 重发 SESSION_RESUME）；窗口内维持 409。
- FR-07（自动巡检收敛）：后端常驻巡检协程（60s 周期）将 `reconnecting` 且 `last_active_at` 超时 > 180s 的会话置 `failed`、挂起 lease 置 `cancelled`；条件更新幂等。
- FR-08（scan 会话排除）：`cwd` 为空的会话 reopen 时返回 409 专用错误（中文文案），不再放行到 daemon 才失败。
- FR-09（前端入口）：会话详情在 reconnecting 本地计时 > 240s（比后端窗口多 60s 缓冲）仍未 active 时，显示与 ended/failed 相同的"重新开启"入口；后端 409 提示文案中文化。

## 非功能需求

- NFR-01：全部改动不引入新表/新端点/新 WS 消息类型；唯一 schema 变更为既有请求体加可选 `lease_id`（OpenAPI 同步 → `pnpm gen:types` 提交 `api-types.ts` + `openapi.json`）。
- NFR-02：测试覆盖——backend pytest（回含 fork 覆盖与 batch 跳过、confirm/mark-failed 幂等与 lease 绑定、窗口两分支、sweeper 收敛、迁移 up/down、cwd 空 409）、daemon vitest（confirm 真实发出断言防 F1 回归、SessionAlreadyExists 失败分支）、frontend vitest（240s 入口）。
- NFR-03：发版顺序约束写入部署说明：先 backend（兜底先行）后 daemon。
- NFR-04：Windows/Linux/macOS 兼容（巡检协程、迁移 SQL 方言按仓库既有惯例）。

## 验收标准

- 已结束 claude/codex 会话（含迁移覆盖的存量会话）点"重新开启"后可在同一会话继续对话（全链路：reopen → SESSION_RESUME → confirm → active → inject）。
- 人为丢弃 SESSION_RESUME（模拟 WS 丢失）后，180s 内后端自动收敛 failed，用户可再次点"重新开启"。
- 旧版 daemon（不发确认）过渡期无永久卡死。
