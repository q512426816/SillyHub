# 决策知识 — scripts

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-scripts-001@v1 2026-10-20-backfill-dryrun-log-scrub——落地 2026-10-20 24 小时风险审查的两条高置信中危处置。
状态：implemented
变更：2026-10-20-backfill-dryrun-log-scrub
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-20-backfill-dryrun-log-scrub/design.md
文件：scripts/backfill_commit_type.py, sillyhub-daemon/src/interactive/zcode-app-server-driver.ts
最近确认：未记录
理由：落地 2026-10-20 24 小时风险审查的两条高置信中危处置。① `scripts/backfill_commit_type.py` 参数面翻方向：opt-in 的 `--dry-run` 改为缺省 dry-run + `--apply` 落盘开关 + `--apply` 必须带 `--yes` 确认门（本脚本每次运行都是全仓扫描写、无更窄定向面，故门作用于 `--apply` 本身）——与同仓 `backend/scripts/backfill_change_titles.py` 既有口径逐项对齐，消除"两个回填脚本缺省方向相反"的误用陷阱；`write_commit_type` 写入逻辑（原位替换/追加/新建、CRLF 保留、幂等）一行不动。② `sillyhub-daemon/src/interactive/zcode-app-server-driver.ts` 移除 :183-185 真机诊断 spawn 参数 `console.log`（cmd/args/cwd 明文未脱敏）；相邻 :187 env 键日志值已走 `redactEnvValueForLog` 脱敏且对 provider 路由排障有持续价值，保留。纯日志删除，无行为变化。

## D-scripts-002@v1 2026-10-20-root-ruff-config——2026-10-20-backfill-dryrun-log-scrub 实证的缺口：pre-commit `ruff-format` 钩子在仓库根 cwd 执
状态：implemented
变更：2026-10-20-root-ruff-config
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-20-root-ruff-config/design.md
文件：ruff.toml, scripts/check-assertion-surfaces.py, scripts/scan-drift-check.py, scripts/test_scan_drift_check.py
最近确认：未记录
理由：2026-10-20-backfill-dryrun-log-scrub 实证的缺口：pre-commit `ruff-format` 钩子在仓库根 cwd 执行，对 backend/ 子树外 Python 文件按 ruff 默认行宽 88 裁决；而钩子拦截时建议的修复命令在 backend/ cwd 执行——ruff 对 cwd 子树外文件回退到 cwd 最近配置（backend/pyproject 的 100）——两口径对根级 `scripts/*.py` 互相拆台（按建议修完再提交被再拦）。方案：仓库根新增 `ruff.toml`，`line-length = 100` 锚定与 backend 同源行宽，使两个入口对根级文件解析到同一行宽（根 cwd 命中根 ruff.toml；backend cwd 的 fallback 也是 100，数值同源），拉锯消除；lint select 不配置（保持 ruff 默认面，根级存量 lint 零新增拦截）。配套把 3 个存量 scripts 文件清到 100 口径 format-clean（纯格式重排），不给未来提交埋雷。配置解析规则经 `ruff check --show-settings` 三点实测定论：文件在 cwd 子树内按文件路径最近配置（backend 文件在根 cwd 下仍 100）；子树外文件回退 cwd 最近配置（scripts 文件在 backend cwd 下 100）——根 ruff.toml 不影响 backend 子树（backend/pyproject 分层更近优先）。
