---
author: flow-machine-draft
created_at: 2026-10-22T08:42:05.082Z
---
# 任务注册表（Tasks）— 2026-10-22-merge-regression-fixes

- [x] task-01: app/modules/daemon/grants/tests/ 62 passed 零 errors（原 48 passed + 14 errors）
- [x] task-02: test_init_claim_tokens.py 两降级用例在任意渲染流下稳定通过（13 passed），全量套件复跑零 failed 零 errors
- [x] task-03: 仅测试面改动（conftest + 断言载体），零生产源码变更，无需重新部署
