---
id: task-12
title: complete_lease terminal-state hook fires webhook delivery in lease service layer (CC-08)
title_zh: lease/service.py::DaemonService.complete_lease 终态钩子触发 webhook（CC-08：service 层非 router）
author: qinyi
created_at: 2026-08-06 13:58:00
priority: P1
depends_on: [task-11]
requirement_ids: [FR-07]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/daemon/lease/service.py
expects_from:
  task-11:
    - contract: WebhookDispatcher
      needs: [deliver, events]
related_tests:
  - path: backend/app/modules/daemon/tests/
    reason: complete_lease 加 webhook 钩子，须验证钩子容错不破坏既有 lease 终态断言
goal: >
  在 backend/app/modules/daemon/lease/service.py 的 LeaseService.complete_lease（plan/design
  沿用旧名 DaemonService.complete_lease）末尾加 webhook 终态钩子：worker run 进入终态
  （completed/failed/killed）时调 task-11 WebhookDispatcher.deliver 投递事件 payload，投递与 lease 终态解耦（G-3 容错：try/except 不冒泡）。
implementation:
  - 钩子 host = lease/service.py::LeaseService.complete_lease（CC-08 service 层非 router.py；真身类 LeaseService，DaemonService.complete_lease 是旧名）；插在 agent_run 终态写定（优先级合并后）+ commit 之后，与 redis publish / mission converge 同段
  - 仅 lease.agent_run_id 非空时触发；event/status 取 AgentRun 终态（completed/failed/killed，对齐 FR-07 + §7.5 生命周期契约），payload 含 workspace_id/mission_id/worker_id/status/timestamp（字段由 task-11 dispatcher 定义）
  - 调 task-11 WebhookDispatcher.deliver；按 events 过滤订阅 + HMAC-SHA256 签名 + 指数退避重试最多 5 次均归 task-11，本 task 不重复实现投递逻辑，只在终态处调 deliver
  - G-3 容错（重点）：整个 webhook 钩子 try/except 包裹 + log.warning，dispatcher 抛错 / 无订阅 / DB 查询失败不得冒泡破坏既有 lease 完成流程；投递失败不翻转 lease/agent_run 终态——风格对齐该方法已有 redis publish / sync_stage_status / mission converge 容错钩子
acceptance:
  - worker run 终态（completed/failed/killed）触发 task-11 WebhookDispatcher.deliver 调用一次，payload 含正确 workspace/mission/worker/status
  - 钩子容错：dispatcher 抛错时只 warn 日志，complete_lease 仍正常返回 lease，既有终态断言（lease.status=completed / agent_run.finished_at）不受影响
  - 无 webhook 订阅（task-11 返无订阅）时静默跳过，不产告警噪音
  - 既有 daemon lease 完成测试全绿（complete_lease 核心逻辑零回归）
verify: cd backend && uv run pytest app/modules/daemon -q --no-cov
constraints:
  - 钩子 host 是 lease/service.py 的 complete_lease（CC-08：service 层非 router.py；真身类名 LeaseService，DaemonService.complete_lease 为 plan/design 沿用的 daemon-service-split 前旧名）
  - worker 进入终态（completed/failed/killed）时触发 webhook 投递（调 task-11 dispatcher.deliver）；HMAC 签名 + 指数退避重试 5 次 + 按 events 过滤订阅归 task-11，本 task 只做"在 complete_lease 终态处调 deliver"
  - G-3 容错：webhook 钩子 non-blocking / fault-tolerant——try/except 包裹 + log.warning，钩子抛错不得冒泡破坏既有 lease 完成流程，投递失败不影响 lease 终态（对齐该方法已有 redis publish / stage callback / mission converge 容错风格）
---
