---
id: task-03
title: .github/workflows/scan-drift.yml warn-only CI workflow
title_zh: scan 文档漂移检测 CI workflow（warn-only 上报）
author: qinyi
created_at: 2026-08-06 14:04:48
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - .github/workflows/scan-drift.yml
goal: >
  新增 warn-only CI workflow，scan 文档漂移时 exit 0 + GitHub ::warning 文件注解 + 去重 PR 评论汇总，不阻塞 merge（D-002 方案 A）。
implementation:
  - 新增 .github/workflows/scan-drift.yml，触发 pull_request（paths 含 .sillyspec/docs + backend/frontend/sillyhub-daemon + scripts/scan-drift-check.py）与 push(main)
  - actions/checkout@v4 且 fetch-depth 0（R-04 全历史算 commit 距离）
  - actions/setup-python@v5 配置 Python 3.12
  - run python scripts/scan-drift-check.py（漂移也 exit 0，输出 ::warning 文件注解）
  - 用 actions/github-script 发去重 PR 评论（create-or-update，内容汇总 X 篇落后 / Y 条失效路径，提示重跑 sillyspec scan）
acceptance:
  - 漂移时 exit 0 不 fail job，并打 GitHub ::warning 文件注解（FR-03）
  - 用 actions/github-script create-or-update 发去重 PR 评论汇总
  - checkout 显式 fetch-depth 0（R-04）
  - 不配置为 required status check，不阻塞 PR merge
verify:
  - YAML 语法校验通过（python yaml.safe_load 或 actionlint）
  - grep 确认含 fetch-depth 0 / setup-python 3.12 / scan-drift-check.py 调用 / github-script 去重评论
  - 确认触发 paths 覆盖 .sillyspec/docs + backend/frontend/sillyhub-daemon + 脚本，push 限 main
constraints:
  - warn-only exit 0（D-002 方案 A），不作 required status check，不阻塞 merge
  - checkout 必须 fetch-depth 0（R-04）
  - PR 评论用 actions/github-script create-or-update 去重，避免刷屏
  - 仅 PR（改 docs / 三端源码 / 脚本）与 push(main) 触发，避免无谓 CI 开销
  - CI 跑 ubuntu-latest，无平台特定路径或命令（FR-07，CLAUDE.md 规则 13）
---
