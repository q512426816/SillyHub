---
author: flow-machine-draft
created_at: 2026-10-11T04:31:07.280Z
---
# 任务注册表（Tasks）— 2026-10-11-borrow-ctx-metadata-truncate

- [x] task-01: 测试先行：borrow-sandbox-context.test.ts 新增 tech_stack join 超 500 / repo_url 超 500 / 短字段与 500 边界原样 / 并存字段零影响四组用例——旧实现先红
- [x] task-02: 实现 truncateText 共享 helper，techStackText/repo_url/descriptionText 三处统一走 500 截断——用例转绿，description 行为逐字不变
- [x] task-03: 全文件回归 + daemon tsc 零错 + 显式 pathspec 提交（消息带 task-NN）
