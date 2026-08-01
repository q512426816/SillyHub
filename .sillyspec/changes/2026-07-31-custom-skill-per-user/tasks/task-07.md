---
id: task-07
title: daemon/router manifest 与 bundle 端点去 del user 透传 user.id
title_zh: daemon manifest 与 bundle 端点透传 user.id
author: qinyi
created_at: 2026-07-31 22:41:43
priority: P1
depends_on: [task-06]
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-004]
allowed_paths:
  - backend/app/modules/daemon/router.py
---

## 目标
daemon 拉 manifest/bundle 时按当前 user 过滤：去掉端点的 `del user`，把 `user.id` 透传给 task-06 加好的 `build_skills_manifest` / `build_skills_bundle`（D-004 透传 user.id，daemon 侧零改动）。

## 实现要点
- 现状（daemon/router.py:2384-2426）：
  - `get_skills_manifest`（:2397）：`del user  # 仅做认证，不使用` → `build_skills_manifest(session=session)`。
  - `get_skills_bundle`（:2416）：`del user  # 仅做认证，不使用` → `build_skills_bundle(session=session)`。
- 删掉两处 `del user` 行，改为 `build_skills_manifest(session=session, user_id=user.id)` / `build_skills_bundle(session=session, user_id=user.id)`。
- `get_current_principal` 已返回带 `.id` 的 User（daemon 走 X-API-Key，`api_keys.user_id` 天然归属 user），无需新认证逻辑（D-004）。
- 端点签名/路径/返回结构不变，仅 manifest/bundle 内容范围从「全局」变「该 user 的」。
- 不动同文件其它端点（如 `/mcp/config`）。

## 验收
- daemon 用 user A 的 API key 拉 `/skills/latest/manifest` → 只含系统 + A 的自定义技能；用 user B 的 key → 只含系统 + B 的。
- bundle 同步按 user 过滤。
- 现有 `test_skills_bundle`（如有断言 del user 后内容的）按新语义更新；端点测试过。
- mypy 过。
