---
author: WhaleFall
created_at: 2026-08-14 23:10:00
change: 2026-08-14-sessions-portal
---

# 决策台账（Decisions）

> 本变更的决策台账，仅记录有实现/验收影响的决策。继承变更 `2026-08-14-runtime-session-agent-profile-link`（已停用）的决策以「原 D-xxx」引用，不重新编号。

## D-001@v1 — 新开变更，停用原「档案接会话」变更

- **type**: scope / process
- **status**: accepted
- **source**: 用户（AskUserQuestion 第 1 轮）
- **question**: 本需求与已有变更 `2026-08-14-runtime-session-agent-profile-link`（四件套已写、未实现）如何组织？
- **answer**: 新开本变更承载完整需求（会话总入口页面 + 多维配置 + 全配置热切换）；原变更停用（superseded），其已确认决策（原 D-001 档案会话隔离 / 原 D-002 同引擎切换 / 原 D-005 UI 去引擎模型字段 / 原 D-006 reloadWithProfile / 原 D-007 切换消息原子化 / 原 D-004@v2 profile.model 生效 / 原 D-003 Codex 人格一期不注入）全部带入本变更作为基础。
- **impacts**: 全局；§11 决策追踪
- **evidence**: 用户选择"新开变更（推荐）"。
- **priority**: P0

## D-002@v1 — /runtimes 会话弹窗保留并存

- **type**: scope
- **status**: accepted
- **source**: 用户（AskUserQuestion 第 1 轮）
- **question**: 新页面成为会话总入口后，/runtimes 的会话弹窗去留？
- **answer**: 保留并存。/runtimes 仍是运维视角（机器/运行时管理），其会话弹窗（RuntimeSessionDialog）不动、零回归；新页面为会话主入口。两处共用底层会话 API。
- **impacts**: 兼容策略 §9；InteractiveSessionPanel 改造采用「抽共享子组件」而非原地改（避免动弹窗）
- **evidence**: 用户选择"保留并存（推荐）"。
- **priority**: P0

## D-003@v1 — 会话列表 = 所有会话 + 虚拟滚动 + 筛选

- **type**: UX
- **status**: accepted
- **source**: 用户（AskUserQuestion 第 1 轮）
- **question**: 左侧会话列表展示哪些会话？
- **answer**: 跨所有机器/智能体的全部会话（含已结束/失败，可只读浏览历史）；列表虚拟滚动支撑大量会话；筛选：引擎胶囊 tab（全部/Claude/Codex）+ 状态下拉（全部/活跃/已结束）+ 机器多选胶囊 + 标题搜索（回车触发）。
- **impacts**: FR-02；后端列表 API 加过滤参数
- **evidence**: 用户"所有会话，并虚拟滚动。并且最好加几个查询条件，可以按机器和智能体引擎查询（也不一定是查询条件，帮我设计的好看一点）"。
- **priority**: P0

## D-004@v1 — 配置切换边界：同机同引擎热切换

- **type**: scope / architecture
- **status**: accepted
- **source**: 用户（AskUserQuestion 第 1 轮）
- **question**: 「所有配置都能切换且不结束会话」的边界？
- **answer**: 会话进行中可热切换：**档案 / 供应商 / 同机同引擎智能体**（历史无缝保留、会话不中断）；**换机器 / 换引擎（Claude↔Codex）= 需开新会话**。切换仅当前轮次完成后（idle）允许，运行中置灰锁定。跨机器切换作为二期增强（数据模型预留，UI 下拉展示其它机器但置灰标「二期」）。
- **impacts**: FR-04/FR-05/FR-06；§7.3 WS 消息；R-01
- **evidence**: 用户"采用1，跨机器作为后续更新"；技术事实（daemon 是 per-machine 进程，jsonl 历史在本机）。
- **priority**: P0

## D-004@v2 — 切换边界：档案/供应商可切，机器/智能体纯展示

- **type**: scope / architecture
- **status**: accepted
- **supersedes**: D-004@v1
- **source**: design-grill（C-02）
- **question**: D-004@v1 称可切「同机同引擎智能体」，该目标是否存在？
- **answer**: 不存在。runtime 注册按 `(daemon_instance_id, provider)` upsert（`runtime/service.py:244-289`），**每机每引擎唯一 runtime**，「同机同引擎切换」无目标（永假）。修正为：会话内可热切**档案、供应商**；机器/智能体控件纯展示（下拉展示可选项但整体置灰：跨机器标「二期」、跨引擎标「需开新会话」）。换机器/换引擎=开新会话；跨机器切换仍留二期。切换仍仅 idle 允许。
- **normalized_requirement**: FR-05 改为档案/供应商可切 + 机器/智能体展示；SESSION_SWITCH_CONFIG payload 无 runtime 字段（自证）。
- **impacts**: FR-05/FR-06、§7.2、SessionConfigBar
- **evidence**: Grill C-02（model.py:120 docstring + WS payload 设计自证）。
- **priority**: P0

## D-005@v1 — 默认机器 = 最近会话 + 记住上次

- **type**: UX
- **status**: accepted
- **source**: 用户（AskUserQuestion 第 2 轮）
- **question**: 新建会话时多个在线机器，默认选哪个？
- **answer**: 默认 = 最近有活跃会话的在线机器（按最近会话时间排序，无可会话机器时按心跳递补）；同时 localStorage 记住用户上次选择的机器，有记忆时优先。
- **impacts**: FR-01；NewSessionForm 默认值逻辑
- **evidence**: 用户选择"最近会话+记住上次（推荐）"。
- **priority**: P1

## D-006@v1 — 会话列表条目 = 紧凑两行

- **type**: UX
- **status**: accepted
- **source**: 用户（AskUserQuestion 第 2 轮）
- **question**: 列表信息密度？
- **answer**: 紧凑两行：第 1 行 = 状态点 + 标题（截断）+ 相对时间；第 2 行 = 机器 chip + 引擎 chip + 档案 chip + 供应商 chip + 轮数 chip。完整配置在右侧面板看。
- **impacts**: FR-02
- **evidence**: 用户选择"紧凑两行（推荐）"。
- **priority**: P1

## D-007@v1 — 配置切换 UI = 样式 B（输入框下控件条）

- **type**: UX
- **status**: accepted
- **source**: 用户（原型两轮迭代）
- **question**: 会话进行中四个配置的展示与切换交互？
- **answer**: CCGui 式：配置收进**输入框下方左下角一行紧凑控件条**（🖥机器 | ⚡智能体 | ☁供应商 | 📋档案 四个小控件），idle 可点开各自下拉切换，running 置灰 + 「本轮完成后解锁」提示。样式 A（顶部配置条）废弃不实现。
- **impacts**: FR-05；SessionConfigBar 组件
- **evidence**: 用户"会话进行中用样式B"+ 参考 frontend/public/img.png（IDEA CCGui 插件左下角控件）。
- **priority**: P0

## D-008@v1 — 每轮配置快照，历史消息不跟随变

- **type**: behavior / data-model
- **status**: accepted
- **source**: 用户（原型反馈）
- **question**: 切换配置后，历史消息显示的配置信息要不要跟着变？
- **answer**: 不跟随。每轮回复的 who 行显示**该轮实际生效的配置**（`📋 档案 · 智能体 · ☁ 供应商`），数据来自每轮 AgentRun 的配置快照；切换只影响后续轮次。复用既有 `AgentRun.agent_profile_snapshot` 机制并补供应商维度。
- **impacts**: FR-07；§8 数据模型（AgentRun 快照含 llm_provider）
- **evidence**: 用户"切换平台、供应商、档案等这些的时候，旧会话的 title 还是之前那个会话用的什么配置的信息，不要变成新的"。
- **priority**: P0

## D-009@v1 — 输入框上方：上下文用量环 + 供应商额度胶囊

- **type**: UX
- **status**: accepted
- **source**: 用户（原型反馈）
- **question**: 上下文用量与模型额度怎么展示？
- **answer**: 输入框上方一行：左侧 28px **上下文用量环形进度**（<50% 蓝 / 50-80% 黄 / ≥80% 红，点击详情 `10.0% · 107.8k / 1000k`）+ **当前模型剩余额度胶囊**（如 GLM：5 小时剩 18% · 本周剩 45% · ⏱ 今天 02:00 重置，点击详情）。额度数据**跟当前供应商联动**：供应商提供额度信息才显示胶囊，未提供显示灰字提示或留空；不指定供应商（本机默认）不显示。
- **impacts**: FR-08；§5 Wave1（额度查询为弱依赖，一期仅 GLM）；CtxUsageRing/QuotaPill 组件
- **evidence**: 用户"对话框左上方再加一个上下文用量简单显示10%做成环形进度那种也行，点击后显示详情…然后再加一个当前模型剩余额度。如glm的，5小时剩余，周剩余，还有重置时间。没有的就不显示"+ 后续修正"是输入框上面加一行显示…额度跟供应商联动"。
- **priority**: P1

## D-010@v1 — 新建会话四选择器联动规则

- **type**: UX / behavior
- **status**: accepted
- **source**: 用户需求 + 原型确认
- **question**: 守护进程/智能体/供应商/档案四个选择器如何联动？
- **answer**: ①守护进程（必选）：仅在线机器可选，离线置灰；默认值见 D-005。②智能体（必选）：所选机器的在线 runtime，默认 Claude Code；不支持会话的 provider（非 claude/codex）置灰标「暂不支持会话」；切机器重置为默认。③供应商（可选）：不选 = 守护进程本机供应商配置（现状行为）；仅 Claude 引擎可选（平台暂只支持 claude 供应商），选 Codex 智能体时锁定。④档案（可选）：跨工作区全部可见档案（scope=mine 聚合），按所选引擎过滤，跨引擎置灰。原「智能体提供方/智能体模型」字段移除（继承原 D-005）。
- **impacts**: FR-01/FR-03
- **evidence**: 用户需求原文 + 原型交互确认。
- **priority**: P0

## D-011@v1 — 技术路线：扩展现有会话域（方案 A）

- **type**: architecture
- **status**: accepted
- **source**: 用户（step4 方案选择）
- **question**: 实现路线？
- **answer**: 方案 A：`AgentSession` 加配置列（llm_provider_id/agent_profile_id/快照），机器/智能体经既有 runtime_id 推导不重复建列；切换复用 daemon 热切换内核（reloadWithProvider 模式）扩展；右侧复用既有交互式会话能力（抽共享子组件）；新 /sessions 页面 + 侧边栏一级菜单。不新建独立会话域。
- **impacts**: 全局；§5
- **evidence**: 用户选择"方案 A（推荐）"。
- **priority**: P0

## D-013@v1 — 会话路径档案 = 提示词 + 技能，不关联引擎/模型/供应商

- **type**: scope / data-model
- **status**: accepted
- **source**: 用户（Design Grill C-03 拍板）
- **question**: 不选会话供应商但档案自带绑定供应商时用谁的？档案的引擎/模型关联在会话里还算数吗？
- **answer**: **不选供应商 = 一律本机默认（压制档案绑定）**。且会话路径里档案只贡献 system_prompt（提示词）+ mcp_refs/skill_refs 透传——档案的 `provider`/`model`/`llm_provider_id` 字段**不参与会话派生**（引擎由智能体选择器决定、模型走供应商/默认链、供应商由供应商选择器决定）。与未来档案瘦身方向一致（"档案只做提示词+身份，不再关联智能体引擎和供应商"）。**取代原变更 D-004@v2（profile.model 生效）在本变更的适用性**——会话路径无 profile.model 派生，`_inject_provider_config` 无需 model_source 标记分支。
- **normalized_requirement**: create_session 档案只写 system_prompt 到 lease metadata；供应商优先级简化为「会话选择 > 全局默认」两级；档案选择器不做引擎过滤（Codex 智能体下档案选项标注「人格暂不支持」）；切换校验不再校验档案引擎。
- **impacts**: FR-01/FR-04/FR-06、§5 Wave1、§7.2、R-02
- **evidence**: 用户"用本机，后面档案只是做一个提示词+技能，不再关联智能体引擎和供应商这些信息了"。
- **priority**: P0

## D-014@v1 — 上下文窗口分母：供应商配置派生 + 模型默认常量表

- **type**: definition
- **status**: accepted
- **source**: 用户（Design Grill C-09 拍板）
- **question**: 用量环分母（模型窗口）从哪来？
- **answer**: 优先从供应商配置派生（用户指出供应商配置有 1M 上下文勾选——plan 阶段核实具体字段（model/extra_env/settings_config），勾选 1M → 1000k）；无则按模型默认常量表（如 200k）；再无则环不显示百分比、只显示累计 token。
- **impacts**: FR-08、CtxUsageBar
- **evidence**: 用户"供应商配置里不是有吗，看看有没有勾选1M"。
- **priority**: P2

## D-012@v1 — 切换消息统一 SESSION_SWITCH_CONFIG（原子）

- **type**: architecture / protocol
- **status**: accepted
- **source**: 继承原 D-007（SESSION_SWITCH_PROFILE 原子化）并扩展
- **question**: 档案+供应商两类切换的 WS 消息怎么设计？
- **answer**: 统一为单条 `SESSION_SWITCH_CONFIG`（backend→daemon），**原子承载**：新配置（profile 字段 + provider_config）+ 切换轮的 prompt/run_id/claim_token（单消息避免"切换+投递"双消息顺序竞态）。daemon 双路径：idle 立即 reload 后喂 prompt；running 挂 pendingConfigSwitch 至 turn 边界。reload 与 reloadWithProvider 共用 _reloadSession 内核。
- **impacts**: §7.3、§5 Wave2、R-01/R-07
- **evidence**: 原变更 Grill BLOCK-1 结论（原子投递）+ 本变更合并供应商维度。
- **priority**: P0
