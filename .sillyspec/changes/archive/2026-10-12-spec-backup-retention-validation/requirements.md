---
author: flow-machine-draft
created_at: 2026-10-12T07:50:59.896Z
---
# 需求规格（Requirements）— 2026-10-12-spec-backup-retention-validation

## 功能需求

### FR-01: spec_backup_retention_days 配 0 或负数时启动期（Settings 构造）fail-fast 拒绝（ValidationError）

- `Settings` 构造时 `spec_backup_retention_days` 为 0 或负整数必须抛 `ValueError`（pydantic ValidationError），禁止进入运行期——误配会在软删触发修剪时令 cutoff 晚于全部时间戳目录而全删备份（上变更评审 P3-1）。

#### 场景：主路径

- Given 环境变量 `SPEC_BACKUP_RETENTION_DAYS=0`（或 `-3`）
- When 实例化 `Settings()`
- Then 抛 `ValueError`，错误信息含字段名与合法取值说明

### FR-02: None 与正整数仍合法，既有测试零回归

- `spec_backup_retention_days` 为缺省 None 或正整数（如 90）时 `Settings` 构造必须成功且取值原样保留；`test_config.py` 既有用例与 spec_workspace 相关测试必须零回归。

#### 场景：主路径

- Given 环境变量未设 / `SPEC_BACKUP_RETENTION_DAYS=90`
- When 实例化 `Settings()`
- Then 取值分别为 None 与 90，不抛错

### FR-03: 新增用例：启用修剪（注入 30）时备份区根不存在 → 静默容错不抛（FileNotFoundError 分支恢复锁定）

- `spec_backup_retention_days=正整数` 且 `backup_root` 目录不存在时，`_prune_spec_backups` 必须静默返回不抛（FileNotFoundError 容错分支）；该分支此前仅由默认 None 早退路径间接覆盖，必须恢复直接测试锁定。

#### 场景：主路径

- Given 注入保留天数 30 且 `backup_root` 指向不存在路径
- When 调用 `_prune_spec_backups`
- Then 不抛异常，静默返回

### FR-04: 相关测试全绿，ruff/mypy 过

- 改动完成后必须满足：`test_config.py` 与 `test_soft_delete_change_dir.py` 本地运行全绿，且四个改动面文件 `ruff check` / `ruff format --check` / `mypy` 全过。

#### 场景：主路径

- Given 代码与测试改完
- When 本地运行上述测试与 lint
- Then 0 failed / 0 error

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/tests/test_config.py「test_spec_backup_retention_days_rejects_non_positive」
FR-02: backend/tests/test_config.py「test_spec_backup_retention_days_accepts_none_and_positive」
FR-03: backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py「test_missing_backup_root_is_noop」
FR-04: 不适用：FR-04 本身即测试/lint 执行门，绑定由 FR-01~03 的用例与 lint 命令承载
