---
author: flow-machine-draft
created_at: 2026-10-12T06:12:35.144Z
---
# 需求规格（Requirements）— 2026-10-12-spec-backup-keep-forever

## 功能需求

### FR-01: 默认配置（spec_backup_retention_days=None）下 _prune_spec_backups 直接返回，永不删除备份区任何目录、不做磁盘扫描

- `_prune_spec_backups` 在设置 `spec_backup_retention_days` 为缺省值 None 时必须立即返回，禁止删除备份区内任何目录，且禁止对备份区执行目录列举（os.scandir 不得触达 backup_root）。

#### 场景：主路径

- Given 备份区存在任意时间戳目录（含远早于 30 天的旧目录）
- When `spec_backup_retention_days=None` 时调用 `SpecWorkspaceService._prune_spec_backups(backup_root)`
- Then 所有目录原样保留，且备份区未被扫描（零 scandir）

### FR-02: 配置 spec_backup_retention_days=正整数 N 时恢复原机会式修剪语义（早于 N 天的时间戳目录被清理，逃生门）

- `spec_backup_retention_days` 配置为正整数 N 时，`_prune_spec_backups` 必须删除早于 N 天且目录名可解析为 `BACKUP_TS_FORMAT` 的备份目录；新鲜目录与非时间戳目录禁止触碰。

#### 场景：主路径

- Given `spec_backup_retention_days=30`，备份区同时存在过期时间戳目录、新鲜时间戳目录、非时间戳目录
- When 调用 `_prune_spec_backups`
- Then 仅过期时间戳目录被删除，其余全部保留

### FR-03: 修剪节流（PRUNE_THROTTLE_INTERVAL_S 600s 冷却）在启用修剪时语义不变（ql-20260924 OOM 防护保留）

- 启用修剪（N 为正整数）时，同一 backup_root 在 `PRUNE_THROTTLE_INTERVAL_S` 冷却窗口内的二次调用必须跳过全量扫描（即使期间又出现新的过期目录）；ql-20260924 OOM 防护语义必须保持。

#### 场景：主路径

- Given `spec_backup_retention_days=30` 且冷却窗口内已执行过一次扫描
- When 冷却窗口内再次调用 `_prune_spec_backups`
- Then 不执行第二次目录扫描，目录保留（机会式修剪语义）

### FR-04: 测试：TestPruneSpecBackups 三例适配设置项注入 + 新增「默认永不修剪」锁死用例，spec_workspace 相关测试全绿

- 测试面必须覆盖：`TestPruneSpecBackups` 三例改为经设置项注入（monkeypatch get_settings 惯例）驱动，新增一条「默认永不修剪」锁死用例；`test_soft_delete_change_dir.py`、`test_full_sync_convergence.py`、`test_sync_incremental.py` 三个相关测试文件必须全绿。

#### 场景：主路径

- Given 代码与测试改完
- When 本地运行三个相关测试文件
- Then 全部用例通过（0 failed）

### FR-05: 跨平台兼容（Windows/Linux/macOS），不新增平台相关 API

- 实现必须只使用 pathlib/os/time/datetime 等跨平台标准库接口，禁止新增 `sys.platform` 平台分支；三个平台行为必须一致。

#### 场景：主路径

- Given 改动仅涉及配置字段与纯标准库逻辑
- When CI 三平台矩阵运行相关测试
- Then 行为一致、无平台相关失败

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py「test_default_retention_never_prunes」
FR-02: backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py「test_deletes_only_dirs_older_than_retention」
FR-03: backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py「test_throttled_second_call_is_noop」
FR-04: backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py「TestPruneSpecBackups 全类 + 三个相关测试文件全量」
FR-05: 不适用：纯标准库无新增平台分支，由上述测试文件在本机与 CI 双平台回归覆盖
