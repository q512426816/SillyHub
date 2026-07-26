---
schema_version: 1
doc_type: module-card
module_id: skills
---

# skills

## 定位

平台级"自定义技能"(CustomSkill)的管理模块。负责管理员在后台维护一份**全平台共享**的 SKILL.md 正文库(不绑定 workspace,所有工作区可见同一份)。

与 daemon 执行态的关系:本模块只管"增删改查 + 持久化";真正把技能注入到 agent 执行环境,是通过 `agent/skills_bundle_service.py` 把 DB 行打包进 sillyspec skills bundle,再由 daemon 端 skill-manager 启动时拉取并解压到 `.claude/skills/`。即 **skills 是数据源,bundle 服务 + daemon 是消费方**。

## 契约摘要

对外是 `/api/custom-skills` 上的 5 个 REST 端点(router tags=`custom-skills`,在 `main.py` 以 `/api` 前缀挂载):

- `GET /custom-skills` → 列表,**不含 content**,含 `content_preview`(前 120 字符),按 `created_at desc`。
- `POST /custom-skills` → 创建,201,返回详情(含完整 content)。
- `GET /custom-skills/{id}` → 详情,含完整 content。
- `PUT /custom-skills/{id}` → 部分更新(name/description/content 任一可选)。
- `DELETE /custom-skills/{id}` → 204。

权限门槛:`SETTINGS_ADMIN`(走 `require_permission_any`)。模块文档注明 design 原文写的 `MANAGE_PLATFORM` 在 `Permission` 枚举里不存在,故沿用 settings 子菜单的 `SETTINGS_ADMIN`,零迁移风险且语义自洽。

错误契约(均继承 `AppError`,由全局异常处理器序列化为 `{code, message, request_id, details}`):
- `SkillNotFound` (404,code `skill.not_found`)
- `SkillNameInvalid` (422,code `skill.name_invalid`)— 字符集或保留前缀非法
- `SkillNameConflict` (409,code `skill.name_conflict`)— name 已存在

## 关键逻辑

**name 校验(业务层,非 DB)**:`^[a-z0-9-]{2,40}$`,且禁保留前缀 `sillyspec-`(避免与 sillyspec 工具自带 skill 命名空间冲突,前端会混淆平台 skill 与工具 skill)。DB 层只保证 UNIQUE + 长度 40,字符集规则不在 DB 约束里。

**unique 冲突双保险**:`create` / `update` 先调 `_get_by_name` 预检查给出友好 409,再在 `commit` 时兜底捕获 `IntegrityError`→回滚→抛 `SkillNameConflict`,覆盖预检查与 commit 之间被并发插入同名记录的场景。

**list 不返 content 的原因**:SKILL.md 正文可能很长,列表只返 `content_preview`(120 字符)避免前端 N+1 详情请求;详情接口才返完整 content。

**写入下游(bundle 注入)**:`agent/skills_bundle_service.py` 在构建 manifest / tar.gz 时:
- 每个 `CustomSkill` 行 → `<name>/SKILL.md`,正文 = `CustomSkill.content` 的 utf-8。
- 与代码库 `sillyspec-*` 目录的文件合并,共同进同一个 tar.gz。
- 内容派生的 version(SHA-256 前缀,含 DB content)→ daemon 端比对版本漂移,DB 行一旦编辑/增删,version 即变,daemon 会重拉 bundle。

daemon 侧通过 `/api/daemon/skills/latest/manifest` 和 `/api/daemon/skills/latest/bundle`(在 daemon router,非本模块)消费这份 bundle,落到 `.claude/skills/`。

## 注意事项

- **平台级共享,非按 workspace 隔离**:无 `workspace_id` 列;改任一 CustomSkill 立即对所有工作区生效(经 daemon 重拉 bundle 后)。删除用户(`created_by`)走 `SET NULL`,保留 skill 审计溯源。
- **DB 只存 SKILL.md body**:YAML frontmatter 由业务层组装,DB 表里没有独立 frontmatter 字段;打包时也只写 `<name>/SKILL.md`。
- **`session=None` 是合法调用路径**:`skills_bundle_service` 里 DB 合并是可选的(纯代码库扫描场景跳过),改 CustomSkill 表结构/字段时不要假定 bundle 服务永远带 session。
- **name 不可改名到 `sillyspec-` 开头**:更新路径同样跑 `_validate_name`,且更新时只有 `name != skill.name` 才触发校验与冲突检查。
- **本模块只做 CRUD**:bundle 打包逻辑在 `agent` 模块,daemon 分发端点在 `daemon` 模块;排查"技能没生效"要顺着 CustomSkill → bundle version → daemon skill-manager 链路看,不止看本模块。
