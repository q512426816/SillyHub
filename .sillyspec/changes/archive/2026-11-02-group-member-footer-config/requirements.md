---
author: flow-machine-draft
created_at: 2026-11-02T05:29:44.707Z
---
# 需求规格（Requirements）— 2026-11-02-group-member-footer-config

## 功能需求

### FR-01: 群聊「添加 Agent」表单、建群向导同源表单、「切换配置」弹窗的配置块包含与会话底部同口径的供应商、模型、思考等级、档案四项：模型下拉级联出所选供应商配置的具体模型（可选到 deepseek-v4.1-flash 形态的具体模型名），思考等级按引擎能力门控可选档位（含「最高」）

- 三个成员配置表面（群聊「添加 Agent」对话框、建群向导第三步成员卡、「切换配置」弹窗）**必须**包含与会话底部（sessions/session-config-bar.tsx）同口径的四项选择：供应商（LLM 供应商，原「模型（LLM 供应商）」标签**必须**更名为「供应商」）、模型（**必须**新增，候选=所选供应商的 model/default_fallback_model/model_role_mappings 去重保序并首列「默认（跟随供应商配置）」，级联随供应商切换重置）、思考等级（**必须**新增，档位词表与会话底部同源镜像，按引擎能力门控渲染）、档案（原「智能体方案」**必须**更名为「档案」，语义不变）。
- 模型与思考等级的候选数据源**必须**复用会话底部同源实现（listProviders 供应商模型字段 + THINKING_LEVEL_OPTIONS 镜像），**禁止**另起词表或另接 /v1/models。
- 引擎、机器、工作区、群昵称、团队能力、头像等既有结构字段**必须**保留（委派的结构锚不删）；codex 引擎「使用本机模型配置，无需选择供应商」的既有降级语义**必须**维持。

#### 场景：三表面渲染四选

Given 群主打开「添加 Agent」对话框（或建群向导第三步、或某成员「切换配置」弹窗）
When 表单渲染完成
Then 配置块含供应商、模型、思考等级、档案四项；模型子下拉候选为所选供应商配置的具体模型名并首列「默认（跟随供应商配置）」；切换供应商时模型候选级联刷新；思考等级档位含「最高」且按引擎能力门控

#### 场景：提交携带新字段

Given 成员配置选了供应商=OpenCode Go、模型=deepseek-v4.1-flash、思考等级=最高、档案=SillySpec 极速变更
When 提交添加/切换
Then 请求 payload 携带 llm_provider_id、model、thinking_level、agent_profile_id 四键（后端可存可派发）

### FR-02: 机器下拉选项不再以引擎名兜底（「机器: Claude Code」形态消失，显示机器别名/主机名）

- 三个表面的机器（runtime）下拉选项 label **必须**为机器别名或主机名（display_alias/hostname 优先，引擎名 label 兜底**禁止**保留）；成员卡片「机器」行展示口径**必须**同步。

#### 场景：无别名机器不再显示引擎名

Given 某 runtime 无 display_alias（旧数据显示形态）
When 渲染机器下拉
Then 该项 label 为主机名（hostname），不再出现「Claude Code」引擎名兜底

### FR-03: 影子会话派发按成员所选模型与思考等级执行（run.model + lease metadata thinking_level 透传，未选时维持供应商主模型/引擎默认兜底），成员卡片展示所选模型与思考等级

- agent_group_members **必须**新增 model 与 thinking_level 两个可空列（含 alembic 迁移，保持单头）；成员创建/更新 API **必须**接受并持久化两键（None=不指定，维持既有兜底）。
- 影子会话创建派发**必须**把成员 model 写入首 run 的 AgentRun.model、把 thinking_level 经 prepare_interactive_dispatch 写入 lease metadata（同 session create task-05 FR-03 先例）；未指定时**必须**维持现状兜底（供应商主模型 / 引擎默认档位）。
- 成员六要素快照组装（_build_config_snapshot 的「model」键）**必须**改为存真实所选模型名（未指定存 None 走主模型条目兜底），**禁止**再以供应商名冒充模型名；成员卡片「模型」行**必须**展示所选模型名与思考等级档位。

#### 场景：指定模型与档位的委派

Given 成员配置 model=deepseek-v4.1-flash、thinking_level=最高
When 群聊委派触发影子会话创建
Then 首 run 的 AgentRun.model=deepseek-v4.1-flash，lease metadata 携带 thinking_level=最高档位值，daemon 侧按该模型与档位起引擎

#### 场景：未指定的零回归兜底

Given 成员未配置 model/thinking_level（存量成员行两列为 NULL）
When 影子会话创建
Then 派发行为与现状逐字节一致（AgentRun.model 走供应商主模型兜底、无 thinking_level 键）

### FR-04: 前端表单（渲染/级联/提交payload）与后端（成员schema/存储/影子派发透传）均有自动化测试覆盖

- 前端**必须**覆盖：三表面四选渲染、供应商→模型级联、提交 payload 携 model/thinking_level、机器 label 不回落引擎名。
- 后端**必须**覆盖：成员 schema 接受并存取两键、迁移可升级、影子派发透传（指定/未指定两态）、快照组装存真实模型名。

#### 场景：主路径

Given 本变更前后端触达面
When 运行前端 vitest 相关文件与 backend pytest daemon/group 相关面
Then 新增用例全绿、存量零回归、typecheck/ruff 零告警

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/group-chat/__tests__/member-panel-config.test.tsx「成员配置块渲染供应商/模型/思考等级/档案四选并级联」
FR-02: frontend/src/components/group-chat/__tests__/member-panel-config.test.tsx「机器下拉无别名时显示主机名不回落引擎名」
FR-03: backend/app/modules/daemon/tests/test_group_member_model_thinking.py「成员模型与思考等级存储及影子派发透传」
FR-04: backend/app/modules/daemon/tests/test_group_member_model_thinking.py「回归面」+ frontend/src/components/group-chat/__tests__/member-panel-config.test.tsx「提交payload」
