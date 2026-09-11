# Decisions — 工作区↔平台资产桥（skills/MCP 四桥）

- id: D-001
  type: boundary
  priority: P0
  status: accepted
  source: user
  question: 桥接范围
  answer: 用户裁决四桥全做：①workspace 技能页增「从平台 git 技能库启用」区块 ②library 页增 workspace 绑定管理 ③workspace .mcp.json 编辑器增「从 MCP 资产库选入」（backend 代写 .mcp.json）④specDir/skills 反向收编为 CustomSkill（当初 Grill 砍的是 worktree .claude/skills 扫描不可达；specDir/skills backend 直读可达——skills_view_service 既有先例，故本路可行，D-011 的限制不适用此路径）。
  normalized_requirement: 四桥全交付；③的写路径复用 SkillsViewService 的 .mcp.json 直写模式（workspace/mcp 既有 PUT）。
  impacts: [FR-1..FR-4]
  evidence: 用户 AskUserQuestion 第 1 轮（2026-09-11）

- id: D-002
  type: architecture
  priority: P0
  status: accepted
  source: user
  question: workspace 维度技能启用语义
  answer: 用户裁决并集：注入集 = user 启用 ∪ 会话所属 workspace 的启用（bundle 渲染时按 (user_id) ∪ (workspace_id) 双查询）；user 维度语义不变（零回归）；同名去重天然由既有 D-010 origin 粒度处理。
  normalized_requirement: bundle 第三源查询改为双维度并集；workspace 绑定表权限=workspace write 成员。
  impacts: [FR-1]
  evidence: 用户 AskUserQuestion 第 1 轮（2026-09-11）

- id: D-003
  type: architecture
  priority: P0
  status: accepted
  source: code
  question: workspace 绑定存储形态
  answer: 扩展既有 user_skill_enables 表：增 workspace_id 列（NULL=user 维度沿用；非 NULL=workspace 维度），UNIQUE 改 (user_id 不变 NULL 行语义) + (workspace_id, skill_key)。理由：双表会让 bundle 双查询双 join，单表 scope 列最薄；user_id 对 workspace 行填 owner（创建者）作审计。迁移一列+索引。
  normalized_requirement: 单表双 scope；user_id NOT NULL 保持（workspace 行填操作者）；UNIQUE(workspace_id, skill_key) where workspace_id is not null；原 UNIQUE(user_id, skill_key) 加 where workspace_id is null 部分索引。
  impacts: [FR-1]
  evidence: 主代理裁决（表结构最薄路径）

- id: D-004
  type: boundary
  priority: P1
  status: accepted
  source: code
  question: MCP 桥（③）写入语义
  answer: 「从资产库选入」= POST /api/workspaces/{id}/mcp/import-from-registry {server_id}：backend 读 registry server 定义（解密 env）→ 写入 workspace .mcp.json（复用 workspace/mcp PUT 既有写路径与审计）→ 响应含写入结果；同名冲突走改名（复用 MCP 资产库导入的 skip-or-rename 语义但方向相反——workspace 已有同名则后缀 -registry）。secret 解密仅此端点（写盘后即明文存 .mcp.json，与手工编辑等价——.mcp.json 本就是明文文件）。
  normalized_requirement: 端点 require WORKSPACE_WRITE；写路径走 SkillsViewService 既有 .mcp.json 原子写；解密只发生在写入内容构造时。
  impacts: [FR-3]
  evidence: 主代理裁决；workspace/mcp PUT 既有先例

- id: D-005
  type: boundary
  priority: P1
  status: accepted
  source: code
  question: 收编桥（④）语义
  answer: 扫描端点=GET /api/workspaces/{id}/skills/adoptable：列 specDir/skills/ 下不在平台库名集合且非 sillyspec-* 前缀的技能（name+description frontmatter）；落库端点=POST /api/workspaces/{id}/skills/adopt {names[]}→逐个读 SKILL.md 原文写 CustomSkill（含 frontmatter 原样/缺则拼装对齐 bundle 层防双拼）；不删 specDir 源文件（用户自清）；权限=WORKSPACE_WRITE，CustomSkill 归属=操作者。
  normalized_requirement: 两阶段（列表只读+确认落库）；重名 CustomSkill 409 走既有；多文件技能只收 SKILL.md 主文件（bundle 层 CustomSkill 本就单文件——辅助文件提示用户手动合并）。
  impacts: [FR-4]
  evidence: 主代理裁决；skills_view_service 读先例

- id: D-006
  type: architecture
  priority: P0
  status: accepted
  source: user
  question: 实现方案
  answer: 方案A：桥逻辑分布到既有三个模块（skill_source 扩展双 scope 查询+adopt；workspace 模块扩展 mcp import-from-registry 端点；mcp_registry 提供 server 定义读取 helper）——不新建桥模块（桥是连接件非领域）。前端在两个既有页面内加区块。否决 B（新 bridge 模块——两域间再加一层徒增归属模糊）。
  normalized_requirement: 改动落 skill_source/workspace/mcp_registry 三模块+两前端页。
  impacts: [FR-1..4]
  evidence: 主代理裁决（方案对比在案）

- id: D-007
  type: architecture
  priority: P0
  status: accepted
  source: user
  question: Grill B-01：daemon 不改则桥①②只落库不注入（manifest 是唯一注入通道且 fetchRemoteManifest 无 workspace 上下文）
  answer: 用户未应答，主代理按推荐裁决（汇报可否决）：本变更含 daemon 最小改造——skill-manager 增 per-workspace manifest 拉取（会话/任务 workspace 绑定时带 ?workspace_id= 拉专属版本缓存在独立槽位 <manifest>:<workspace_id>，与全局 user-only 槽并存；link 阶段按会话 workspace 选槽）；启动全局拉保留（向后兼容）。理由：用户裁决 D-002 并集语义是"注入集"定义，不含 daemon 则四桥之二成死数据，违背 D-001 意图。
  normalized_requirement: skill-manager fetch/缓存键扩 workspace 维度；manifest 端点 ?workspace_id 可选参数（带则并集渲染）；workspace 绑定的会话/任务 spawn 前拉取 workspace manifest 并解包其 git 技能到 workdir。
  impacts: [FR-1, 目标 4]
  evidence: Grill B-01（daemon.ts:2234-2244/skill-manager.ts:107-124,326-379,41）；主代理裁决

- id: D-008
  type: definition
  priority: P1
  status: accepted
  source: design-grill
  question: B-02/B-03：adopt 名归一化与 adoptable 数据源
  answer: 归一化：目录名→小写、[^a-z0-9-]→连字符、压连续连字符、去首尾、超 40 截断、仍不合规或空→候选列表标 invalid 跳过（不炸整批）；description 取 frontmatter 截 200（缺省"从 workspace 收编"）。adoptable 数据源=平台库名集合= CustomSkill 全体名（DB）∪ sillyspec-*（文件扫描）∪ git 源实时 discover 全部 enabled 源（与管理员视角一致，不带 user）；list_adoptable 增 user 参数（workspace write 已由端点保证）。
  normalized_requirement: 归一化函数与跳过标记有单测；差集排除三源名。
  impacts: [FR-4]
  evidence: Grill B-02/B-03

- id: D-009
  type: definition
  priority: P1
  status: accepted
  source: design-grill
  question: B-04：import 契约（user 可见性/解密失败/未绑定）
  answer: get_server_for_import(server_id, user)：复用 _get_server 读可见性（跨用户私有 404 防枚举同 list）；解密失败（CipherKeyMismatch）→422 明确"密文无法解密"；enabled=false 或无 binding 的 server 可导入定义但响应带 warning（导入的是配置非生效状态——.mcp.json 写入即生效，与平台绑定态无关）。
  normalized_requirement: 三态契约各有测试；import 后 registry 侧状态零变化。
  impacts: [FR-3]
  evidence: Grill B-04

- id: D-010
  type: compatibility
  priority: P0
  status: accepted
  source: design-grill
  question: B-05：NULL 谓词枚举不全（list_library 污染/第三源 None case/toggle 连删/model ORM 漏列）
  answer: 四处全修：list_library enabled_keys 过滤 workspace_id IS NULL（user 视角不混 ws 行）；_collect_enabled_git_skills workspace_id=None 时查询显式 AND workspace_id IS NULL（用户 bundle version hash 不变）；toggle 删除谓词带 scope（user 维度删只删 NULL 行，workspace 维度删只删 ws 行）；model __table_args__ 同步双 partial（postgresql_where+sqlite_where 双方言）。
  normalized_requirement: 四处各有回归用例；version hash 零变化断言。
  impacts: [FR-1, 兼容]
  evidence: Grill B-05（service.py:363/skills_bundle_service.py:208/service.py:312-314/model.py:92-94）
