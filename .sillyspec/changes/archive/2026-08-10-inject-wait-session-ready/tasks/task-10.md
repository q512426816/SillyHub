---
id: task-10
title: confirm_session_reconnected mark_ready
title_zh: recover 重连确认时标记 ready 双保险
author: WhaleFall
created_at: 2026-08-07 14:32:00
priority: P0
depends_on: [task-05]
blocks: [task-12]
requirement_ids: [FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
expects_from:
  task-05:
    - contract: SessionReadiness
      needs:
        - mark_ready
goal: >
  backend 侧确认 session 重连成功（reconnecting 转 active 翻转）时主动调
  readiness.mark_ready，与 daemon restoreAndReconnect 上报构成双保险，防 recover 后
  inject 等 ready 超时（design Phase 4 与 gap-1）。
implementation:
  - 定位 confirm_session_reconnected（service.py 1206-1261）成功翻转分支，session status 置 active 加 commit 成功加 _publish_session_event 之后、return active 之前
  - 该处调 readiness.mark_ready，SessionReadiness 走 task-05 模块级单例，函数级 lazy import（同 inject_session 风格避开循环导入）
  - 未翻转分支不调，session 为 None 返 rejected、status 非 reconnecting 返当前状态，均不触发 mark_ready
  - 异常路径（commit 或 refresh 抛错 rollback raise）自然 fall through 不执行 mark_ready
acceptance:
  - reconnecting 转 active 成功翻转后调 mark_ready
  - session 不存在（rejected）与非 reconnecting（未翻转）不调 mark_ready
  - commit 失败 rollback 路径不调 mark_ready
  - 不改状态机其它分支，不动 confirm_session_reconnected 既有返回值与 ownership 守卫
  - 单测覆盖三条分支（task-12）
verify:
  - cd backend && ruff check
  - cd backend && python -m pytest
constraints:
  - 仅成功翻转路径调 mark_ready（防 stale ready 污染 task-09 end 与 failed 已 clear 的 session）
  - 与 daemon restoreAndReconnect 上报 ready 互为补集（双保险非互斥），二者都调 mark_ready 幂等（set add 加 event set）
  - 不改 confirm_session_reconnected 状态机与 ownership 守卫与 event 发布顺序
---
