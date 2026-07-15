---
id: task-04
title: "后端 pytest — 聚合分页/6 维筛选/负责人推算/member_count/成员接口 username"
title_zh: 聚合接口与成员账号的后端测试
author: WhaleFall
created_at: 2026-07-15 11:05:37
priority: P0
depends_on: [task-03]
blocks: [task-10]
requirement_ids: [FR-02, FR-03, FR-04]
decision_ids: []
allowed_paths:
  - backend/app/modules/ppm/project/tests/test_member_summary.py
goal: 用 pytest 覆盖聚合接口核心行为与成员接口账号回填，守护后续重构。
implementation:
  - 在 backend/app/modules/ppm/project/tests/test_member_summary.py 新增测试，沿用现有 fixture（db_session/operator）+ pytest-asyncio auto 模式
  - 造项目 + 成员 + users 夹具（先 db_session.add(User(...)) 建用户再建指向它的成员，避免 FK IntegrityError）
  - 断言分页 total/items、6 维筛选各命中、多 PM 取 created_at 最早、无 PM owner_name=None、member_count 计数、成员接口 username 回填（有/无对应用户两种）
acceptance:
  - 覆盖上述全部场景
  - 测试通过
verify:
  - cd backend && pytest app/modules/ppm/project -q
constraints:
  - 只加测试不改产品码
  - 夹具遵循现有 ppm 测试约定；async 测试无需 @pytest.mark.asyncio（auto 模式）
---

# task-04 — 聚合接口与成员账号后端测试

依据 design.md §7.2 推算口径、§10 R-01（负责人推算边界）。PpmProjectMember.user_id 是 users.id 的 NOT NULL FK（model.py:210），造夹具须先建 user。
