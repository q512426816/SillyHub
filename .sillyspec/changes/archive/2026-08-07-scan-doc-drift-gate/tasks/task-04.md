---
id: task-04
title: .sillyspec/local.yaml 加 scan:check 命令别名 + 收尾自测
title_zh: local.yaml 加 scan:check 别名并收尾自测
author: qinyi
created_at: 2026-08-06 14:04:48
priority: P1
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-06]
decision_ids: []
allowed_paths:
  - .sillyspec/local.yaml
goal: >
  在 .sillyspec/local.yaml 的 commands 块新增 scan:check 别名指向 python scripts/scan-drift-check.py，并在 task-01 刷新 scan 文档 + task-02 脚本就绪后于仓库根跑收尾自测，确认 scan 文档集 0 漂移，收尾本 change 端到端验收。
implementation:
  - 在 .sillyspec/local.yaml 的 commands 块（与既有 build/test/lint 同级 2 空格缩进）新增一行 scan:check 别名，值为 python scripts/scan-drift-check.py
  - 收尾自测在 task-01 刷新 scan 文档 + task-02 脚本就绪后，仓库根跑 python scripts/scan-drift-check.py，确认 scan 文档集输出 0 漂移
acceptance:
  - local.yaml 的 commands 块含 scan:check 别名指向 python scripts/scan-drift-check.py（FR-06）
  - 收尾自测 python scripts/scan-drift-check.py 在 task-01 刷新后 scan 文档集输出 0 漂移（AC-05）
verify:
  - python scripts/scan-drift-check.py
  - grep 确认 local.yaml 含 scan:check 行
constraints:
  - scan:check 命令值为 python scripts/scan-drift-check.py（仓库根跑）
  - 收尾自测须在 task-01 刷新 + task-02 脚本就绪后跑（depends_on task-01 task-02）
  - 不改 local.yaml 其它既有命令与配置
  - YAML 缩进与既有 commands 块一致（2 空格）
---
