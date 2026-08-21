---
title: 部署说明——session reopen/resume 链路（先 backend 后 daemon）
author: qinyi
created_at: 2026-08-21 13:08:23
change: 2026-08-21-session-reopen-resume
---

# 部署说明（2026-08-21-session-reopen-resume）

## 一、发版顺序：先 backend，后 daemon

**必须先发布 backend，再发布 daemon。**

理由 = 兜底先行：backend 侧的两层兜底先就位，旧 daemon（尚未携带 lease_id 发
confirm）也不会让会话永久卡死——

1. **自动兜底（task-05）**：backend lifespan 常驻巡检协程
   `session_reconnect_sweeper`（周期 60s），把 reconnecting 超时的会话收敛为
   failed、挂起 lease 置 cancelled。
2. **手动兜底（task-04）**：reopen 时 reconnecting 且 `last_active_at` 超
   `RECONNECTING_RETRY_WINDOW_SEC=180`（session/service.py）即放行重开，旧
   挂起 lease cancelled、新建 lease 重发。

backend 先行后，无论 daemon 新旧，reopen 链路都不会出现永久悬挂状态；反之若
先发 daemon，新 daemon 的确认语义在旧 backend 上不被识别，防护窗口失效（见
第三节）。

## 二、旧 daemon 过渡期行为

backend 已新版、daemon 仍是旧版的过渡窗口内：

- 旧 daemon 在 SESSION_RESUME 后**不会**调用
  `confirm-reconnected` / `mark-recovery-failed`（更不会携带 lease_id）。
- 会话停在 reconnecting；180s（`RECONNECTING_RETRY_WINDOW_SEC`）后由 sweeper
  置 failed + 挂起 lease 置 cancelled，会话不会永久卡死。
- 用户侧双保险：前端 reconnecting 本地计时 **>240s** 后出现「重开」入口
  （task-08），用户可再次 reopen；reopen 命中 task-04 的 180s 超时放行分支，
  旧 lease cancelled、新建 lease 重发 SESSION_RESUME。
- 因此过渡期内体验降级（reopen 需等约 3~4 分钟收敛/可重试）但**功能正确**，
  尽快完成 daemon 升级即可恢复正常确认时序。

## 三、回滚注意

- **反序回滚：先回 daemon，再回 backend。** 行为回滚按 plan.md「风险与回退」
  以**单 commit 粒度 git revert**（W1 数据层若出问题仅回填值错误，可重跑迁
  移 `20260821120000_backfill_session_agent_session_id` 修正，不必回滚）。
- **防护失效窗口（新旧错配期）**：若新 daemon 已上线而 backend 仍是旧版，
  新 daemon 确认请求携带的 `lease_id` 在旧 backend 的 `SessionRuntimeRequest`
  schema 下被 pydantic 忽略（多余字段丢弃），系统**退回旧翻转语义**——陈旧
  确认防护（lease_id 不匹配幂等跳过）在该窗口期失效，可能把已被后续 reopen
  翻转的会话误翻回 active。此窗口必须尽量缩短：回滚时先降 daemon，升级时
  backend 就绪后**尽快二次对齐 daemon 版本**。
- 前端无独立回滚要求：reconnecting 超时入口与 409 中文文案映射对旧 backend
  行为兼容（不出现时前端只是不展示入口）。
