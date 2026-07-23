---
author: qinyi
created_at: 2026-07-07 23:10:00
---

# 2026-07-07-skills-mcp-management-ui 设计文档

## 1. 背景

上一变更 `2026-07-07-daemon-skill-execution` 完成了 skills/MCP 的**后端/daemon 管道**：
- backend `GET /api/daemon/skills/latest/{manifest,bundle}` 分发平台 sillyspec skills
- daemon `skill-manager.ts` 启动同步平台 skills + workspace 自定义 skills
- daemon `mcp-config.ts` 合并平台默认（`~/.sillyhub/daemon/mcp.json`）+ workspace `.mcp.json` + 白名单注入 claude

但该变更 design §3 明确 **YAGNI 掉了 UI**：「不做完整 MCP 市场」。结果：
- 平台 MCP 默认配置/白名单只能手编 daemon 宿主机文件（`~/.sillyhub/daemon/mcp.json`），admin 无法经平台管理
- 自定义 skills 完全无法经平台新增（只能改代码库 `.claude/skills/` 再重新部署）
- 用户看不到 skills 同步状态、不知道哪些 skill 分发给了 daemon

本变更补这一层：**平台 UI 直管自定义 skills（CRUD）+ MCP 平台配置/白名单（CRUD）+ 状态可见**。

## 2. 设计目标

- **自定义 skills 完整 CRUD**：admin 经平台 UI 新增/编辑/删除自定义 skill（name + description + SKILL.md 内容），DB 存储后并入 skills bundle 分发给所有 daemon。
- **MCP 平台配置/白名单 CRUD**：admin 经 UI 编辑平台默认 MCP 配置（JSON 编辑器）+ 白名单（server 名列表），替代手编 daemon 宿主机文件。daemon 启动从 backend 拉取（替代读本地文件）。
- **状态可见**：skills 页展示平台 sillyspec skills 列表 + 同步版本；MCP 页展示当前生效配置。
- **workspace 级查看**：workspace 详情页加 skills/mcp tab，只读查看该 workspace 自定义 skills + `.mcp.json`。
- **secret 脱敏**：MCP 配置 env 里的 token 类字段展示时遮蔽（类 ANTHROPIC_AUTH_TOKEN）。
- **复用现有**：settings 子页模式（api-keys/git-identities）、PlatformSetting key-value 存储、skills bundle 分发链路。

## 3. 非目标

- 不做 MCP 市场（动态安装/版本生态/搜索发现，仍 YAGNI）。
- 不做多文件自定义 skills（v1 只存 SKILL.md 单文件内容；带 helper scripts 的复杂 skill 留后续）。
- 不做 skill 版本管理（自定义 skill 单版本，编辑即覆盖）。
- 不做 per-workspace 自定义 skills 绑定（v1 平台级全共享；workspace tab 只读查看 workspace 自己 specDir 里的 skills）。
- 不做 workspace `.mcp.json` 的平台 UI 编辑（workspace 内容走它自己的变更流/daemon-client spec sync，平台 UI 不直接写，只读查看）。
- 不改 daemon-client 架构、不改 sillyspec skills 内部实现。

## 4. 拆分判断

用户选方案 C 一次性（合一）：skills 管理 + MCP 管理 + 后端端点 + daemon 改造 一个变更。两块共享同一个「平台 UI 直管 daemon 运行时配置」的领域，且都依赖上一变更的 bundle/spec 同步底座，拆开会导致 backend 端点/shared 组件写两次。单 Wave 多 task。

## 5. 总体方案（方案 A：DB 集中 + bundle 合并）

### 5.1 backend（数据模型 + admin 端点 + bundle 合并）

**数据模型**（新建 `app/modules/skills/model.py` 或扩展现有）：
```python
class CustomSkill(BaseModel, table=True):
    __tablename__ = "custom_skills"
    id: uuid.UUID (pk)
    name: str  # 唯一，kebab-case，禁止 sillyspec- 前缀冲突（D-002）
    description: str
    content: str  # SKILL.md body（markdown）
    created_by: uuid.UUID (FK auth.users)
    created_at, updated_at: datetime
```
+ Alembic migration 建表。

**MCP 存储**（复用 PlatformSetting，D-003）：
- key=`mcp.platform_default`，value=JSON `{"mcpServers": {...}}`
- key=`mcp.whitelist`，value=JSON `["server_name_1", ...]`

**admin 端点**（新建 `app/modules/skills/router.py` + 扩展 `settings/router.py`）：
- `GET /api/custom-skills` 列表 / `POST /api/custom-skills` 新增 / `PUT /api/custom-skills/{id}` 编辑 / `DELETE /api/custom-skills/{id}` 删除（admin only，`require_permission(MANAGE_PLATFORM)`）
- `GET|PUT /api/platform-settings/mcp`（平台默认 MCP 配置，admin）
- `GET|PUT /api/platform-settings/mcp-whitelist`（白名单，admin）
- `GET /api/daemon/mcp/config`（daemon 拉，返回 `{platform_default, whitelist}`，D-004）
- `GET /api/workspaces/{id}/skills` + `GET /api/workspaces/{id}/mcp-config`（workspace 只读查看，经 SpecPathResolver 读 specDir）

**bundle 合并**（改 `skills_bundle_service.py`）：
- `build_skills_manifest` / `build_skills_bundle` 在扫描代码库 `sillyspec-*` 目录后，**追加 DB CustomSkill**（每个 → `<name>/SKILL.md` 进 manifest + bundle，name 不带 sillyspec- 前缀也显式包含，不靠 glob）
- 版本 hash 含 DB 自定义内容（任一改动 → 版本变 → daemon 重拉）
- **daemon 重拉触发**：skills 变更靠 daemon 启动 + manifest 版本比对自动重拉（已有）；MCP 配置变更 daemon 不自动感知（无版本比对），admin 改后 **UI 提示「需重启 daemon 生效」**（v1 不做热推送，避免加 WS RPC 复杂度）。

### 5.2 daemon（MCP 配置改 backend 拉 + skill 删除同步清理）

- `mcp-config.ts` 的 `loadPlatformMcpConfig`：从读本地 `~/.sillyhub/daemon/mcp.json` **改为调 `GET /api/daemon/mcp/config`**（仿 skills 同步，D-004）。本地文件作 fallback（offline 时）。
- `skill-manager.ts` 的 `extractSkillsBundle`：解压前**清空目标目录**（当前是覆盖语义，删除自定义 skill 后 daemon 不清理 → 残留）。改「清空 → 解压」保证删除同步。

### 5.3 frontend（2 个 settings 子页 + workspace tab）

- `/settings/skills`：平台 sillyspec skills 只读列表（读 `/api/daemon/skills/latest/manifest`）+ 同步版本展示 + **自定义 skills 表格 CRUD**（新增/编辑弹窗：name + description + markdown 编辑器带预览）。
- `/settings/mcp`：**JSON 编辑器**（编辑 `mcp.platform_default`，schema 校验 + env secret 遮蔽展示）+ **白名单编辑器**（server 名 list，增删）+ 保存。
- workspace 详情页加 `skills` tab + `mcp` tab（只读：`GET /api/workspaces/{id}/skills` + `/mcp-config`）。

### 5.4 权限 + 安全

- 自定义 skills CRUD / MCP 平台配置 / 白名单 = **platform admin only**（`require_permission(MANAGE_PLATFORM)`，D-005）。
- skills 列表查看 / workspace 查看 = 登录用户（workspace 需 membership）。
- MCP env secret 展示遮蔽（D-008）：前端展示 `mcpServers.*.env.*` 的 token 类 key 时遮蔽；后端 `GET /api/daemon/mcp/config` 返回原始值（daemon 需要真实值），admin 查看 endpoint 返回遮蔽值。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | backend/app/modules/skills/model.py | CustomSkill 表 |
| 新增 | backend/app/modules/skills/router.py | admin CRUD 端点 + workspace 查看端点 |
| 新增 | backend/app/modules/skills/service.py | CRUD 业务逻辑 |
| 新增 | backend/migrations/versions/xxxx_add_custom_skills.py | Alembic 建表 |
| 修改 | backend/app/modules/settings/router.py | MCP 平台配置 + 白名单 GET/PUT |
| 修改 | backend/app/modules/agent/skills_bundle_service.py | 合并 DB CustomSkill 进 manifest/bundle |
| 修改 | backend/app/main.py | 注册 skills router |
| 修改 | sillyhub-daemon/src/mcp-config.ts | loadPlatformMcpConfig 改调 backend 端点 |
| 修改 | sillyhub-daemon/src/skill-manager.ts | extractSkillsBundle 清空后解压（删除同步） |
| 新增 | frontend/src/app/(dashboard)/settings/skills/page.tsx | skills 管理页 |
| 新增 | frontend/src/app/(dashboard)/settings/mcp/page.tsx | MCP 管理页 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/... | workspace 详情加 skills/mcp tab |
| 新增 | frontend/src/lib/skills.ts + mcp-config.ts | API hooks |
| 新增 | backend/app/modules/skills/tests/ + frontend 测试 | 单测 |

## 7. 接口定义

### CustomSkill CRUD
```
GET    /api/custom-skills                  → [{id, name, description, content_preview, updated_at}]
POST   /api/custom-skills                  {name, description, content} → 201
GET    /api/custom-skills/{id}             → {id, name, description, content, ...}
PUT    /api/custom-skills/{id}             {name?, description?, content?} → 200
DELETE /api/custom-skills/{id}             → 204
```

### MCP 平台配置 / 白名单
```
GET /api/platform-settings/mcp             → {mcpServers: {...}}（env 遮蔽）
PUT /api/platform-settings/mcp             {mcpServers: {...}} → 200
GET /api/platform-settings/mcp-whitelist   → ["server_name", ...]
PUT /api/platform-settings/mcp-whitelist   ["server_name", ...] → 200
```

### daemon 拉取 + workspace 查看
```
GET /api/daemon/mcp/config                 → {platform_default: {mcpServers}, whitelist: [...]}（原始值，daemon 用；认证=daemon token，同 /api/daemon/skills/latest/* 端点）
GET /api/workspaces/{id}/skills            → [{name, files: [...]}]（只读）
GET /api/workspaces/{id}/mcp-config        → {mcpServers: {...}}（只读）
```

## 8. 决策

- **D-001@V1**：自定义 skills 存储 = DB 单文件（name+description+SKILL.md content）。trade-off：多文件 skill 不支持 vs 简化管理/分发——选单文件（覆盖 90% SKILL.md-centric 场景，多文件留后续）。
- **D-002@V1**：同名冲突 = 自定义 skill 禁止用 `sillyspec-` 前缀 + 全局 name unique（后端校验，合法字符 `[a-z0-9-]`，2-40 字符）。平台代码库 skills 保留独立命名空间。
- **D-003@V1**：MCP 平台配置/白名单存 PlatformSetting（key-value，JSON value），复用现有 settings 模式，不新建表。
- **D-004@V1**：MCP 配置传 daemon = backend 端点 `GET /api/daemon/mcp/config`，daemon 启动拉（仿 skills 同步）替代读本地文件。本地 `~/.sillyhub/daemon/mcp.json` 作 offline fallback。
- **D-005@V1**：权限 = CRUD admin only（`MANAGE_PLATFORM`）；列表/workspace 查看 = 登录用户（workspace 加 membership）。
- **D-006@V1**：workspace skills/.mcp.json 查看 = 经 SpecPathResolver 读 specDir，只读，平台 UI 不写（workspace 内容走自己的变更流）。
- **D-007@V1**：自定义 skill 编辑 UX = markdown 编辑器 + 预览（复用现有 markdown 编辑组件，如 change doc 编辑器）。
- **D-008@V1**：MCP env secret 脱敏 = 前端展示 + admin GET 返回遮蔽；daemon GET 返回原值。token 类 key 名（含 token/key/secret/password）遮蔽。
- **D-009@V1**：MCP JSON 校验 = pydantic 后端（`McpServersSchema`）+ zod 前端双校验。结构 `{mcpServers: {name: {command: str, args: [str], env?: {k:v}}}}`。
- **D-010@V1**：自定义 skills 范围 = 平台级全共享 v1（所有 daemon/ workspace 共享同一份），不做 per-workspace 绑定。

## 9. 风险

- **Alembic migration 链冲突**：多活跃变更可能并发加 migration，revision id 撞 + down_revision 分叉。本变更新建 CustomSkill 表，migration 用唯一 revision + down 接当前 head（参考记忆 migration-chain-fragmentation-pattern）。
- **bundle 版本稳定性**：DB 自定义 skill 内容进版本 hash，编辑频繁会导致 daemon 频繁重拉。可接受（admin 操作低频）。
- **MCP env secret 泄漏**：daemon GET 返回原值，若被前端误用会泄漏。需保证 admin GET（遮蔽）与 daemon GET（原值）端点分离 + 权限校验。
- **daemon 改造的点状风险**：`extractSkillsBundle` 改「清空后解压」若清空失败/解压中断会丢已装 skills。需确保清空+解压原子性（先解压到 tmp，成功后 rename）。
- **workspace specDir 可达性**：workspace skills/.mcp.json 读 specDir，daemon-client 模式 specDir 在 daemon 宿主，backend 容器不可达 → 经 HostFsDelegate RPC 读（复用上一变更的 host_fs 端点）。

## 10. 自审

**完整性**：覆盖用户「skills + MCP 完整管理」需求（自定义 skills CRUD + MCP 平台配置/白名单 CRUD + workspace 查看）。方案 A 全链路通（DB → bundle 合并 → daemon 拉 → claude 用）。

**正确性**：基于上一变更已验证的底座（skills bundle 分发 + mcp-config 合并逻辑），本变更主要是「加 UI + 加 DB + 改数据源」。关键假设（daemon 能拉 MCP config 端点）依赖 D-004 实现。

**风险**：migration 链 + secret 泄漏 + daemon 解压原子性 是主要风险项，已列缓解措施。

**遗漏检查**：secret 脱敏（D-008）、删除同步（daemon 清空）、daemon-client specDir 可达（HostFsDelegate）三个边界已覆盖。workspace `.mcp.json` UI 编辑明确排除（非目标）。
