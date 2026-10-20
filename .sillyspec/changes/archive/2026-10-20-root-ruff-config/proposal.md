---
author: flow-machine-draft
created_at: 2026-10-20T00:15:41.286Z
---
# 提案书（Proposal）— 2026-10-20-root-ruff-config

## 动机

任务原话转写：根级ruff配置消除钩子行宽拉锯

动机与背景：2026-10-20-backfill-dryrun-log-scrub 实证 pre-commit 的 ruff-format 钩子（仓库根 cwd 执行）对 backend/ 外 Python 文件按 ruff 默认行宽 88 裁决，而拦截时建议的修复命令在 backend/ cwd 执行（backend/pyproject.toml [tool.ruff] line-length=100）——对根级 scripts/*.py 两口径互相拆台，按建议修完再提交会被再次拦截。根治法：根级加 ruff 配置文件锚定与 backend 同源行宽，使任意 cwd/入口对根级文件与 backend 文件都得到一致裁决；lint select 保持默认不扩大根级存量检查面。（选道声明：成功标准转写自 2026-10-20-backfill-dryrun-log-scrub 收口报告的遗留问题段与归档提交信息留档，用户以「继续」确认执行该建议——需求已含决策）

成功标准：
- 根级 ruff 配置存在且 line-length=100；从仓库根与 backend/ 两个 cwd 对 scripts/backfill_commit_type.py 的 ruff format --check 判定一致（均通过），且对 88<x<=100 行宽探针行两口径判定一致（均不拆）
- 钩子（根 cwd）对 backend/ 内文件的裁决不受影响（生效配置仍是 backend/pyproject 的行宽 100 与完整 lint select，--show-settings 实证）
- scripts/ 目录全部 .py 在新口径下 ruff format --check 通过（存量清干净，不给未来提交埋雷）；ruff check 默认规则零新增拦截

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 根级 ruff 配置存在且 line-length=100；从仓库根与 backend/ 两个 cwd 对 scripts/backfill_commit_type.py 的 ruff format --check 判定一致（均通过），且对 88<x<=100 行宽探针行两口径判定一致（均不拆）
2. 钩子（根 cwd）对 backend/ 内文件的裁决不受影响（生效配置仍是 backend/pyproject 的行宽 100 与完整 lint select，--show-settings 实证）
3. scripts/ 目录全部 .py 在新口径下 ruff format --check 通过（存量清干净，不给未来提交埋雷）；ruff check 默认规则零新增拦截

## 成功标准（可验证）

1. 根级 ruff 配置存在且 line-length=100；从仓库根与 backend/ 两个 cwd 对 scripts/backfill_commit_type.py 的 ruff format --check 判定一致（均通过），且对 88<x<=100 行宽探针行两口径判定一致（均不拆）
2. 钩子（根 cwd）对 backend/ 内文件的裁决不受影响（生效配置仍是 backend/pyproject 的行宽 100 与完整 lint select，--show-settings 实证）
3. scripts/ 目录全部 .py 在新口径下 ruff format --check 通过（存量清干净，不给未来提交埋雷）；ruff check 默认规则零新增拦截
