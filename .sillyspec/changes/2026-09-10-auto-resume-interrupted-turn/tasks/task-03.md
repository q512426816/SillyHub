---
id: task-03
title: 'Wave 3 派发：queue G10 派发时守卫 + origin 解析 + inject 可选参打标 + SessionRunRead metadata 出口 + 队列 UI 语义'
title_zh: 'Wave 3 派发：queue G10 派发时守卫 + origin 解析 + inject 可选参打标 + SessionRunRead metadata 出口 + 队列 UI 语义'
author: 'qinyi'
created_at: 2026-09-10 09:30:00
priority: P0
depends_on: ['task-02']
blocks: ['task-06','task-07']
requirement_ids: ['FR-02','FR-05','FR-03-11']
decision_ids: ['D-002@v2','D-005@v1']
allowed_paths:
  - backend/app/modules/daemon/session/service/queue.py
  - backend/app/modules/daemon/session/service/inject.py
  - backend/app/modules/daemon/router/session_insights.py
  - backend/app/modules/daemon/tests/
target_files:
  - backend/app/modules/daemon/session/service/queue.py
  - backend/app/modules/daemon/session/service/inject.py
  - backend/app/modules/daemon/router/session_insights.py
goal: >
  queue.py dispatch_queued_messages 重放处：origin 以 auto_resume: 前缀命中则 split(':',1) 解析 source_run_id；G10 派发时守卫：source 之后存在更新 run（created_at desc+id tiebreak）则静默删行跳过记 info；否则 inject 调用带可选参 auto_resume_of，inject.py AgentRun 构造点(:580)落 metadata_={'auto_resume_of': str(rid)}（同事务，签名可选参缺省 None 零回归）。API 出口（plan 审查 P0-1）：session_insights.py 的 SessionRunRead（显式字段 DTO :39）加 metadata: dict | None = Field(default=None, validation_alias='metadata_')（照 agent/schema.py:193 群聊先例）——显式 DTO 不自动携带 model 新列，缺此步前端徽标无数据源、gen:types 链断。队列 UI 语义：续跑条目 edit/reorder 409（照 TASK_WAKEUP 先例 queue.py:446-451），delete 允许（=手动取消）。
implementation: >
  queue.py dispatch_queued_messages 重放处：origin 以 auto_resume: 前缀命中则 split(':',1) 解析 source_run_id；G10 派发时守卫：source 之后存在更新 run（created_at desc+id tiebreak）则静默删行跳过记 info；否则 inject 调用带可选参 auto_resume_of，inject.py AgentRun 构造点(:580)落 metadata_={'auto_resume_of': str(rid)}（同事务，签名可选参缺省 None 零回归）。API 出口（plan 审查 P0-1）：session_insights.py 的 SessionRunRead（显式字段 DTO :39）加 metadata: dict | None = Field(default=None, validation_alias='metadata_')（照 agent/schema.py:193 群聊先例）——显式 DTO 不自动携带 model 新列，缺此步前端徽标无数据源、gen:types 链断。队列 UI 语义：续跑条目 edit/reorder 409（照 TASK_WAKEUP 先例 queue.py:446-451），delete 允许（=手动取消）。
acceptance: >
  GET /sessions/{id}/runs 响应含 metadata（auto_resume_of 透传）+ G10 正反（source 后有/无更新 run）+ 打标落库 + 链上限计数用例 + 恢复失败 _fail_pending_queued_messages 收敛续跑条目回归 + edit/reorder 409/delete 允许；既有 queue 测试零回归；ruff/mypy 0。
constraints: >
  见 design.md 对应决策与 NFR；禁止越 allowed_paths 改文件；先例引用以行号锚定；既有测试零回归（NFR-01）。
verify: '验收标准见 acceptance 字段'
---


## 验收标准

GET /sessions/{id}/runs 响应含 metadata（auto_resume_of 透传）+ G10 正反（source 后有/无更新 run）+ 打标落库 + 链上限计数用例 + 恢复失败 _fail_pending_queued_messages 收敛续跑条目回归 + edit/reorder 409/delete 允许；既有 queue 测试零回归；ruff/mypy 0。
