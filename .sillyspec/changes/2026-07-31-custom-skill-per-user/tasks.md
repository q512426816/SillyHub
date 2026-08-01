---
author: qinyi
created_at: 2026-07-31 22:27:06
---

# 任务清单（Tasks）

> plan 阶段细化成 Wave + Task 卡片。此处先列任务项（含 Design Grill 6 项 gap 落点）。

## Wave 1 — 数据模型 + 迁移
- [ ] T1.1 CustomSkill.created_by 改 NOT NULL + ON DELETE CASCADE（model.py）
- [ ] T1.2 name 列级 `unique=True` → `(created_by, name)` 联合唯一（model.py，注意 Grill gap#1：现有是列级约束）
- [ ] T1.3 Alembic 迁移：DELETE 清空 → 删旧 name 列级唯一 → 加 created_by NOT NULL → 加联合唯一（顺序：清空才能加 NOT NULL，Grill gap#2）
- [ ] T1.4 迁移 downgrade 声明（DELETE 不可逆，downgrade 返回空表/报错，Grill gap#4）

## Wave 2 — 后端：权限 + 隔离 + daemon 同步
- [ ] T2.1 custom-skills router 权限 SettingsAdminUser → 任意登录用户（复用 get_current_user）
- [ ] T2.2 service.list_(user_id) 加 where created_by == user_id
- [ ] T2.3 service.get/update/delete 加 user_id 归属校验（不符 → SkillNotFound 404）
- [ ] T2.4 service._get_by_name(name, user_id) per-user 查重
- [ ] T2.5 schema CustomSkillRead.created_by 收窄 uuid.UUID（排查前端 null 默认，Grill gap#5）
- [ ] T2.6 daemon router manifest/bundle 端点去 del user，透传 user.id
- [ ] T2.7 skills_bundle_service build_skills_manifest/build_skills_bundle 加 user_id 参数
- [ ] T2.8 _collect_custom_skills 加 where created_by == user_id

## Wave 3 — 前端
- [ ] T3.1 menu-permissions.ts 技能管理菜单放开（所有登录用户可见）
- [ ] T3.2 settings/skills/page.tsx 按钮 is_platform_admin → 登录即可
- [ ] T3.3 lib/custom-skills.ts CustomSkillRead.created_by 类型收窄

## Wave 4 — 测试
- [ ] T4.1 后端：per-user 隔离（A 看不到 B 的）
- [ ] T4.2 后端：跨用户同名 create（A 建 x，B 建 x 不报 409，Grill gap#3）
- [ ] T4.3 后端：越权 update/delete → 404
- [ ] T4.4 后端：权限放宽（登录用户可 CRUD，非管理员可操作）
- [ ] T4.5 后端：manifest 按 user 过滤（test_skills_bundle）
- [ ] T4.6 前端：按钮权限（登录可见）+ per-user 列表
