---
author: WhaleFall
created_at: 2026-08-27 15:20:33
doc_type: module-changelog
module_id: ppm
---

# ppm 模块变更索引（sidecar）

- ql-20260909-015-5caf | 工作台待办分页有界化——原全量派生（三源各 ≤200 行整实体含 Text 大列）后内存切片，每翻一页（默认 10 条）重跑三源全量；改三源轻量 COUNT（真实 total，替代 200/源截断语义）+合并偏移逐源窗口切片（问题→变更→任务次序不变，无交集源零查询）+列投影（仅 id/名称列）+①②源内 created_at 显式排序保翻页稳定；defect_count 的 now_handle_user 匹配同步改裸列 4 分支 LIKE（原 concat 包裹形态在批1 data_scope 改后已口径失真，现对齐并可用 trgm 索引）；_TODO_SOURCE_LIMIT 随之移除；新增 test_workbench_todos_pagination.py 8 用例（页跨界拼页/真实 total/4 位置计入/干扰行排除/单源用户），ppm 域 30 passed，ruff/mypy 0 错
- ql-20260909-010-a318 | PPM 列表性能索引批次——data_scope 处置人分支改裸列 4 分支 LIKE（原 concat 表达式前导通配不可索引，非超管问题列表全表扫描×2）+ 五表搜索列 trgm GIN（problem 7 列/problem_change 4/project_maintenance 2/ps_project_plan 2/plan_task 1，迁移 20260909120000）+ audit_user_id btree 补齐（Wave 1 跳过理由过时）+ git_operation_logs(user_id,timestamp) 复合；等价性测试 tests/modules/ppm/test_problem_scope_visibility.py 10 用例锁定
- ql-20260827-014-b9f5 | milestone-details 页面宽度撑满——PageContainer 补 size=full 撤默认 1400 帽（随全站撑满定案，纯样式）
