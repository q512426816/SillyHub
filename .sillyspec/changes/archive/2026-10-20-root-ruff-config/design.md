---
author: flow-machine-draft
created_at: 2026-10-20T00:15:41.286Z
---
# 设计记录（Design Record）— 2026-10-20-root-ruff-config

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

2026-10-20-backfill-dryrun-log-scrub 实证的缺口：pre-commit `ruff-format` 钩子在仓库根 cwd 执行，对 backend/ 子树外 Python 文件按 ruff 默认行宽 88 裁决；而钩子拦截时建议的修复命令在 backend/ cwd 执行——ruff 对 cwd 子树外文件回退到 cwd 最近配置（backend/pyproject 的 100）——两口径对根级 `scripts/*.py` 互相拆台（按建议修完再提交被再拦）。方案：仓库根新增 `ruff.toml`，`line-length = 100` 锚定与 backend 同源行宽，使两个入口对根级文件解析到同一行宽（根 cwd 命中根 ruff.toml；backend cwd 的 fallback 也是 100，数值同源），拉锯消除；lint select 不配置（保持 ruff 默认面，根级存量 lint 零新增拦截）。配套把 3 个存量 scripts 文件清到 100 口径 format-clean（纯格式重排），不给未来提交埋雷。配置解析规则经 `ruff check --show-settings` 三点实测定论：文件在 cwd 子树内按文件路径最近配置（backend 文件在根 cwd 下仍 100）；子树外文件回退 cwd 最近配置（scripts 文件在 backend cwd 下 100）——根 ruff.toml 不影响 backend 子树（backend/pyproject 分层更近优先）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增 `ruff.toml`（仓库根）：`line-length = 100` + `target-version = "py312"` + 注释说明锚定语义；无 lint select/ignore（默认面）。
- `scripts/check-assertion-surfaces.py`、`scripts/scan-drift-check.py`、`scripts/test_scan_drift_check.py`：ruff format 100 口径纯格式重排（diff 仅换行/空白类），函数签名/逻辑零变化。
- CLI 行为变化：对根级 py 文件，`ruff format` 的行宽口径从「随 cwd 漂移（88/100）」固定为 100；backend/frontend/sillyhub-daemon 子树零变化（分层实证见做法概述）；钩子建议命令从此与钩子裁决一致。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。配置文件是静态单文件，无事件序；ruff 每次调用独立解析配置，无缓存乱序面。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   `ruff.toml` 为新增文件（无既有写者）；3 个脚本重排是一次性格式化产物（幂等：复跑 format 零 diff），与并行会话无共享写面（不触碰 docs/、src/、并行在途文件）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。旧 clone（无 ruff.toml）行为=现状（默认 88），不破坏任何既有流程；拉取本提交后新口径生效。存量清理与配置同一提交入库，不存在「配置已入、存量未清」的中间态窗口。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。根 ruff.toml 作用域=本仓根子树中「backend 子树外」的 py 文件（分层更近优先，backend/pyproject 仍全权管 backend）；跨仓注册面（cross-repo）无 Python 配置牵连；frontend/daemon 无 Python 面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：格式化 `check-assertion-surfaces.py`（pre-commit assertion-surfaces 闸门脚本）与 `scan-drift-check.py`（local.yaml scan:check 命令）——若重排意外破坏行为会卡全仓提交。缓解：ruff format 是纯空白/换行重排（无 token 变换），交付前闸门实跑 + test_scan_drift_check 用例回归 + diff 逐行核对仅空白类变化。

试过但放弃的方案：① 只改钩子建议文案按路径分流——治标：钩子仍按 88 裁根级文件，与任何手动 backend-cwd format 依旧不一致，且文案分支逻辑要进 pre-commit config 维护；② 根 ruff.toml 配齐 backend 全套 lint select——放弃：会瞬间扩大根级存量 lint 面（UP/SIM/N 等规则对存量 scripts 文件的未知违规），本变更范围膨胀，与「修行宽拉锯」的目标无关；③ 升级 ruff 至支持项目级多配置合并的版本——放弃：工具链版本变更影响面远大于本缺口，且 0.15.14 双入口数值同源后已无矛盾。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| A | ruff.toml | 仓库根 ruff 配置：line-length=100 + target-version=py312，锚定与 backend 同源行宽（注释说明钩子拉锯背景与分层语义） |
| M | scripts/check-assertion-surfaces.py | ruff format 100 口径纯格式重排（pre-commit 闸门脚本，重排后闸门实跑验证） |
| M | scripts/scan-drift-check.py | ruff format 100 口径纯格式重排（local.yaml scan:check 命令脚本） |
| M | scripts/test_scan_drift_check.py | ruff format 100 口径纯格式重排（回归用例随跑验证） |
