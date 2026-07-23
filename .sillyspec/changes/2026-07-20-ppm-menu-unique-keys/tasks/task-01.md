---
id: task-01
title: backend 枚举新增 9 个 PPM 菜单 key
title_zh: permissions.py 新增 9 个 PPM 菜单权限枚举成员
author: qinyi
created_at: 2026-07-20 14:58:00
priority: P0
depends_on: []
blocks: [task-04, task-05]
requirement_ids: [FR-01]
decision_ids: [D-001, D-004]
allowed_paths:
  - backend/app/modules/auth/permissions.py
goal: >
  在 backend/app/modules/auth/permissions.py 的 PPM 段新增 9 个枚举成员，使枚举 PPM
  成员 8→17（14 菜单 key + 3 悬空旧 key），总枚举 53→62，每个 PPM 菜单有专属 key。
provides: []
expects_from: []
implementation:
  - 在 permissions.py PPM 段（现有 8 个成员之后）新增 9 个枚举成员，命名参照原系统细分语义：
    PPM_WORKBENCH_VIEW="ppm:workbench:view"、PPM_PROJECT_MEMBER_READ="ppm:project-member:read"、
    PPM_PROJECT_STAKEHOLDER_READ="ppm:project-stakeholder:read"、PPM_PROJECT_PLAN_READ="ppm:project-plan:read"、
    PPM_PLAN_NODE_READ="ppm:plan-node:read"、PPM_MILESTONE_DETAIL_READ="ppm:milestone-detail:read"、
    PPM_PROBLEM_LIST_READ="ppm:problem-list:read"、PPM_PROBLEM_CHANGE_READ="ppm:problem-change:read"、
    PPM_TASK_PLAN_READ="ppm:task-plan:read"。
  - 每个新成员加中文注释（标注对应菜单 + 源 RuoYi 权限语义）。
  - group property 不改（ppm: 前缀已归 PermissionGroup.PPM）。
  - 不删任何现有成员（含将悬空的 PPM_PLAN_READ/PPM_PROBLEM_READ/PPM_TASK_READ，D-002）。
acceptance:
  - Permission 枚举 PPM_* 成员数 = 17（8 旧 + 9 新），总枚举 = 62。
  - 9 个新成员值与 design §5 映射表一致。
  - ruff/mypy 通过，permissions.py 可 import。
verify:
  - cd backend && uv run ruff check app/modules/auth/permissions.py
  - cd backend && uv run python -c "from app.modules.auth.permissions import Permission; n=len([m for m in Permission if m.value.startswith('ppm:')]); assert n==17, n; print('PPM members=17 OK')"
constraints:
  - 只加不删现有 PPM 成员（悬空 3 个保留）。
  - 值严格按 design 映射表，不得自创命名。
---

## 验收标准

- 枚举 PPM 成员 17，总 62
- 9 新成员值正确
- ruff/mypy/import 通过
