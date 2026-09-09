---
author: WhaleFall
created_at: 2026-08-27 15:20:33
doc_type: module-changelog
module_id: ppm
---

# ppm 模块变更索引（sidecar）

- ql-20260909-010-a318 | PPM 列表性能索引批次——data_scope 处置人分支改裸列 4 分支 LIKE（原 concat 表达式前导通配不可索引，非超管问题列表全表扫描×2）+ 五表搜索列 trgm GIN（problem 7 列/problem_change 4/project_maintenance 2/ps_project_plan 2/plan_task 1，迁移 20260909120000）+ audit_user_id btree 补齐（Wave 1 跳过理由过时）+ git_operation_logs(user_id,timestamp) 复合；等价性测试 tests/modules/ppm/test_problem_scope_visibility.py 10 用例锁定
- ql-20260827-014-b9f5 | milestone-details 页面宽度撑满——PageContainer 补 size=full 撤默认 1400 帽（随全站撑满定案，纯样式）
