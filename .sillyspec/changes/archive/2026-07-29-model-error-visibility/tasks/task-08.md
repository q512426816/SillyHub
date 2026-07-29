---
id: task-08
title: frontend normalize.ts 识别 error_detail 生成 error 类日志项
title_zh: 前端 normalize 识别运行错误生成错误日志项
author: qinyi
created_at: 2026-07-29 10:34:02
priority: P0
depends_on: [task-07]
blocks: [task-09, task-10]
requirement_ids: [FR-03, FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/agent-log/normalize.ts
provides:
  - contract: ErrorLogItem
    fields: [type, code, message, retryable, hint, raw]
expects_from:
  task-07:
    - contract: ApiTypesErrorDetail
      needs: [error_detail]
goal: >
  normalize.ts 在 run 有 error_detail 时生成 error 类日志项，修正把 [ASSISTANT] API Error 误判为 assistant 的缺陷。
implementation:
  - normalize.ts 读取 run.error_detail，有值时生成 error 类日志项（type/code/message/retryable/hint/raw）
  - 修正 :352 把所有 ASSISTANT 标记开头归 assistant 的逻辑，API Error 不再误判为助手回复
  - 消费 task-07 gen:types 产出的 api-types.ts 中 error_detail 类型
  - 历史 run 兜底 status=failed 且无 error_detail 时生成「运行失败（无详情）」错误项
acceptance:
  - run 有 error_detail 时 normalize 生成 error 类日志项
  - ASSISTANT 标记的 API Error 行不再误判为 assistant 类
  - 历史 failed run 无 error_detail 时兜底显示「运行失败（无详情）」
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test components/agent-log
constraints:
  - 不实现 RunErrorItem 组件（留 task-09），只生成 error 日志项数据
  - error_detail 缺失时兜底不崩溃（brownfield）
  - NOISE 折叠白名单不含 error_detail 错误项（R-02，回归留 task-11）
---
