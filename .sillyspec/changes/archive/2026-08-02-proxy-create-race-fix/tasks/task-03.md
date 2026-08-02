---
id: task-03
title: _apply_parsed 加 owner_id is None 守卫护住 proxy 与 worktree-lease 的 stage
title_zh: _apply_parsed owner_id 守卫
author: qinyi
created_at: 2026-08-02 00:33:30
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/change/service.py
provides: []
expect_from: []
related_tests: []
goal: >
  _apply_parsed 的 current_stage 覆盖条件追加 owner_id is None 判断，仅扫描历史行保留文件推断覆盖，proxy 与 worktree-lease 建行 stage 由 dispatch 或 transition 权威不被覆盖。
implementation:
  - 把 _apply_parsed 覆盖条件改为当 parsed.current_stage 非空 且 row.owner_id 为 None 时才赋值，下一行赋值不变，落点 service.py 第1248行
  - 核实判据成立 _build_change 扫描建行恒 owner_id 为 None，proxy_create_change 与 server-local worktree-lease 分支建行 owner_id 非空落入守卫保护侧
  - 在原注释后补一句说明 owner_id 非空行 stage 由 dispatch 或 transition 权威不再被文件推断覆盖属已承认的语义收紧见 design §9 与 R-03
acceptance:
  - AC-06 _apply_parsed 对 owner_id 非空行不覆盖 current_stage 对 owner_id 为 None 行行为同前仍覆盖
  - AC-08 server-local 的 changes create 的 worktree lease 分支加历史 owner_id 为 None 扫描行无破坏性变化 worktree lease stage 不再被文件推断覆盖语义更对
verify:
  - cd backend 然后 uv run pytest app/modules/change/tests -q --no-cov
constraints:
  - 不改 _apply_parsed 签名 不改 _build_change 的 owner_id 为 None
  - 不加 migration 不动 DB schema 复用 owner_id 既有列
  - worktree lease 行 stage 不再被文件推断覆盖属已承认的语义收紧 design §9 与 R-03 非零回归已登记
---
