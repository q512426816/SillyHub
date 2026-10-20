---
author: flow-machine-draft
created_at: 2026-10-20T00:15:41.286Z
---
# 任务注册表（Tasks）— 2026-10-20-root-ruff-config

- [x] task-01: 新增根级 ruff.toml（line-length=100 + target-version=py312，注释锚定语义）——双 cwd 验证：根/backend 两处对 scripts/backfill_commit_type.py `format --check` 均过；88<x<=100 探针临时文件两处均判不拆（跑完即删）；根 cwd `--show-settings` 对该文件 line_length=100
- [x] task-02: backend 子树零影响实证——根 ruff.toml 入库前后对 backend/app/modules/translate/chunking.py `ruff check --show-settings` 的 `linter.line_length` 恒 100（backend/pyproject 分层更近优先）
- [x] task-03: 存量清理——`uv run ruff format --config 'line-length=100' scripts/check-assertion-surfaces.py scripts/scan-drift-check.py scripts/test_scan_drift_check.py` 纯格式重排，diff 逐行核对仅空白类变化；`python scripts/check-assertion-surfaces.py` 闸门实跑过；test_scan_drift_check.py 用例绿；根 cwd `ruff format --check scripts/` 全过 + `ruff check scripts/` 默认规则零告警
