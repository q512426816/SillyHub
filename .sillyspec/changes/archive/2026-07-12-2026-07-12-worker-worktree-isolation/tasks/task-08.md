---
id: task-08
title: 三重收敛集成测试（mission 派多 worker → 各独立 worktree → converge 逐个 merge → 冲突主 agent 解决 → 成功清理/失败保留）端到端单测链路
title_zh: per-worker worktree 全链路集成测试
author: qinyi
created_at: 2026-07-13 00:32:41
priority: P1
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: []
allowed_paths:
  - backend/app/modules/agent/tests/test_worktree_integration.py
goal: >
  端到端单测链路验证 per-worker worktree 完整生命周期：多 worker 各独立副本 → commit → converge 逐个 merge → 冲突场景主 agent 解决 → 成功清理/失败保留，覆盖零回归。
implementation:
  - 新建 test_worktree_integration.py（参照既有 mission 测试 mock 模式）
  - 场景1：2 worker mission，各独立 worktree + commit，converge 逐个 merge 成功 → 清理 + patch artifact
  - 场景2：2 worker 改同一文件冲突，主 agent 解决（mock SDK Write），重入 continue 合并成功
  - 场景3：worker 创建失败（git_worktree_add ok=False）→ run failed → 主 agent 补派
  - 场景4：merge 超轮次（R-07）→ git merge --abort + mission needs_manual + 副本保留
acceptance:
  - 4 场景全过
  - single mode / bootstrap mission 既有测试零回归
  - 集成测试不依赖真 daemon（全 mock WS RPC）
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_worktree_integration.py -q
  - cd backend && uv run pytest app/modules/agent/ -q（零回归）
constraints:
  - mock daemon RPC（不依赖真 daemon 部署）
  - P1（集成验证，不阻塞主链路 task-01~07）
  - 真部署 e2e 留 verify/部署阶段（本 task 仅单测链路）
---
