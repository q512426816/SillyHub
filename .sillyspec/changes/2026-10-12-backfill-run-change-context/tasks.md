---
author: flow-machine-draft
created_at: 2026-10-12T07:30:00.000Z
---
# 任务注册表（Tasks）— 2026-10-12-backfill-run-change-context

- [x] task-01: 回填服务 ChangeContextBackfillService（会话游标重放 + 工作区编排）；验证：test_backfill_run_context.py 拆分/游标用例绿
- [x] task-02: 幂等/已锚跳过/未知 key 跳过/无命令不写游标语义；验证：对应四用例绿
- [x] task-03: CLI 脚本 dry-run 默认 + --apply + --workspace；验证：--help 可跑、代码走查事务边界（rollback/commit）
- [x] task-04: 相关测试全绿并按 pathspec 提交；验证：pytest 退出码 0
