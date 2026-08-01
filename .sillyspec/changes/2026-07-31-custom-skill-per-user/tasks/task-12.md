---
id: task-12
title: 后端测试 权限放宽与 manifest 按 user 过滤
title_zh: 后端测试覆盖登录用户可 CRUD 与 daemon manifest 按 user 过滤
author: qinyi
created_at: 2026-07-31 22:40:05
priority: P1
depends_on: [task-03, task-07]
blocks: []
requirement_ids: [FR-03, FR-06]
decision_ids: []
allowed_paths:
  - backend/app/modules/skills/tests/
  - backend/app/modules/daemon/tests/test_skills_bundle.py
---

## 目标
覆盖两类回归：① 权限放宽后非管理员登录用户可 CRUD 自己的技能（FR-03）；② daemon manifest/bundle 端点按 user 过滤自定义技能（FR-06，user A 的自定义进 manifest，B 的不进，系统 sillyspec-* 保留）。

## 实现要点
- 场景 1（权限放宽，skills/tests/）：`_make_user(admin=False)` 造普通登录用户 → POST/GET/PUT/DELETE 全成功（201/200/204），不再 403（验证 SETTINGS_ADMIN → 登录用户依赖切换生效）。
- 场景 2（manifest 按 user 过滤，daemon/tests/test_skills_bundle.py）：
  - 两个 user 各建一个自定义 skill；调 `GET /api/daemon/skills/latest/manifest`（带 user A 的 token）。
  - 断言 manifest.files 含 A 的自定义 skill 文件、不含 B 的自定义 skill 文件。
  - 断言系统 sillyspec-* 技能仍在 manifest（D-006 不变，文件系统扫描与 user 无关）。
  - manifest 端点测试用 user token 鉴权（task-07 已去掉 `del user`、透传 user.id），断言按 user 过滤而非全局聚合。
- 不改源码，仅加测试；测试隔离用独立 user 避免串扰。

## 验收
- `pytest backend/app/modules/skills/tests/ backend/app/modules/daemon/tests/test_skills_bundle.py` 全绿。
- 权限用例明确断言非管理员可 CRUD（不再 403）。
- manifest 用例明确断言 user 过滤（A 见 A 不见 B，系统技能都在）。
