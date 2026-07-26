---
schema_version: 1
doc_type: module-card
module_id: skills
---

# skills

## 定位

平台级「自定义技能」(custom-skills) 的管理后端。负责把管理员编写的 SKILL.md 正文持久化到 ``custom_skills`` 表，并提供 admin CRUD API（``/api/custom-skills``）。

职责边界：
- 只管平台级 skill 库——**不绑定 workspace**，所有工作区共享同一份（设计决策 D-010）。
- 只存 SKILL.md **正文 (content)**；YAML frontmatter 不在 DB，由消费方（agent skills bundle）组装。
- 不负责 skill 的执行或注入；真正下发到 daemon/agent 的工作交由 ``app/modules/agent/skills_bundle_service.py``（把每条 CustomSkill 渲染成 ``<name>/SKILL.md`` 打进 bundle，daemon 启动时拉取）。
- 仅一张表 ``custom_skills``，无跨表关系（D-001 单文件 model）。

## 契约摘要

HTTP（``APIRouter(tags=["custom-skills"])``，挂载见 ``main.py``）：
- ``GET    /api/custom-skills``        → 全量列表，按 ``created_at desc``；**不返回 content**，返回 ``content_preview``（前 120 字符）。
- ``POST   /api/custom-skills``        → 创建，201，返回 detail（含完整 content）。
- ``GET    /api/custom-skills/{id}``   → 详情，含完整 content。
- ``PUT    /api/custom-skills/{id}``   → 部分更新（name/description/content 任一可选）。
- ``DELETE /api/custom-skills/{id}``   → 删除，204。

权限：全部端点要求 ``Permission.SETTINGS_ADMIN``（沿用 settings 子菜单的 admin 权限，``SettingsAdminUser`` 依赖）。注意原 design 文档写的 ``MANAGE_PLATFORM`` 在 Permission 枚举中不存在，task-04 确认改用 ``SETTINGS_ADMIN``（见 router.py 头注 + permissions.py:45）。

错误码（``AppError`` 子类，全局异常处理器统一序列化为 ``{code, message, request_id, details}``）：
- ``skill.not_found`` (404) ``SkillNotFound``
- ``skill.name_invalid`` (422) ``SkillNameInvalid``——字符集或保留前缀非法
- ``skill.name_conflict`` (409) ``SkillNameConflict``——name 已存在

数据模型 ``CustomSkill``（``custom_skills`` 表）字段：``id`` (UUID 主键)、``name`` (String 40, UNIQUE, NOT NULL)、``description`` (String 200, NOT NULL)、``content`` (Text, NOT NULL, SKILL.md 正文)、``created_by`` (UUID → users.id, ondelete SET NULL, 可空, 仅审计用)、``created_at`` / ``updated_at`` (带时区 DateTime)。

Schema：``CustomSkillCreate`` / ``CustomSkillUpdate``（部分更新，字段全可选）/ ``CustomSkillRead``（列表项，含 ``content_preview``）/ ``CustomSkillDetail``（继承 Read，加 ``content``）。``CONTENT_PREVIEW_LENGTH = 120``。

## 关键逻辑

- **name 业务校验（service 层, 非 DB）**：正则 ``^[a-z0-9-]{2,40}$`` + 禁保留前缀 ``sillyspec-``（避免和 sillyspec 内置 skill 命名空间冲突）。DB 层只保证 UNIQUE + 长度 40，字符集规则不放 DB（D-002），以便统一返回 422 而非 IntegrityError。
- **创建/更新并发兜底**：service 先 ``_get_by_name`` 预检给友好 409；commit 时再捕 ``IntegrityError``，rollback 后同样转 ``SkillNameConflict``（覆盖预检与 commit 之间被并发插入同名记录的窗口）。更新时仅当 ``name`` 变化才重新校验 + 查重。
- **列表性能**：list 不返回 content（正文可能很长），改返 ``content_preview = content[:120]``，避免前端列表逐条详情请求。
- **被 daemon/agent 消费的链路**（本模块只提供数据源，不直接参与）：
  - ``agent/skills_bundle_service.py::_collect_custom_skills`` 把全部 CustomSkill 按 ``name`` 排序，每条 → ``<name>/SKILL.md``，content 为 DB body 的 utf-8 字节。
  - 与代码库扫描出的 ``sillyspec-*`` 目录合并进同一份 manifest + tar.gz bundle。
  - ``_compute_version`` 用 SHA-256 累积所有文件 (relpath + content)，故 DB skill 的增/删/改都会改变 version hash，daemon 据此重拉（详见该服务注释）。
  - ``session`` 为 ``None`` 时跳过 DB 合并，向后兼容纯代码库扫描调用。

## 注意事项

- 平台级共享：**没有 workspace_id**，新增 workspace 维度时不要在本表加列，应改设计决策 D-010 或另立表。
- ``content`` 存的是 SKILL.md **正文**，不要把 frontmatter 一起写进 DB——frontmatter 由 bundle 服务侧组装，DB 重复存会导致 daemon 侧双份头部。
- ``name`` 字符集与 ``sillyspec-`` 前缀是**业务规则**，迁移/直接写库不会校验；任何写库前的入口（含未来批量导入）都必须走 ``CustomSkillService`` 而非裸 ORM。
- ``created_by`` 仅审计用途，用户被删时 SET NULL（与 ``agent_missions.created_by`` 同风格），不可作为权限判定依据。
- 权限是 ``SETTINGS_ADMIN`` 而非 design 原文的 ``MANAGE_PLATFORM``；若后续调整平台设置类权限，需同步复核 settings/router 与本模块的 ``SettingsAdminUser`` 依赖。
- 本模块**不负责** bundle 打包/version 计算逻辑——变更 daemon 同步行为时去改 ``agent/skills_bundle_service.py``，不要回流到 skills 模块。
