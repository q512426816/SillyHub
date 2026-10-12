---
author: flow-machine-draft
created_at: 2026-10-12T06:12:35.144Z
---
# 提案书（Proposal）— 2026-10-12-spec-backup-keep-forever

## 动机

任务原话转写：动机：2026-10-10 消防项目变更文件（fire-equipment 等）被 30 天修剪机制从服务器备份区清除的风险实测发生（本次靠窗口期找回），用户要求软删备份长期保留、去掉 30 天自动清理。
成功标准：
- 默认配置（spec_backup_retention_days=None）下 _prune_spec_backups 直接返回，永不删除备份区任何目录、不做磁盘扫描
- 配置 spec_backup_retention_days=正整数 N 时恢复原机会式修剪语义（早于 N 天的时间戳目录被清理，逃生门）
- 修剪节流（PRUNE_THROTTLE_INTERVAL_S 600s 冷却）在启用修剪时语义不变（ql-20260924 OOM 防护保留）
- 测试：TestPruneSpecBackups 三例适配设置项注入 + 新增「默认永不修剪」锁死用例，spec_workspace 相关测试全绿
- 跨平台兼容（Windows/Linux/macOS），不新增平台相关 API

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 默认配置（spec_backup_retention_days=None）下 _prune_spec_backups 直接返回，永不删除备份区任何目录、不做磁盘扫描
2. 配置 spec_backup_retention_days=正整数 N 时恢复原机会式修剪语义（早于 N 天的时间戳目录被清理，逃生门）
3. 修剪节流（PRUNE_THROTTLE_INTERVAL_S 600s 冷却）在启用修剪时语义不变（ql-20260924 OOM 防护保留）
4. 测试：TestPruneSpecBackups 三例适配设置项注入 + 新增「默认永不修剪」锁死用例，spec_workspace 相关测试全绿
5. 跨平台兼容（Windows/Linux/macOS），不新增平台相关 API

## 成功标准（可验证）

1. 默认配置（spec_backup_retention_days=None）下 _prune_spec_backups 直接返回，永不删除备份区任何目录、不做磁盘扫描
2. 配置 spec_backup_retention_days=正整数 N 时恢复原机会式修剪语义（早于 N 天的时间戳目录被清理，逃生门）
3. 修剪节流（PRUNE_THROTTLE_INTERVAL_S 600s 冷却）在启用修剪时语义不变（ql-20260924 OOM 防护保留）
4. 测试：TestPruneSpecBackups 三例适配设置项注入 + 新增「默认永不修剪」锁死用例，spec_workspace 相关测试全绿
5. 跨平台兼容（Windows/Linux/macOS），不新增平台相关 API
