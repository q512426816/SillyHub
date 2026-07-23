---
id: task-02
title: seed 迁移清单 8→17
title_zh: 202607041000_seed_ppm_permissions 的 PPM_PERMISSIONS 清单扩到 17
author: qinyi
created_at: 2026-07-20 14:58:00
priority: P0
depends_on: []
blocks: [task-05]
requirement_ids: [FR-03]
decision_ids: [D-003]
allowed_paths:
  - backend/migrations/versions/202607041000_seed_ppm_permissions.py
goal: >
  把 202607041000_seed_ppm_permissions.py 的 PPM_PERMISSIONS 种子清单从 8 项扩到 17 项
  （加 9 个新菜单 key），使新环境从头 alembic 时给 platform_admin seed 全部 PPM 菜单 key。
provides: []
expects_from: []
implementation:
  - 读 202607041000_seed_ppm_permissions.py，定位 PPM_PERMISSIONS 清单（当前 8 个菜单 key）。
  - 加 9 个新 key 字符串：ppm:workbench:view/ppm:project-member:read/ppm:project-stakeholder:read/
    ppm:project-plan:read/ppm:plan-node:read/ppm:milestone-detail:read/ppm:problem-list:read/
    ppm:problem-change:read/ppm:task-plan:read。
  - 清单共 17 项（8 旧含 3 悬空 + 9 新）。
  - 不新建迁移（D-003：已部署环境靠 seed_platform_admin_role 启动遍历枚举补种，非本迁移重跑）。
acceptance:
  - PPM_PERMISSIONS 清单 17 项。
  - ruff format/check 通过。
verify:
  - cd backend && uv run ruff check migrations/versions/202607041000_seed_ppm_permissions.py
constraints:
  - 只加 9 新 key，不删旧 8 项。
  - 不动迁移 revision/down_revision/upgrade 结构，仅扩清单内容。
---

## 验收标准

- PPM_PERMISSIONS 清单 17 项
- ruff 通过
