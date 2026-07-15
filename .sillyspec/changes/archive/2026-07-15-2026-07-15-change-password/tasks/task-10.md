---
id: task-10
title: "联调验证（对照 AC-01~09）"
title_zh: 端到端联调验证
author: WhaleFall
created_at: 2026-07-15 11:24:44
priority: P0
depends_on: [task-05, task-09]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08]
allowed_paths:
  - backend/app/modules/auth/router.py
goal: >
  端到端联调验证修改密码全流程，对照 AC-01~09，确认默认密码方案闭环。
implementation:
  - 启动 backend+frontend，登录后进 /account 改密码
  - 验证：改密成功 + 其他设备下线 + 旧密码登录失败 + 审计记录 + 顶栏入口
  - 全量回归：pytest + vitest + ruff + mypy + tsc
acceptance:
  - AC-01~09 全部通过
  - ruff/mypy/tsc/vitest/pytest 全绿
verify:
  - cd backend && uv run pytest
  - cd frontend && pnpm exec tsc --noEmit && pnpm vitest run
constraints:
  - 回归类 task，不改源码（仅验证）
  - 兼容性：不改 login/refresh/logout 既有行为
---

# task-10：端到端联调验证

## 依据
- design.md §9 AC-01~09、§12 兼容与回退
- 依赖 task-05（后端测试 AC-01~07）+ task-09（前端测试 AC-08）已完成

## 实现要点
1. 启动 backend + frontend，用默认密码 `SillyHub@123` 登录，进 `/account` 改密码。
2. 逐条对照 AC-01~09：
   - AC-01 改密成功 → 204，DB `password_hash` 更新
   - AC-02 旧密码错 → 401 `HTTP_401_PASSWORD_INCORRECT`
   - AC-03 新密码 <8 → 422
   - AC-04 未带 token → 401
   - AC-05 旧密码再登录 → 401
   - AC-06 其他设备 refresh → 失败；当前 access_token 30min 内仍可用
   - AC-07 审计表 `action="user.password_change"`，actor=自己
   - AC-08 前端表单校验 + 提交提示 + 旧密码错误展示
   - AC-09 顶栏下拉「个人中心」入口跳 `/account`
3. 全量回归：`pytest` + `vitest run` + `ruff` + `mypy` + `tsc --noEmit`。

## 验收
- AC-01~09 全部通过
- ruff / mypy / tsc / vitest / pytest 全绿

## 约束
- 回归类 task，不改源码（仅验证）；发现问题回退到对应 task 修
- 兼容性：确认 login / refresh / logout 既有行为未被破坏（§12）
