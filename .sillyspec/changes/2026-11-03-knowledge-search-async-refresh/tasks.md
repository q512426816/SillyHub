---
author: qinyi
created_at: 2026-11-03 11:02:30
---
# 任务清单（Tasks）

- [x] task-01: TDD 新契约——先写 FR-01/FR-02 新用例（失配调度零阻塞/drain 后全语义/无索引 building 零写库/在途去重/失败清理可再触发/禁建零调度回归锁），再实现 search.py（`_sync_needed`/`_schedule_background_sync`/`_bg_sync`/注册表/drain helper）与 schema/router `index_sync` 透传；验证=新增用例绿
- [x] task-02: 既有 35 用例适配 drain 模式（首搜断言 index_sync、drain 后断言终态），knowledge 全套件绿；验证=pytest 全绿
- [x] task-03: 前端契约落地——api-types 再生成、lib/knowledge.ts 透传、知识页 index_sync 轻提示文案行；验证=typecheck/lint 绿 + 提示文案在场
