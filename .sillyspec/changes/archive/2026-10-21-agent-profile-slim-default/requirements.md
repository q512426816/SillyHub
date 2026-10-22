---
author: flow-machine-draft
created_at: 2026-10-21T04:10:58.640Z
---
# 需求规格（Requirements）— 2026-10-21-agent-profile-slim-default

## 功能需求

### FR-01: 档案表单仅 名称/可见范围/系统提示词/技能勾选 四项，无工作区上下文/引擎/模型/供应商/工具策略/MCP 字段，右栏预览同步

- 档案新建/编辑表单**必须**仅保留 名称、可见范围、系统提示词、技能勾选 四个字段；工作区上下文选择器、智能体引擎、模型、供应商配置、工具策略、MCP 勾选**必须**从表单移除；右栏实时预览**必须**同步（只显示保留字段）；提交 body 中被删字段的引用（tool_policy_id/mcp_refs）**必须**落空值（null/[]），引擎字段由后端缺省补齐（前端不传）。存量档案已存的被删引用**可以**保留在库（读侧忽略，编辑保存自然清空），**禁止**数据迁移或删列。

#### 场景：新建瘦身表单

- Given：全局页 /agent-profiles 或工作区内页打开新建
- When：表单渲染并提交
- Then：仅四字段可见可填；保存成功且不再要求选择工作区上下文（private 档案无需 ws sourcing——技能勾选为用户级数据源）

#### 场景：编辑存量档案

- Given：存量档案带 mcp_refs=['x']/tool_policy_id=某id/model='m'
- When：打开编辑并保存
- Then：表单不显示这些字段；保存后这些引用被清空（null/[]），无报错

### FR-02: 档案卡片有「设为默认」操作与默认标记，每用户至多一个默认档案

- 档案列表/卡片**必须**提供「设为默认」操作（文案与供应商侧统一），已设默认的档案**必须**显示默认标记并可「取消默认」；默认粒度为**每用户一个**（用户级存储，非档案行级——档案跨用户共享，行级标记会串台）；设默认的档案**必须**对操作者可见（可见性校验）；被删/失可见的默认档案**必须**自动回落无默认（不阻断会话创建）。

#### 场景：设默认与互斥

- Given：用户有档案 A（已默认）与 B
- When：对 B 点「设为默认」
- Then：B 成为该用户唯一默认，A 标记消失

#### 场景：默认档案被删

- Given：用户默认档案为 A
- When：A 被删除
- Then：用户默认回落无默认（FK SET NULL），后续会话创建零注入不报错

### FR-03: 创建会话与群聊成员未显式选档案时注入用户默认档案（人格+技能）；未设默认行为与现状逐字节一致

- 会话创建（/sessions、悬浮面板预会话）与群聊 agent 成员影子会话懒建时，未显式选档案且用户已设默认档案**必须**注入该默认档案（走既有 `apply_session_profile_to_lease` 提示词维度变体：system_prompt + mcp_refs/skill_refs）；未设默认**必须**与现状逐字节一致（零注入）；显式选择档案的行为**禁止**变化（显式失效仍显式报错，默认失效静默回落——默认是软偏好）。群聊成员的默认档案取**群主（影子会话 user_id=group.created_by）**的默认。

#### 场景：会话默认注入

- Given：用户默认档案 D（system_prompt='人格X'，skill_refs=['s1']）
- When：创建会话未显式选档案
- Then：lease.metadata 含 system_prompt='人格X' 与 skill_refs=['s1']，与会话 config_snapshot 记 profile_name=D.name

#### 场景：无默认零回归

- Given：用户未设默认档案
- When：创建会话未显式选档案
- Then：lease.metadata 无档案键，行为与现状逐字节一致

#### 场景：群聊成员默认注入

- Given：群主默认档案 D，某 agent 成员建群时未选档案
- When：该成员影子会话首次懒建
- Then：影子会话 lease 注入 D 的提示词维度字段

### FR-04: 选档案会话只挂档案技能子集，档案技能为空则不挂任何技能；未选档案且无默认时技能全量挂载（现状）

- 会话/群聊影子会话 spawn 时，claim payload 携带 skillRefs（含空数组）**必须**严格按档案技能挂载：非空=只保留勾选子集，空=**清空技能**（不挂任何技能）；claim payload 不含 skillRefs 键（旧 lease/未选档案且无默认）**必须**维持全量挂载现状。daemon 会话路径（interactive skillsStep）**必须**补裁剪执行点（现仅 batch 任务路径有）；技能裁剪**禁止**越出 `<cwd>/.claude/skills/` 目录。运行中会话热切换档案时**可以**不重挂技能（v1 边界：裁剪仅在建会话 spawn 链生效）。

#### 场景：空技能档案清空挂载

- Given：档案 D skill_refs=[] 且为用户默认
- When：创建会话（未显式选档案）
- Then：daemon spawn 后 `<cwd>/.claude/skills/` 下无平台/用户技能目录

#### 场景：旧 lease 兼容

- Given：旧 lease metadata 无 skill_refs 键
- When：daemon 处理其 claim
- Then：不裁剪，全量挂载（现状不变）

### FR-05: 既有档案数据不迁移不删列，被删字段读侧忽略；后端 llm_provider/claim 注入链零触碰

- 本变更**禁止**迁移或删除 AgentProfile 既有列（provider/model/llm_provider_id/tool_policy_id/mcp_refs/allowed_roots_overlay 原样保留）；读侧（会话/群聊注入路径）**必须**忽略被删字段；后端 `llm_provider` 模块与 claim 供应商注入链（`_inject_provider_config`）**禁止**触碰。

#### 场景：读侧忽略

- Given：存量档案 provider='codex'/model='x'/mcp_refs=['y']
- When：该档案被默认/显式注入会话
- Then：仅 system_prompt/skill_refs（及 mcp_refs 既有透传）生效，provider/model 不影响会话引擎与模型

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/__tests__/agent-profile-form.test.tsx「表单仅渲染四字段」「编辑存量档案保存清空被删引用」「新建无需选工作区上下文」
FR-02: backend/app/modules/agent/tests/test_profile_router.py「set-default/unset-default 端点与互斥」；frontend/src/components/agent-profile/__tests__/agent-profile-card.test.tsx「设为默认操作与默认标记」
FR-03: backend/app/modules/daemon/tests/test_session_default_profile.py「默认注入/无默认零回归/失可见回落」；backend/app/modules/daemon/tests/test_group_default_profile.py「影子会话群主默认注入/无默认保持 None」
FR-04: sillyhub-daemon/tests「会话 skillsStep 按档案裁剪/空数组清空/无键全量」（动码时落位，参照 task-runner.test.ts prune 用例范式）
FR-05: 不适用：读侧忽略由 FR-03 注入测试锚定（断言 provider/model 不进 lease）；零触碰由 diff 声明面核对（llm_provider 模块零文件改动）
