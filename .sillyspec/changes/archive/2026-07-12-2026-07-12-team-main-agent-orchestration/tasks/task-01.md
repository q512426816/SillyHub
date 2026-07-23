---
id: task-01
title: apply v1 Wave1+2（mode UI + mode/session_id 透传 + execute stage team toggle）到 main + v1 标停
title_zh: 落地 v1 Wave1+2 作为 v2 复用基础并标停 v1
author: qinyi
created_at: 2026-07-12 13:04:06
priority: P0
depends_on: []
blocks: [task-02]
requirement_ids: []
decision_ids: []
allowed_paths:
  - backend/app/modules/agent/mission_schema.py
  - backend/app/modules/agent/router.py
  - backend/app/modules/change/router.py
  - backend/app/modules/change/schema.py
  - backend/app/modules/change/service.py
  - frontend/src/components/mission-console.tsx
  - frontend/src/lib/agent.ts
  - frontend/src/lib/changes.ts
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
goal: >
  把 v1 worktree（sillyspec/2026-07-12-team-mode-platform-wide）Wave1+2 代码 apply 进 main
  作为 v2 mode UI/透传复用基础，并标停 v1（Wave3-5 转交 v2）。
implementation:
  - 从 v1 worktree 复制 9 源码 + 2 测试（test_team_mode_dispatch / test_dispatch_execute_team_mode）到 main 工作区
  - main 单独 git commit（触发双层 hook：claude mypy+frontend / git ruff，须通过，禁止 --no-verify）
  - 跑 backend agent+change 模块 pytest + frontend mission-console/changes vitest 零回归
  - v1 plan.md/decisions.md 顶部标注 Wave3-5 转交 v2（不走完整 archive，v1 部分完成）
acceptance:
  - main 的 MissionCreateRequest 含 mode/session_id，TransitionRequest 含 team_mode
  - backend agent + change 模块测试全绿
  - frontend mission-console + changes page 测试全绿
  - v1 变更目录标注 superseded-by 2026-07-12-team-main-agent-orchestration
verify:
  - cd backend && uv run pytest app/modules/agent/tests/ app/modules/change/tests/ -q --no-cov
  - cd frontend && pnpm test src/components/mission-console
constraints:
  - 复用 v1 D-003（默认 single）/ D-004（归一 mission），非 v2 新决策（decision_ids 空）
  - worktree 无领先 commit，用 cp 不用 git merge
  - main commit 双层 hook 须通过（CLAUDE.md 规则 10）
  - brownfield：mode=single 零回归（FR-9）
  - v1 不走完整 archive（未端到端验证，部分完成）
---
