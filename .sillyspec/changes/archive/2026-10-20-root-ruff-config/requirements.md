---
author: flow-machine-draft
created_at: 2026-10-20T00:15:41.286Z
---
# 需求规格（Requirements）— 2026-10-20-root-ruff-config

## 功能需求

### FR-01: 根级 ruff 配置存在且 line-length=100；从仓库根与 backend/ 两个 cwd 对 scripts/backfill_commit_type.py 的 ruff format --check 判定一致（均通过），且对 88<x<=100 行宽探针行两口径判定一致（均不拆）

- 仓库根**必须**存在 ruff 配置文件（`ruff.toml`）且 `line-length = 100`（与 `backend/pyproject.toml [tool.ruff]` 同源）；对 backend/ 子树外的 Python 文件，从仓库根 cwd（pre-commit 钩子执行位）与 backend/ cwd（钩子建议修复命令执行位）两个入口的 `ruff format --check` 裁决**必须**一致（同过或同拦），钩子建议命令修完再提交被再次拦截的双向拉锯**必须**消除。lint select **必须**保持 ruff 默认面（不扩大根级存量 lint 检查，零新增拦截）。

#### 场景：双入口一致裁决

- Given 根级 `ruff.toml`（line-length=100）已入库、`scripts/backfill_commit_type.py` 为现行双口径稳定形态
- When 分别从仓库根与 backend/ 对该文件跑 `ruff format --check`
- Then 两处均通过（现行已是 100-clean）；对临时探针文件中宽度 88<x<=100 的行，两处均判定无需拆行

#### 场景：钩子建议命令修完不再回弹

- Given 根级 py 文件被钩子（根 cwd，100 口径）拦截
- When 操作者按钩子建议 `cd backend && uv run ruff format <文件>` 修复后重新提交
- Then 钩子复检通过（两入口同配置），不再出现「修完再拦」循环

### FR-02: 钩子（根 cwd）对 backend/ 内文件的裁决不受影响（生效配置仍是 backend/pyproject 的行宽 100 与完整 lint select，--show-settings 实证）

- 根级 `ruff.toml` **禁止**改变 backend/ 子树内文件的生效配置：backend 文件的最近配置仍**必须**是 `backend/pyproject.toml [tool.ruff]`（line-length=100 与完整 lint select 分层更近优先，`ruff check --show-settings` 前后对比实证 line_length 恒 100）；frontend / sillyhub-daemon（无 Python 面）**必须**零触碰。

#### 场景：backend 子树分层不变

- Given 根级 `ruff.toml` 入库前后
- When 从仓库根对 `backend/app/modules/translate/chunking.py` 跑 `ruff check --show-settings`
- Then `linter.line_length = 100` 前后一致（backend/pyproject 仍是最先生效配置），backend 全量 lint/format 行为零变化

### FR-03: scripts/ 目录全部 .py 在新口径下 ruff format --check 通过（存量清干净，不给未来提交埋雷）；ruff check 默认规则零新增拦截

- `scripts/` 目录全部 `.py` 文件（实测 5 个：backfill_commit_type / check-assertion-surfaces / migrate_scan_docs / scan-drift-check / test_scan_drift_check）**必须**在 100 行宽口径下 `ruff format --check` 全过；存量清理**必须**为纯格式重排（diff 仅换行/空白类变化，零逻辑改动）；被 pre-commit 闸门与 local.yaml 依赖的两个工具脚本（`check-assertion-surfaces.py`、`scan-drift-check.py`）格式化后**必须**仍正常工作（闸门实跑通过、单测绿）；根级 `ruff check`（默认规则）**必须**零新增拦截。

#### 场景：存量清零 + 工具脚本不回归

- Given `ruff.toml`（100）入库 + 3 个存量文件按 100 口径重排（check-assertion-surfaces / scan-drift-check / test_scan_drift_check）
- When 从仓库根跑 `ruff format --check scripts/` 与 `ruff check scripts/`
- Then format 全过、check 默认规则零告警；`python scripts/check-assertion-surfaces.py` 闸门实跑通过；`test_scan_drift_check.py` 用例全绿

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：配置文件无测试面——验证=双 cwd `ruff format --check` / `ruff check --show-settings` 实测对照（scripts/backfill_commit_type.py 现行文件 + 88<x<=100 探针行临时文件，跑完即删）
FR-02: 不适用：配置分层行为无测试面——验证=入库前后 `--show-settings` 的 `linter.line_length` 对比实证（backend 文件恒 100）
FR-03: scripts/test_scan_drift_check.py「既有用例全绿（纯格式重排零行为变化回归）」+ pre-commit assertion-surfaces 闸门实跑通过（钩子链路在交付提交时由 pre-commit 亲测）
