---
schema_version: 1
doc_type: module-card
module_id: skills
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 自定义技能管理（skills）

## 定位
「自定义技能」（CustomSkill）管理模块：用户自己维护的 SKILL.md 正文库，**per-user 隔离**（2026-07-31-custom-skill-per-user 改造；旧的「平台级全局共享」决策已明确废弃，见 model D-007）。本模块只管增删改查 + 持久化；把技能注入 agent 执行环境由 `agent/skills_bundle_service` 按 user_id 取行打包进 bundle，再经 daemon 分发落地——skills 是数据源，bundle 服务 + daemon 是消费方。

## 契约摘要
- 路由（tag=custom-skills，5 端点，任意登录用户即可——`get_current_user`，D-003「技能是个人资产」）：
  - `GET /custom-skills` 列表（不含 content，含 `content_preview` 截断，按 created_at desc）
  - `POST /custom-skills` 创建（201，返回含完整 content）
  - `GET /custom-skills/{id}` 详情（含完整 content）
  - `PUT /custom-skills/{id}` 部分更新（name/description/content 任选）
  - `DELETE /custom-skills/{id}` 删除（204）
- 数据模型（`custom_skills` 表）：
  - `(created_by, name)` 联合唯一（D-002@v2）——每用户内唯一，不同用户可同名
  - `created_by` NOT NULL + FK ON DELETE CASCADE：用户注销级联删其全部技能（D-001）
  - DB 只管 name 长度 40 与唯一性；字符集规则不在 DB 约束里
- 错误契约（继承 AppError，全局处理器序列化 `{code, message, request_id, details}`）：
  - `SkillNotFound`（404，`skill.not_found`）
  - `SkillNameInvalid`（422，`skill.name_invalid`）——字符集或保留前缀非法
  - `SkillNameConflict`（409，`skill.name_conflict`）——name 已存在
- `CustomSkillService`：所有方法带 `user_id` 维度——list 按 created_by 过滤；get/update/delete 先校验归属；**越权与不存在走同一 404**，不泄露存在性（防越权枚举）

## 关键逻辑
```
_validate_name: ^[a-z0-9-]{2,40}$ 且禁保留前缀 sillyspec-
  （业务层校验；sillyspec- 是工具自带技能命名空间，禁止用户占用）
create/update: _get_by_name(name, user_id) 预检查 → 友好 409
  → commit 撞 IntegrityError → rollback → 兜底 409（并发双保险）
update 改 name: 仅当 name != skill.name 才触发校验与查重
preview(content): 截断到 CONTENT_PREVIEW_LENGTH（列表用）
```

## 注意事项
- per-user 查重口径：A 改成自己的名字不会被 B 的同名挡（查重限定在本 user 范围内）
- DB 只存 SKILL.md body；YAML frontmatter 由打包层（skills_bundle_service）组装，表里无独立 frontmatter 字段
- 下游注入链路：`agent/skills_bundle_service` 按 `created_by == user_id` 取行 → 每个 CustomSkill 一个 `<name>/SKILL.md`，与代码库 sillyspec-* 技能合并进同一 tar.gz；bundle version hash 含 DB content——编辑/增删即变版本、daemon 重拉
- 排查「技能没生效」要顺着 CustomSkill → bundle version → daemon 分发链路看，不止看本模块
- 该表查询可能经 `session=None` 的纯代码库扫描路径旁路（bundle 构建里 DB 合并是可选的），改表结构时不要假定 bundle 服务永远带 session

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
