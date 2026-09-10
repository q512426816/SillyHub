---
author: qinyi
created_at: 2026-09-10 10:52:30
---

# Decisions — MCP 中央资产库

> 本文件由 brainstorm Step 3 落盘，记录需求澄清阶段的关键决策。
> 幂等规则：写入前按 D-xxx@vN 查重，修正走新版本 + supersedes。

- id: D-001
  type: architecture
  priority: P0
  status: accepted
  source: user
  question: MCP 资产库的多用户可见性模型（平台共享库 vs 用户私有库）
  answer: 双层：平台共享库（owner_user_id=NULL，admin 管理，全员可见）+ 用户私有库（owner 归属，个人 token 不外泄）。依据：MCP 定义的公共资产属性（context7/fetch 人人可用）与私有凭证场景并存；现有 mcp.platform_default 本质已是平台库。注意与 skills 模块先例（D-007 per-user 硬约束）不同——技能是个人产出物，MCP 定义是基础设施资产。
  normalized_requirement: McpServer.owner_user_id 为 NULL 时是平台共享（仅 admin 可写），非 NULL 时用户私有（仅 owner 可写）；读可见性=平台共享全员可见 + 私有仅 owner。
  impacts: [FR-1, FR-2]
  evidence: 用户 AskUserQuestion 第 1 轮（2026-09-10）；调研文档 §3.1/§7；settings 模块文档（platform_default 现状）

- id: D-002
  type: architecture
  priority: P0
  status: accepted
  source: user
  question: 启用绑定形态（布尔列 vs 独立 binding 表）
  answer: v1 即建独立 McpBinding 表（server_id + scope_type + scope_ref），一步到位支持平台默认注入集与用户自定义启用集。用户未采纳"v1 布尔列简化"推荐，选择完整形态。
  normalized_requirement: 注入集 = scope_type='platform' 绑定的 server 全集 ∪ scope_type='user'（scope_ref=该用户）绑定的 server；同一 server 允许 platform 与 user 绑定并存；(server_id, scope_type, scope_ref) 唯一。
  impacts: [FR-3]
  evidence: 用户 AskUserQuestion 第 1 轮（2026-09-10）；llm_provider is_default 先例被 consciously 扩展

- id: D-003
  type: compatibility
  priority: P0
  status: accepted
  source: user
  question: 存量 mcp.platform_default KV 迁移策略
  answer: 用户确认 KV 中无真实在用数据，直接弃 KV：daemon 拉取端点切 registry 渲染，不写数据迁移脚本，KV 残留无害。依据 CLAUDE.md 规则 11（未上线不要求历史兼容）。
  normalized_requirement: 不实现 KV→registry 数据迁移；GET /api/daemon/mcp/config 数据源切 registry；PUT /api/platform-settings/mcp（旧 KV 写端点）废弃或移除（design 定）。
  impacts: [FR-4]
  evidence: 用户 AskUserQuestion 第 1 轮（2026-09-10）

- id: D-004
  type: boundary
  priority: P0
  status: accepted
  source: user
  question: v1 能力范围
  answer: 全量六项进 v1：CRUD+分组/标签/搜索、JSON 粘贴导入、workspace 扫描导入（同名去重：同配置 skip/异配置改名）、注入诊断回显、收藏模板（预置常用 MCP）、cmd 归一化（入库剥 Windows cmd /c 包装）。【诊断机制由 D-009 修正为 backend 渲染预检，见 D-009】
  normalized_requirement: proposal §3.4 六项能力全部在本变更交付；change 体量按多 Wave 拆分（plan 阶段定）。
  impacts: [FR-5, FR-6, FR-7, FR-8]
  evidence: 用户 AskUserQuestion 第 2 轮（2026-09-10）；proposal-config-management-capability-2026-09-10.md §3.4

- id: D-005
  type: boundary
  priority: P0
  status: accepted
  source: docs
  question: http/sse 传输类型是否放行
  answer: 本期不放行。stdio-only 是 D-017 防 SSRF 安全决策（daemon mcp-config.ts assertMcpServerType）。registry 数据模型 server_type 建模预留 http/sse 枚举值，但创建/更新端点 v1 仅接受 stdio；放行需先做 URL 出网白名单评估（独立变更）。
  normalized_requirement: McpServer.server_type 列允许 'stdio'|'http'|'sse' 值域（建模预留），POST/PATCH 校验仅放行 'stdio'；daemon 侧预净化逻辑不变。
  impacts: [FR-1]
  evidence: 调研文档 §3.5；sillyhub-daemon/src/mcp-config.ts:33,306-311（D-017）

- id: D-006
  type: premise
  priority: P0
  status: superseded
  source: code
  question: 注入链既有语义是否保持
  answer: 【已被 D-008 部分修正】原表述"daemon 零改动"过于绝对。保持不变的部分：三层合并优先级（platform < workspace < builtin）、白名单过滤、stdio-only 预净化、失败不阻塞会话创建（R-03）、daemon 消费的响应形状。
  normalized_requirement: （继承至 D-008 修正版）
  impacts: [FR-4]
  evidence: sillyhub-daemon/src/mcp-config.ts:78-101；backend/app/modules/daemon/router/daemon_rpc.py:451；设计张力摊开后用户裁决

- id: D-008
  type: architecture
  priority: P0
  status: superseded
  source: user
  question: user binding 进注入链需要 per-user 注入集，与 daemon 缓存冲突，如何解
  answer: 【已被 D-008@v2 修正】原表述基于失实前提："mcp-config.ts 60s TTL 进程级缓存"不存在（Grill CC-01：实际缓存是 daemon.ts 会话级 _mcpBundleBySession Map）；"daemon 会话路径已有 user 上下文"不成立（Grill CC-02：execPayload 无 user 字段，需 backend claim payload 透传）。方向性裁决（user binding 完整进注入链、daemon 允许可控小改）仍有效，实施细节以 v2 为准。
  normalized_requirement: （见 D-008@v2）
  impacts: [FR-3, FR-4]
  evidence: 用户 AskUserQuestion 第 4 轮（2026-09-10）；Grill CC-01/CC-02 源码证据（daemon.ts:1698/8144-8165/8522-8640、lease/context.py:420-482）

- id: D-008@v2
  type: architecture
  priority: P0
  status: accepted
  source: design-grill
  supersedes: D-008@v1
  question: per-user 注入集的 daemon 侧落地路径（源码事实修正版）
  answer: 会话级缓存 Map<sessionId, McpBundle>（daemon.ts:1698）天然按会话隔离，无需改缓存结构。改造链：backend lease/claim payload（context.py build_claim_payload）新增 user_id 下发 → daemon execPayload 归一化透传 → 会话创建拉取 MCP 时带 user_id 查询参数 → 端点按 user 渲染 platform ∪ user 集。改造面比 v1 表述更小（URL 参数 + payload 字段，无缓存重构）。user_id 授权规则见 D-010。
  normalized_requirement: claim payload 含 user_id 字段（旧 daemon 向后兼容忽略）；daemon 端点签名 GET /api/daemon/mcp/config?workspace_id=&user_id=；无 user_id 调用行为=platform only 不变。
  impacts: [FR-3, FR-4, R-01, R-08]
  evidence: design-grill 子代理 CC-01/CC-02（2026-09-10）；sillyhub-daemon/src/daemon.ts:1698,8144-8165,8522-8640；backend/app/modules/daemon/lease/context.py:420-482

- id: D-010
  type: architecture
  priority: P0
  status: accepted
  source: user
  question: daemon 端点 user_id 参数的授权模型（Grill B-01 P0：无授权则任意认证主体可解密他人私有 env，违背 D-001"个人 token 不外泄"）
  answer: 用户确认强校验：认证主体必须为 daemon principal，且 user_id 必须与该 daemon 的活跃 lease 归属匹配（查 lease 表 daemon+user 关联，已存在）；无匹配 lease 返回 404（防存在性枚举）；不带 user_id 无授权增量（platform only 向后兼容）。否决"仅 principal 信任"（留增量漏洞）与"改走 claim 下发通道"（架构变化大）。
  normalized_requirement: 带user_id 的调用走双校验（principal 类型 + lease 归属）；单测覆盖三态（合法 lease 通过/无 lease 拒绝/跨 daemon 拒绝）。
  impacts: [FR-3, R-08]
  evidence: design-grill 子代理 CC-08（daemon_rpc.py:519,544、auth_deps.py:167-197）；用户 AskUserQuestion 第 5 轮确认（2026-09-10）

- id: D-011
  type: definition
  priority: P1
  status: accepted
  source: design-grill
  question: 诊断预检项定义与注入链实际语义矛盾（Grill B-03：whitelist 对 platform 位自动放行使原定义恒假；非 stdio 在 platform 位是整包抛错回落 builtin 非 prepurge）
  answer: 重定义五项：decrypt_failed（解密失败降级+标记）/ bound_but_disabled（配置死角）/ platform_name_shadow（platform 名被 workspace .mcp.json 同名遮蔽，三层合并 platform<workspace）/ workspace_blocked_by_whitelist（whitelist 检查正确方向——只过滤 workspace 位）/ invalid_type_defensive（防御性，platform 位混入非 stdio 会整包回落 builtin-only）。
  normalized_requirement: precheck_diagnostics 输出上述五项；不再产出 will_be_rejected_by_whitelist / will_be_prepurged。
  impacts: [FR-8]
  evidence: design-grill 子代理 CC-05（mcp-config.ts:382-389,260-277；cli.ts:1049-1074）；design.md render.py 段

- id: D-009
  type: architecture
  priority: P1
  status: accepted
  source: user
  question: 设计方案整体确认（含原型跳过声明）
  answer: 用户确认整体设计：mcp_registry 新模块四件+render.py+importer.py；McpServer/McpBinding/McpTemplate 三表（encrypted_env 抽列加密复用 CredentialCipher）；诊断回显走 backend 渲染预检（非 daemon 事件上行）；cmd 归一化仅用于去重比对与展示、渲染透传存储形态；与 AgentProfile.mcp_refs 正交（binding 管池子、mcp_refs 管消费过滤）。HTML 原型跳过（标准 CRUD UI 形态，照 FRONTEND_PAGE_STYLE.md，用户未否决）。【2026-09-10 补记：用户要求后补原型，已产出 prototype-mcp-central-registry.html（架构数据流图+管理页 UI+诊断面板+弹窗），design.md R-06 同步更新】
  normalized_requirement: design.md 按本决策落盘；前端页面按 FRONTEND_PAGE_STYLE.md 实现；DTO 走 pnpm gen:types。
  impacts: [FR-1..FR-8]
  evidence: 用户 AskUserQuestion 第 4 轮设计确认（2026-09-10）

- id: D-007
  type: architecture
  priority: P0
  status: accepted
  source: user
  question: 实现方案（模块组织 + 同步机制）：新独立模块 vs 扩展 settings vs 新模块+WS 推送
  answer: 用户选方案A：新建 backend/app/modules/mcp_registry/ 标准模块（model/schema/service/router + render.py 渲染注入集），daemon_rpc.py 拉取端点换数据源；mcp.whitelist 治理配置留 settings KV 不随迁（资产层与治理层分离）；前端 settings/mcp 页升级为管理页。否决 B（违反 settings 模块 KV 聚合自述定位、持续膨胀）与 C（WS 推送收益被 daemon 缓存吸收，引入新失败面违背 R-03 拉模式哲学，v2 有需求再加）。【Grill CC-07 修正：原 normalized_requirement 中"daemon 侧零改动（D-006）"字样已过时，daemon 改动范围以 D-008@v2 为准】
  normalized_requirement: 新模块 mcp_registry 对标 skills/llm_provider 模块粒度；不新增 WS 消息类型；daemon 改动范围见 D-008@v2。
  impacts: [FR-1, FR-4, FR-5]
  evidence: 用户 AskUserQuestion 第 3 轮选方案A（2026-09-10）；backend 模块文档 settings.md/skills.md/llm_provider.md 先例
