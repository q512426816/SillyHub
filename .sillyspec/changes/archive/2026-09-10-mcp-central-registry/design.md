---
author: qinyi
created_at: 2026-09-10 10:19:19
scale: large
---

# 设计文档（Design）— MCP 中央资产库（mcp-central-registry）

## 背景

平台 MCP 配置现状是 settings 表两个 KV（`mcp.platform_default` + `mcp.whitelist`，`backend/app/modules/settings/router.py:160`）：无独立实体、无分组/标签、无导入、无用户私有配置、无注入诊断。用户想复用一个 MCP 定义只能手抄 JSON；带个人 token 的 MCP 无法与平台共享配置共存。

对照 ai-toolbox 调研（`docs/research-ai-toolbox-config-management-2026-09-10.md`）的成熟模式——"中央主数据 + 投影 + 单向推送 + 显式导入"——本变更把 MCP 定义升级为一等资产管理（registry），注入链既有语义保持。配套方案：`docs/proposal-config-management-capability-2026-09-10.md` §3（P0-A）。

## 设计目标

1. **资产沉淀**：MCP server 定义成为一等实体（CRUD/标签/搜索/模板），双层可见性——平台共享库（admin 管理、全员可见）+ 用户私有库（个人 token 不外泄）（D-001）
2. **启用绑定**：独立 McpBinding 表，注入集 = platform binding 全集 ∪ 该用户 user binding（D-002/D-008@v2）
3. **注入链换源**：daemon 拉取端点 `GET /api/daemon/mcp/config` 数据源从 KV 切到 registry 渲染；响应形状不变；端点加可选 `user_id` 支持 per-user 注入集（D-008@v2：daemon 会话级缓存天然适配，改造集中在 claim payload 透传 user_id）
4. **六项能力**（D-004）：CRUD+标签搜索 / JSON 粘贴导入 / workspace 扫描导入（同名去重）/ 注入诊断回显（backend 渲染预检）/ 收藏模板（预置+自存）/ cmd 归一化（去重比对用）
5. **存量零迁移**（D-003）：确认 `mcp.platform_default` KV 无真实数据，直接弃用，不写迁移脚本

## 非目标

- **http/sse 不放行**：`server_type` 建模预留枚举，写路径仅接受 stdio（D-005，防 SSRF 决策 D-017 延续）；放行需独立变更（URL 出网白名单评估）
- **不做 workspace 级绑定**：binding scope 仅 platform/user；workspace 级继续用现有 `.mcp.json`（`workspace/skills_view_service.py` 直读直写），registry 通过扫描导入吸收它，不替代
- **不动 `mcp.whitelist` 治理层**：白名单继续 settings KV，registry 是资产层，两层分离（D-007）
- **不做 MCP server 健康探测/版本检测**（ai-toolbox 的 package_version 类能力）：观察需求后议
- **不迁移 AgentProfile.mcp_refs**：profile 级消费过滤机制已存在（`agent/profile/model.py:133`，daemon `_resolveMainAgentMcp` 消费），与本变更正交——binding 管"池子里有什么"，mcp_refs 管"这个 profile 用池子的哪个子集"
- **不做 daemon 主动推送**（WS 通知刷新缓存）：daemon 会话级缓存每会话重建 + 会话创建拉取已覆盖（D-007 否决项）

## 拆分判断

单一连贯架构变更，不拆 MASTER：数据模型/渲染服务/导入/前端共享同一套 McpServer 实体语义，分开会造成中间态（表建了没端点、端点换了没 UI）。Wave 边界按"后端纵向切片 → daemon 小改 → 前端"切（见总体方案）。无批量模式特征。

## 总体方案

```
┌─ 前端 settings/mcp 管理页 ─────────────────────────────┐
│  平台库 tab（admin 写）/ 我的库 tab / 模板 / 诊断面板       │
└──────────────┬─────────────────────────────────────────┘
               │ REST /api/mcp-servers*
┌──────────────▼─────────────────────────────────────────┐
│  backend/app/modules/mcp_registry/（新模块）              │
│  model.py     McpServer + McpServerBinding + McpTemplate │
│  schema.py / service.py / router.py（标准四件）            │
│  render.py    注入集渲染 + 诊断预检                        │
│  importer.py  JSON 导入 + workspace 扫描 + 去重 + 归一化   │
└──────┬──────────────────────────┬───────────────────────┘
       │                          │
  PostgreSQL                GET /api/daemon/mcp/config
  （encrypted_env 走          （daemon_rpc.py:451 换源 registry 渲染，
   CredentialCipher）          ?user_id= 可选；响应形状不变）
```

**Wave 划分**（plan 阶段细化任务）：

- **W1 数据模型 + CRUD**：三表 + Alembic 迁移 + model/schema/service/router 四件 + 权限矩阵 + 加密读写（encrypted_env ↔ CredentialCipher）
- **W2 渲染 + daemon 端点切源**：render.py（注入集计算 + 解密 + 诊断预检）+ daemon_rpc.py 端点换源（含 user_id 参数与授权校验，见接口定义）+ **user_id 透传链**：backend `daemon/lease/context.py` build_claim_payload 新增 user_id 下发 → daemon execPayload 归一化透传 → 会话创建拉取时带 user_id（D-008@v2 Grill 修正：实际缓存是 daemon.ts 会话级 `Map<sessionId, McpBundle>`，会话天然归属 user，无需改缓存结构）
- **W3 导入 + 模板 + 归一化**：importer.py（JSON 三种包装解析 / workspace 扫描复用共享读取 service / 同名去重 skip-or-rename / cmd 归一化）+ 模板表 seed + 存为模板
- **W4 前端管理页**：settings/mcp 页升级（双 tab / 搜索标签 / binding 开关 / 三个导入入口 / 诊断面板）+ `pnpm gen:types`
- **W5 收尾**：旧 `PUT /api/platform-settings/mcp` 废弃移除 + 模块文档 + 验证

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:backend/app/modules/mcp_registry/__init__.py | 新模块包 |
| 新增 | NEW:backend/app/modules/mcp_registry/model.py | 三表 ORM（见数据模型节） |
| 新增 | NEW:backend/app/modules/mcp_registry/schema.py | DTO（列表/详情脱敏、创建/更新输入、binding 操作、导入请求/响应、诊断、模板） |
| 新增 | NEW:backend/app/modules/mcp_registry/service.py | CRUD + 可见性/归属校验 + binding 约束 + 加密读写 |
| 新增 | NEW:backend/app/modules/mcp_registry/router.py | /api/mcp-servers* 端点（见接口定义） |
| 新增 | NEW:backend/app/modules/mcp_registry/render.py | render_injection_set / precheck_diagnostics（daemon 端点与诊断端点共用） |
| 新增 | NEW:backend/app/modules/mcp_registry/importer.py | JSON 导入解析 + workspace 扫描 + 去重 + cmd 归一化 |
| 新增 | NEW:backend/app/modules/mcp_registry/templates.py | 模板 seed 预置 + 存为模板 |
| 新增 | NEW:backend/app/modules/mcp_registry/tests/ | 单测：service 权限矩阵 / render golden / importer 去重归一化 / 端点契约 |
| 新增 | NEW:backend/migrations/versions/20260910140000_add_mcp_registry_tables.py | 三表迁移（含 partial unique index + COALESCE sentinel；Grill 后实证路径为 migrations/versions 非 alembic/versions；down_revision 对齐执行时 head） |
| 修改 | backend/app/modules/daemon/router/daemon_rpc.py（端点定义约 :516，:451 为注释块） | GET /api/daemon/mcp/config 换源 registry 渲染；加可选 user_id 参数 + 授权校验（见接口定义）；whitelist 读取不变 |
| 修改 | backend/app/modules/daemon/lease/context.py（build_claim_payload，约 :420-482） | claim payload 新增 user_id 下发（Grill CC-02：daemon 侧现无 user 上下文，DB 侧 lease→user 关联已存在） |
| 修改 | sillyhub-daemon/src/daemon.ts（execPayload 归一化，约 :8522-8640；会话创建预取，约 :8144-8165） | 归一化字段加 user 透传；会话创建拉 MCP 时带 user_id；会话级缓存 `_mcpBundleBySession` 结构不动（Grill CC-01：实际缓存是会话级 Map，非进程级 TTL——天然适配 per-user） |
| 修改 | backend/app/modules/settings/router.py | 移除 GET/PUT /api/platform-settings/mcp 两端点与 McpServersSchema（D-003 零兼容负担同删）；whitelist 两端点保留 |
| 修改 | frontend/src/lib/mcp-settings.ts（:60-67 调用将删端点） | 改调 /api/mcp-servers（Grill CC-16 补漏；whitelist 客户端保留） |
| 新增 | NEW:frontend/src/lib/api/mcp-registry.ts | 新 api 客户端（范式对齐 llm-providers.ts） |
| 修改 | frontend/src/lib/menu-permissions.ts | menuKey=mcp 的 menuLabel"MCP 管理"改"MCP 资产库"（agent 组归属不变，D-009 补记） |
| 修改 | frontend/src/app/(dashboard)/settings/mcp/page.test.tsx | 7 用例重写（页面重构后旧断言失效） |
| 修改 | backend/app/modules/settings/schema.py | 移除 McpServersSchema（随旧端点删除） |
| 修改 | backend/app/modules/daemon/tests/test_mcp_config_endpoint.py | 契约测试更新：:109-:227 七个 KV-seed 用例重写 + user_id 路径新用例（Grill CC-16/plan-review 补漏） |
| 修改 | backend/app/modules/daemon/tests/test_build_claim_payload.py | claim payload user_id 下发用例（task-06） |
| 修改 | sillyhub-daemon/tests/mcp-config.test.ts | URL 加 user_id 参数用例（task-06/07） |
| 新增 | NEW:sillyhub-daemon/tests/daemon-mcp-user-id-wiring.test.ts | daemon.ts 透传 wiring 用例（task-06） |
| 修改 | backend/app/main.py（router 注册，include_router 处约 :824-840） | 注册 mcp_registry router |
| 修改 | sillyhub-daemon/src/mcp-config.ts | 仅请求 URL 加 user_id 查询参数（fetch 函数签名扩展）；缓存/合并/预净化逻辑不动（Grill CC-01 修正：此前误述"60s TTL 进程级缓存"，实际缓存在 daemon.ts 会话级 Map） |
| 修改 | frontend/src/app/(dashboard)/settings/mcp/page.tsx | 升级为管理页（双 tab/搜索标签/binding 开关/导入/诊断，照 FRONTEND_PAGE_STYLE.md）。菜单归「智能体」组（menu-permissions.ts agent section，menuKey=mcp 的 menuLabel"MCP 管理"同步改"MCP 资产库"），URL 保持历史路径 /settings/mcp 不迁移 |
| 新增 | NEW:frontend/src/components/mcp-registry/（组件目录，按现有页面组织惯例） | 卡片/表单/导入弹窗/诊断面板组件 |
| 修改 | frontend/src/lib/api-types.ts | `pnpm gen:types` 生成（CLAUDE.md 规则 21） |
| 新增 | NEW:.sillyspec/docs/backend/modules/mcp_registry.md | 模块卡片（archive 前收尾） |
| 修改 | .sillyspec/docs/backend/modules/settings.md | 模块文档同步（task-13） |
| 修改 | .sillyspec/docs/backend/modules/daemon.md | 模块文档同步（task-13） |
| 修改 | .sillyspec/docs/backend/modules/_module-map.yaml | 模块映射同步（task-13） |
| 修改 | backend/openapi.json | gen:types 联动提交 |

## 接口定义

```python
# service.py 核心
class McpRegistryService:
    async def list_servers(scope: Literal["platform","mine","visible"], user: User) -> McpServerList
        # visible = 平台共享全员可见（env 脱敏）+ 自己私有
    async def create_server(inp: McpServerCreate, user: User) -> McpServerDetail
        # scope=platform 需 admin；stdio-only 校验；secret env 键抽列加密
    async def update_server(id: UUID, inp: McpServerUpdate, user: User) -> McpServerDetail
    async def delete_server(id: UUID, user: User) -> None   # 级联 binding
    async def add_binding(id: UUID, scope_type: str, user: User) -> None
        # platform 需 admin；user binding 校验 scope_ref=owner 或 server 为平台共享
    async def remove_binding(id: UUID, scope_type: str, scope_ref: UUID | None, user: User) -> None

# render.py 核心（daemon 端点与诊断端点共用）
async def render_injection_set(session, user_id: UUID | None) -> dict
    # platform binding 全集 ∪ user binding（scope_ref=user_id），enabled 过滤，
    # encrypted_env 解密回填 env，输出 {mcpServers: {name: {command,args,env}}}
async def precheck_diagnostics(session) -> list[McpDiagnostic]
    # 诊断项（Grill B-03 修正：whitelist 对 platform 位自动放行、非 stdio 在 platform
    # 位是整包抛错回落 builtin——原定义 will_be_rejected_by_whitelist / will_be_prepurged
    # 与注入链实际语义矛盾，重定义如下）：
    #   - decrypt_failed：encrypted_env 解密失败（key 轮换失配等）→ 渲染时该 server 降级
    #     为无 secret 形态并标记
    #   - bound_but_disabled：server 有 binding 但 enabled=false（配置死角提示）
    #   - platform_name_shadow：platform 渲染集 server 名与某 workspace .mcp.json
    #     server 名相同（三层合并 platform < workspace，workspace 位会遮蔽 platform
    #     位——用户可能不知道自己的平台配置没生效）
    #   - workspace_blocked_by_whitelist：各 workspace .mcp.json 中会被白名单拒绝的
    #     server（whitelist 检查的正确方向——它只过滤 workspace 位，mcp-config.ts:382-389）
    #   - invalid_type_defensive：server_type != stdio（写路径已挡，防御性——platform
    #     位若混入非 stdio 会整包回落 builtin-only，严重级提示）

# daemon 端点 user_id 授权（Grill B-01 新增，防越权解密他人私有 env）
# 规则：认证主体必须为 daemon principal（daemon token）；且 user_id 必须与该 daemon
# 的活跃 lease 归属匹配（查 lease WHERE daemon_id=principal AND user_id=:user_id，
# DB 侧 lease→user 关联已存在）——把"泄漏 daemon token 可读任意用户 env"压回
# "只能读该 daemon 正在服务的用户"。无匹配 lease → 404（不泄露 user 存在性）。
# 不带 user_id → platform only（向后兼容，无授权增量）。
```

REST 端点（`/api` 前缀，权限：平台库写操作 `require_permission_any(SETTINGS_ADMIN)`，我的库 `get_current_user`，跨用户私有库 404 防存在性枚举——对齐 skills 先例）：

```text
GET    /api/mcp-servers?scope=platform|mine|visible&search=&tag=     列表（env 脱敏 + 绑定态 + 诊断徽标）
POST   /api/mcp-servers                                              创建
GET    /api/mcp-servers/{id}                                         详情（env 脱敏）
PATCH  /api/mcp-servers/{id}                                         更新
DELETE /api/mcp-servers/{id}                                         删除
POST   /api/mcp-servers/{id}/bindings                                加绑定 {scope_type}
DELETE /api/mcp-servers/{id}/bindings/{scope_type}[/scope_ref]       解绑
POST   /api/mcp-servers/import-json                                  {json_text, scope} → {imported, skipped, renamed}
POST   /api/mcp-servers/workspace-scan                               {workspace_id?} → 候选列表（含去重判定）
POST   /api/mcp-servers/workspace-import-apply                       {candidates: [...], scope} → 应用结果
GET    /api/mcp-servers/templates                                    模板列表（预置 + 自存）
POST   /api/mcp-servers/templates                                    存为模板 {name, from_server_id | server_config}
GET    /api/mcp-servers/diagnostics                                  平台注入集预检结果
（daemon）GET /api/daemon/mcp/config?workspace_id=&user_id=           换源 registry（user_id 可选；无 user_id 行为=platform only，向后兼容）
```

## 生命周期契约表

本变更不涉及「生命周期契约/lifecycle contract」相关实体（无 session/lease/agent_run/claim/heartbeat 状态迁移；daemon 拉取是无状态 HTTP GET + 客户端缓存，不改变会话生命周期）。豁免。

## 数据模型

```text
mcp_servers
  id              UUID PK default gen_random_uuid()
  owner_user_id   UUID NULL FK users ON DELETE CASCADE   -- NULL=平台共享（D-001）
  name            String(100)                             -- ^[a-z0-9][a-z0-9-]{1,99}$（mcpServers key 安全字符）
  server_type     String(10) default 'stdio'              -- 'stdio'|'http'|'sse' 建模预留，写路径仅 stdio（D-005）
  server_config   JSON                                     -- {command, args, env}；env 仅含非 secret 明文键
  encrypted_env   JSON NULL                                -- secret 键的密文映射（Grill CC-03 补规格）：
                                                            -- 结构 {SECRET_KEY: {"ct": "<base64(密文bytes)>",
                                                            --                    "key_id": "<版本标签，如 v1>"}}
                                                            -- 逐键独立加密（CredentialCipher 单值接口
                                                            -- encrypt(str)->tuple[bytes,key_id] 循环调用，
                                                            -- backend/app/core/crypto.py:67-78；key_id 为
                                                            -- 版本标签字符串非 uuid，crypto.py:45-48），
                                                            -- 每键自带 key_id 支持密钥轮换（解密时
                                                            -- 密钥失配抛 CipherKeyMismatch → 诊断项
                                                            -- decrypt_failed，不炸渲染）
                                                            -- secret 判定沿用 _redact_mcp_env 的键名
                                                            -- 规则（_SECRET_KEY_MARKERS=token/key/
                                                            -- secret/password 子串，settings/router.py:164）
  tags            JSON default []                          -- list[str]
  note            Text default ''
  enabled         bool default true
  source          String(30) 'manual'|'imported_json'|'imported_workspace'
  dedup_key       String(200) NULL                         -- 'ws:<workspace_id>:<name>'，扫描导入去重锚
  created_at / updated_at
  -- 唯一性：CREATE UNIQUE INDEX uq_mcp_servers_owner_name
  --          ON mcp_servers (COALESCE(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), name)
  --          （PG NULL 不参与唯一约束，用 COALESCE sentinel 化 owner 维度）

mcp_server_bindings
  id          UUID PK
  server_id   UUID FK mcp_servers ON DELETE CASCADE
  scope_type  String(10) 'platform' | 'user'
  scope_ref   UUID NULL                       -- platform=NULL；user=user_id
  created_at
  -- UNIQUE(server_id, scope_type, scope_ref) 拆两条 partial index：
  --   CREATE UNIQUE INDEX uq_binding_platform ON mcp_server_bindings (server_id) WHERE scope_type='platform'
  --   CREATE UNIQUE INDEX uq_binding_user ON mcp_server_bindings (server_id, scope_ref) WHERE scope_type='user'
  -- 业务约束（service 层）：user binding 时 scope_ref 必须 = server.owner_user_id
  --   或 server.owner_user_id IS NULL（平台共享才能被用户绑定）

mcp_templates
  id / name String(100) / server_config JSON（明文模板，无 secret）
  is_preset bool / owner_user_id UUID NULL（NULL=平台预置 seed）
  created_at
  -- seed：fetch / context7 / playwright / sequentialthinking / memory 等 5-7 个（W3 落地时定稿）
```

## 兼容策略（brownfield 必填）

- **daemon 旧调用兼容**：`GET /api/daemon/mcp/config` 不带 `user_id` 时行为 = platform binding only（等同旧 platform_default 语义）；带 `user_id` 时 = platform ∪ user（经 lease 归属授权校验）。响应形状不变——**含三个键** `{platform_default: {mcpServers}, whitelist: [], workspace: {mcpServers}}`（Grill CC-04 修正：带 workspace_id 调用时现有端点还有第三个键 `workspace`，daemon `mcp-config.ts:214,227` 消费它；本变更不改 workspace 键的现有读取逻辑）
- **registry 空库回落**：渲染结果为空集时输出 `{"mcpServers": {}}`（对齐现有 KV 缺失回落语义）
- **渲染失败回落**：渲染抛错时端点返回 **503**——daemon 侧 fetch 失败回落本地 `~/.sillyhub/daemon/mcp.json` 的既有链路（mcp-config.ts:246-253）因此保持可达（Grill CC-14 修正：原设计"200+空集"会让本地文件回落在此错误路径上不可达，与 KV 时代故障行为不一致）
- **未升级 daemon**：旧 daemon 不传 user_id，user binding 对其不可见（platform only）——渐进升级无断裂
- **旧端点废弃**（D-003 零兼容负担）：`GET/PUT /api/platform-settings/mcp` 同删（项目未上线，CLAUDE.md 规则 11）；`mcp.platform_default` KV 行残留无害不清；`/api/platform-settings/mcp-whitelist` 两端点保留不动
- **workspace `.mcp.json` 完全不动**：三层合并优先级（platform < workspace < builtin）与白名单过滤、stdio 预净化在 daemon 侧原样保留

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | daemon 侧改动引入回归（会话创建热路径 + claim payload 扩展） | P1 | W2 先写契约测试（无 user_id 行为 golden 对照旧版 test_mcp_config_endpoint.py:253）再改；会话级缓存 `_mcpBundleBySession` 结构不动（Grill 修正后改造面缩小为：claim 透传 + 请求参数 + URL 拼接）；claim payload 新增字段向后兼容（旧 daemon 忽略未知字段） |
| R-02 | partial unique index / COALESCE sentinel 唯一性在 Alembic 迁移中的方言问题 | P2 | PG 单一目标库（PROJECT.md 技术栈确认），partial index 为 PG 原生能力；迁移脚本带 downgrade |
| R-03 | 渲染端点从读 KV 变为查表+解密+渲染，延迟上升 | P2 | 单查询 join binding（索引齐备）；daemon 会话级缓存每会话一次拉取吸收；必要时 render 结果进程内短缓存（v1 不做，观察） |
| R-04 | 扫描导入遍历 workspace 文件 IO 的耗时与并发 | P2 | 逐 workspace 串行 + 每文件超时；候选列表只读不写，apply 才落库；workspace 数量当前规模小（内测） |
| R-05 | secret 键名规则误判（非 secret 键被加密 / secret 键漏加密） | P1 | 沿用 `_redact_mcp_env` 既有键名规则保持双向一致；单测覆盖边界键名；创建/更新时前端明示哪些键会被加密 |
| R-06 | UI 原型（管理页交互形态） | P2 | 已补原型 `prototype-mcp-central-registry.html`（架构数据流图 + 双 tab 卡片管理页 + 诊断面板 + 新建/扫描导入弹窗，AI-Native 主题 token，区块角标标注 FR/D-xxx）；实现按原型 + FRONTEND_PAGE_STYLE.md |
| R-07 | name 字符集约束与存量 workspace .mcp.json 中 server 名不兼容（扫描导入改名） | P2 | 导入时非法名自动归一化（小写/连字符替换）+ 提示；dedup_key 保留原名可追溯 |
| R-08 | daemon 端点 user_id 越权（Grill B-01 P0：任意认证主体可解密他人私有 env） | P1 | 接口定义已补授权规则：daemon principal 认证 + lease 归属匹配校验（无匹配 404）；单测覆盖"合法 lease 通过 / 无 lease 拒绝 / 跨 daemon 拒绝"三态 |
| R-09 | secret 键名规则漏判（Grill CC-09 实证：MYSQL_PASS 不含任何 marker，真实口令漏加密） | P1 | 短期：R-05 前端明示 + 创建/导入时对 env 键做"含大写且值像凭证"的启发式提醒（不强制）；长期：模板与导入路径预置常见键名清单扩充（MYSQL_PASS/PASSWORD 变体），独立 quick 跟进 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001 双层可见性 | 设计目标 1 / 数据模型 owner_user_id / service 可见性规则 | 已覆盖 |
| D-002 独立 binding 表 | 数据模型 mcp_server_bindings / 接口定义 add/remove_binding | 已覆盖 |
| D-003 弃 KV 零迁移 | 兼容策略旧端点废弃 / W5 | 已覆盖 |
| D-004 全量六项 | 设计目标 4 / W3 / 接口定义导入与模板端点 | 已覆盖（诊断机制表述随 D-009/D-011 修正） |
| D-005 stdio-only 建模预留 | 数据模型 server_type / service 写路径校验 | 已覆盖 |
| D-006 注入链语义保持 | 兼容策略（@superseded：语义部分由 D-008 继承表述） | 已覆盖 |
| D-007 方案A 新模块 + 白名单留 settings + 无推送 | 总体方案 / 非目标 / 文件变更清单 | 已覆盖（零改动字样已随 Grill CC-07 清理） |
| D-008@v2 daemon 落地路径（源码事实修正版） | W2 / 文件变更清单（context.py/daemon.ts）/ R-01 | 已覆盖（@v1 superseded） |
| D-009 设计整体确认 + 原型跳过 | 本文档全量 / R-06 | 已覆盖 |
| D-010 daemon 端点 user_id 授权（Grill B-01 P0） | 接口定义授权规则段 / R-08 | 已覆盖（用户已裁决：强校验 lease 归属） |
| D-011 诊断预检五项重定义（Grill B-03 P1） | 接口定义 precheck_diagnostics / render.py | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约豁免/数据模型/兼容策略/风险登记/决策追踪）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@vN（D-001~D-011 全部进决策追踪表；D-006/D-008@v1 为 @superseded 状态如实标注，现行版本为 D-008@v2）
- [x] 生命周期关键词（session/daemon）出现处已评估——均为既有机制的引用说明，无状态迁移设计，紧邻豁免短语已写
- [x] UI 原型分级核对：brainstorm 阶段曾跳过（用户后补要求），已补 `prototype-mcp-central-registry.html`（见 R-06）
- [x] 无「⚠️ 自审存疑」遗留——两个实现期才定的细节（router 注册机制的确切位置、模板 seed 定稿清单）已在文件变更清单与数据模型内标注，属 plan 阶段任务粒度非设计歧义
