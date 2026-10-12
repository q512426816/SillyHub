---
author: flow-machine-draft
created_at: 2026-10-12T07:50:59.896Z
---
# 任务注册表（Tasks）— 2026-10-12-spec-backup-retention-validation

- [x] task-01: spec_backup_retention_days 配 0 或负数时启动期（Settings 构造）fail-fast 拒绝（ValidationError）
- [x] task-02: None 与正整数仍合法，既有测试零回归
- [x] task-03: 新增用例：启用修剪（注入 30）时备份区根不存在 → 静默容错不抛（FileNotFoundError 分支恢复锁定）
- [x] task-04: 相关测试全绿，ruff/mypy 过
