---
author: qinyi
created_at: 2026-09-10 10:50:06
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台管理员（admin） | 管理平台共享 MCP 库与 platform 绑定（注入默认集） |
| 普通用户 | 管理自己的私有 MCP 库、user 绑定、导入、模板 |
| daemon（服务组件） | 会话创建时拉取注入集（platform only 或 platform ∪ user） |
| AgentProfile 消费者 | 通过既有 mcp_refs 过滤注入集（本变更不触碰） |

## 功能需求

### FR-01: MCP server 实体 CRUD 与双层可见性
覆盖决策：D-001, D-005
Given 平台共享库（owner_user_id=NULL，仅 admin 写）与用户私有库（owner 归属）并存
When 用户创建/更新/删除 server 或列表查询（scope=platform/mine/visible）
Then 非 admin 写平台库 403；跨用户读私有库 404（防存在性枚举，对齐 skills 先例）；visible scope = 平台共享（脱敏）+ 自己私有；写路径 server_type 仅接受 stdio

### FR-02: secret env 加密存储
覆盖决策：D-001
Given server_config.env 中含 secret 类键（_SECRET_KEY_MARKERS=token/key/secret/password 子串）
When 创建/更新/导入落库
Then secret 键值逐键加密为 `encrypted_env: {KEY: {"ct": base64, "key_id": 版本标签}}`（CredentialCipher）；server_config.env 不留明文 secret；列表/详情响应 secret 值脱敏 `<set>`；渲染时解密回填，解密失败走 decrypt_failed 诊断不炸渲染

### FR-03: binding 启用集与授权拉取
覆盖决策：D-002, D-008@v2, D-010
Given McpBinding（scope_type=platform|user，partial unique index 保证唯一）
When admin 加 platform 绑定（进全员默认集）或用户加 user 绑定（校验 scope_ref=owner 或 server 为平台共享）
Then 注入集 = platform binding 全集 ∪ user binding（enabled 过滤）；
When daemon 带 user_id 调 GET /api/daemon/mcp/config
Then 双校验（daemon principal + 该 daemon 活跃 lease 归属匹配 user_id），无匹配 404；
When 不带 user_id
Then platform only（向后兼容，无授权增量）

### FR-04: 注入链换源与兼容
覆盖决策：D-003, D-006, D-008@v2
Given registry 空库或渲染结果为空
When daemon 拉取
Then 输出 `{"mcpServers": {}}`（对齐 KV 缺失回落）；渲染抛错返回 503（daemon 既有本地回落链保持可达）；响应三键形状 `{platform_default, whitelist, workspace}` 不变；无 user_id 调用 golden 对照旧版一致

### FR-05: user_id 透传链
覆盖决策：D-008@v2
Given claim payload（build_claim_payload）现无 user_id，daemon execPayload 无 user 字段
When backend claim 下发（新增 user_id 字段，旧 daemon 忽略未知字段向后兼容）且 daemon 会话创建拉取带 user_id 查询参数
Then 会话级缓存 `_mcpBundleBySession` 结构不变，per-user 注入集生效

### FR-06: JSON 粘贴导入
覆盖决策：D-004
Given 粘贴 mcpServers JSON（兼容 mcpServers/servers/mcp 三种包装）
When 用户（或 admin 选平台库）提交导入
Then 解析建库（source=imported_json）；非法条目逐条报错不整批失败

### FR-07: workspace 扫描导入与去重
覆盖决策：D-004
Given 各 workspace specDir/.mcp.json 存在存量配置
When 用户触发扫描（候选列表只读）后勾选应用
Then 同名同配置（cmd 归一化后比对）skip；同名异配置改名 `<name>-<workspace短名>`；dedup_key=ws:<workspace_id>:<name> 持久去重；非法 server 名自动归一化（小写/连字符）并提示

### FR-08: 注入诊断预检
覆盖决策：D-011
Given platform 渲染集与各 workspace .mcp.json
When 诊断端点调用
Then 输出五项：decrypt_failed / bound_but_disabled / platform_name_shadow（platform 名被 workspace 同名遮蔽）/ workspace_blocked_by_whitelist（whitelist 只过滤 workspace 位）/ invalid_type_defensive；不产出与注入语义矛盾的诊断项

### FR-09: 收藏模板
覆盖决策：D-004
Given 模板表（is_preset seed 预置 5-7 个 + 用户自存）
When 用户从模板快速创建或把现有 server 存为模板
Then 模板为明文 server_config（无 secret）；从带 secret 的 server 存模板时 secret 键丢弃并提示

## 非功能需求

- 兼容性：无 user_id 旧调用行为逐字段不变；claim payload 新增字段旧 daemon 忽略；未升级 daemon 的 user binding 不可见（platform only 渐进升级）
- 可回退：Alembic 迁移带 downgrade；registry 渲染失败 503 → daemon 本地回落链（会话创建不阻塞，R-03 语义）
- 可测试：渲染/导入/授权/权限矩阵全单测覆盖；daemon 端点契约 golden 对照
- 安全：私有 env 仅 daemon 渲染端点解密输出（admin/用户侧恒脱敏）；授权三态（合法/无 lease/跨 daemon）单测
