---
id: task-06
title: skills_bundle_service 加 user_id 过滤（manifest/bundle/_collect_custom_skills）
title_zh: 技能打包服务加 user_id 过滤
author: qinyi
created_at: 2026-07-31 22:41:43
priority: P1
depends_on: [task-01]
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-004, D-006]
allowed_paths:
  - backend/app/modules/agent/skills_bundle_service.py
---

## 目标
让 `build_skills_manifest` / `build_skills_bundle` 按 `user_id` 过滤 DB 自定义技能：每个用户的 AI 只加载系统 sillyspec-* + 自己创建的（D-004 daemon per-user 同步、D-006 系统共享不变）。

## 实现要点
- 现状（skills_bundle_service.py:76-93）：`_collect_custom_skills(session)` 的 `select(CustomSkill).order_by(CustomSkill.name)` **无 where 过滤**，所有用户的自定义技能都会进 manifest（全局共享旧语义）。
- 加参数：`_collect_custom_skills(session, user_id: uuid.UUID | None)`，在 select 上加 `.where(CustomSkill.created_by == user_id)`（user_id 为 None 时返回空列表，向后兼容不依赖 DB 的纯代码库调用）。
- `build_skills_manifest`（:200）与 `build_skills_bundle`（:249）签名加 `user_id: uuid.UUID | None = None`；透传到 `_gather_all_files`（:185），再到 `_collect_custom_skills`。
- import 加 `uuid` 与 `from sqlalchemy import select, and_`（按需）；不传 user_id 时走原行为（无 DB 自定义），保持纯代码库调用兼容。
- 系统 sillyspec-* 文件系统扫描（`_collect_skill_files`、`_gather_all_files` 的 fs_files 段）**完全不动**（D-006 全局只读共享）。
- version hash 自然随 user 内容变化（不同 user → 不同文件集 → 不同 hash），无需额外改 `_compute_version`。

## 验收
- `build_skills_manifest(session=s, user_id=A)` 只返系统技能 + A 的自定义；传 `user_id=B` 时 A 的技能不出现在 files/skills 列表里。
- `build_skills_bundle` 同样按 user 过滤，tar 内只含系统 + 该 user 的 `<name>/SKILL.md`。
- 不传 user_id（None）时不返回任何自定义技能（空自定义，兼容）。
- 系统 sillyspec-* 技能数量与内容不受 user_id 影响。
- mypy 过；现有 `test_skills_bundle` 不破（向后兼容）。
