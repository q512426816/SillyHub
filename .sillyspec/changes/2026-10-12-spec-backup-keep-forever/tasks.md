---
author: flow-machine-draft
created_at: 2026-10-12T06:12:35.144Z
---
# 任务注册表（Tasks）— 2026-10-12-spec-backup-keep-forever

- [x] task-01: config.py Settings 新增 `spec_backup_retention_days: int | None = None` 字段；service.py `_prune_spec_backups` 头部读设置，None 在节流记账前直接 return（零扫描零删除）——验证：test_soft_delete_change_dir.py「test_default_retention_never_prunes」绿（断言过期目录保留 + scandir 零触达）
- [x] task-02: retention=正整数 N 恢复原机会式修剪语义（删 SPEC_BACKUP_RETENTION_DAYS 常量，cutoff 改读设置）——验证：「test_deletes_only_dirs_older_than_retention」（单测级）+ test_sync_incremental.py「test_old_backup_dir_pruned」（API 级，注入 30 天）绿
- [x] task-03: 启用修剪时节流语义不变（_prune_lock + PRUNE_THROTTLE_INTERVAL_S 原样保留，仅 None 路径在记账前早退）——验证：「test_throttled_second_call_is_noop」绿
- [x] task-04: 测试适配（TestPruneSpecBackups 三例改 _patch_retention_days 注入 + 新增默认永不修剪锁死用例 + 文件尾计数注释同步）——验证：三个相关文件 `pytest -q --no-cov` 54 passed / 1 skipped（skip 为 Windows symlink 权限既有用例），日志 .sillyspec/.runtime/logs/spec-backup-keep-forever-tests.log
- [x] task-05: 跨平台：仅 pathlib/os/time 标准库、无新增 sys.platform 分支——验证：ruff check + format --check + mypy 对四个改动文件全过
