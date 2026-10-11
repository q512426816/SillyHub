---
author: flow-machine-draft
created_at: 2026-10-11T03:40:33.352Z
---
# 任务注册表（Tasks）— 2026-10-11-queue-wakeup-origin-guard

- [x] task-01: 测试先行：test_session_queue 既有通知用例改结构化口径（task_wakeup=True），新增前缀伪造占额度/QueueFull 用例与 origin 合并用例——旧实现下伪造用例先红
- [x] task-02: 后端结构化判定：helpers 常量 + queue.py 豁免/计数/合并/编辑守卫改 origin 判定 + inject 链路（inject.py/__init__.py）增 task_wakeup 透传——task-01 用例转绿
- [x] task-03: HTTP 层门控：schema.py origin Literal 字段 + auth_deps.is_service_credential_request + session_crud inject 端点 403/透传；新增 test_inject_origin_guard.py（Bearer 403 / 非法值 422 / API-key 标记落行）先红后绿
- [x] task-04: daemon 链路：hub-client.injectSessionPrompt 增 origin 可选参 + cli.ts 唤醒回调传 'task_wakeup'，daemon tsc 零错
- [x] task-05: 契约重生成与回归收口：pnpm gen:types + dump_openapi 提交；相关面测试全绿 + ruff/mypy 零错；tasks 勾选与提交留痕
