---
author: flow-machine-draft
created_at: 2026-10-12T07:50:59.896Z
---
# 提案书（Proposal）— 2026-10-12-spec-backup-retention-validation

## 动机

任务原话转写：动机：上变更评审 P3-1——spec_backup_retention_days 无正数校验，env 误配 0/负数会把 cutoff 推到当前时刻之后，软删触发修剪时全删时间戳备份目录（恰为用户明令禁止的后果）；P3-4——默认 None 早退后 FileNotFoundError 容错分支失去测试锁定。
成功标准：
- spec_backup_retention_days 配 0 或负数时启动期（Settings 构造）fail-fast 拒绝（ValidationError）
- None 与正整数仍合法，既有测试零回归
- 新增用例：启用修剪（注入 30）时备份区根不存在 → 静默容错不抛（FileNotFoundError 分支恢复锁定）
- 相关测试全绿，ruff/mypy 过

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. spec_backup_retention_days 配 0 或负数时启动期（Settings 构造）fail-fast 拒绝（ValidationError）
2. None 与正整数仍合法，既有测试零回归
3. 新增用例：启用修剪（注入 30）时备份区根不存在 → 静默容错不抛（FileNotFoundError 分支恢复锁定）
4. 相关测试全绿，ruff/mypy 过

## 成功标准（可验证）

1. spec_backup_retention_days 配 0 或负数时启动期（Settings 构造）fail-fast 拒绝（ValidationError）
2. None 与正整数仍合法，既有测试零回归
3. 新增用例：启用修剪（注入 30）时备份区根不存在 → 静默容错不抛（FileNotFoundError 分支恢复锁定）
4. 相关测试全绿，ruff/mypy 过
