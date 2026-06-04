# TASKS.md — fix/spec-data-root-path-resolution

## 问题
SPEC_DATA_ROOT=./data/spec-storage 被 os.path.abspath() 按 CWD=backend/ 解析，
导致 spec_root 写成 backend/data/spec-storage/{ws_id}。
正确应该是 <repo-root>/data/spec-storage/{ws_id}。

## Task 清单

### [ ] Task-01: 新增统一路径解析函数 resolve_spec_data_root()
- 文件: `backend/app/core/paths.py`（新建）
- 逻辑:
  - 绝对路径 → 原样返回
  - 相对路径 → 解析为 `REPO_ROOT / relative_path`
  - REPO_ROOT = `Path(__file__).resolve().parents[2]`（backend/app/core/paths.py → parents[2] = repo root）
- 不要写死本地路径

### [ ] Task-02: config.py 使用 resolve_spec_data_root()
- 文件: `backend/app/core/config.py`
- 添加 validator：spec_data_root 字段在加载时调用 resolve_spec_data_root()
- 或者不改 config.py 的 validator，而是在所有使用 spec_data_root 的地方调用 resolve 函数

### [ ] Task-03: 新增 repair migration 修正已有错误 spec_root
- 文件: `backend/alembic/versions/202606230900_repair_spec_root_paths.py`（新建）
- 逻辑:
  - 读取所有 spec_workspaces 行
  - 对每行 spec_root，检查是否包含 /backend/data/spec-storage
  - 如果是，替换为 <repo-root>/data/spec-storage/{ws_id}
  - repo-root 通过 migration 文件位置推导：Path(__file__).resolve().parents[3]
    (migration 在 backend/alembic/versions/，parents[3] = repo root)
  - 创建新物理目录
  - 幂等：已正确的不动

### [ ] Task-04: 修复 migrate_scan_docs.py 路径解析
- 文件: `scripts/migrate_scan_docs.py`
- 脚本从 DB 读 spec_root（已是绝对路径），不需要额外解析
- 但确保 _PROJECT_ROOT 正确

### [ ] Task-05: 修复旧 backfill migration 的路径解析
- 文件: `backend/alembic/versions/202606220900_backfill_spec_workspaces.py`
- 修改 .env 读取后的 abspath 逻辑，改用 repo-root 相对解析
- parents[2] = backend 目录，parents[3] = repo root

### [ ] Task-06: 补测试
- 文件: `backend/app/core/tests/test_paths.py`（新建）
- 测试 resolve_spec_data_root()：
  - 绝对路径原样返回
  - 相对路径解析到 repo-root 下
  - 从 backend/ CWD 执行也正确
- 测试 repair migration 幂等性

## 验收标准
- DB 中 3 行 spec_root = <repo-root>/data/spec-storage/{ws_id}（不含 /backend/）
- <repo-root>/data/spec-storage/{ws_id} 物理目录存在
- migrate_scan_docs.py 能从 .sillyspec/docs/ 复制到正确 spec_root
- pytest 全量通过
