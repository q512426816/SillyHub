---
schema_version: 1
doc_type: module-card
module_id: skills
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 自定义技能（skills）

## 定位

**per-user** 自定义技能（CustomSkill）的 CRUD 后端。技能是个人资产：按 `created_by`
强归属、用户间互不可见（D-007 废弃了早期"平台级全局共享"方案 D-010）。DB 只存
SKILL.md **正文 body**，frontmatter 由消费方（agent/skills_bundle_service）拼装；本模
块不负责技能下发/执行。

## 契约摘要

- `GET /api/custom-skills` —— 当前用户列表（不含 content，含 `content_preview` 前 120 字符）
- `POST /api/custom-skills` —— 创建（201，返回含完整 content 的 detail）
- `GET /api/custom-skills/{skill_id}` —— 详情（含完整 content）
- `PUT /api/custom-skills/{skill_id}` —— 部分更新（name/description/content 任选）
- `DELETE /api/custom-skills/{skill_id}` —— 删除（204）
- 权限：任意登录用户（`get_current_user`，D-003）；per-user 隔离在 service 层
- 表 `custom_skills`：`name`（String 40）、`description`（String 200）、`content`（Text
  正文）、`created_by` FK users **NOT NULL + ON DELETE CASCADE**、
  `(created_by, name)` 联合唯一 `uq_custom_skills_created_by_name`（D-002@v2）

## 关键逻辑

```
写路径: _validate_name（业务层）→ 归属校验/查重 → upsert
  name 非法 → SkillNameInvalid 422；同名 → SkillNameConflict 409
  读他人技能 → SkillNotFound 404（与不存在同码，防存在性枚举）
```

- name 业务校验（service 层非 DB）：`^[a-z0-9-]{2,40}$` + 禁保留前缀 `sillyspec-`
  （避免与 sillyspec 内置技能命名空间冲突）；DB 层只管唯一约束 + 长度
- 并发兜底：预检 `_get_by_name` 给友好 409，commit 捕 `IntegrityError` 回滚后同样转
  409（覆盖预检与 commit 之间的并发插入窗口）
- 消费链路（agent/skills_bundle_service.py）：`_build_skill_md` 用 DB name+description
  拼 YAML frontmatter + content 作 body；content 已以 `---` 围栏开头则原样返回不重复
  拼（防双拼 D-003）——Claude 靠 frontmatter 的 description 判断何时触发技能

## 注意事项

- **per-user 是硬约束**：表无 workspace_id 也无全局共享语义，新增共享需求应另立设计，
  不要回退到全局 unique name（D-002@v1 已废弃）
- `content` 存正文不存 frontmatter；用户手写含 frontmatter 的 content 会被 bundle 层
  原样透传（防双拼逻辑兜住），但列表/详情的展示不含拼装结果
- 字符集/前缀是业务规则，直接写库不校验；一切写入必须走 `CustomSkillService`
- `created_by` 是归属键本体（非仅审计字段），用户注销级联删其全部技能
- bundle 打包 / version hash 计算在 agent 模块，改 daemon 同步行为去改
  skills_bundle_service，不回流本模块

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
