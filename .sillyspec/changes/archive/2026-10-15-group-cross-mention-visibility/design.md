---
author: qinyi
created_at: 2026-10-15 11:54:40
generated_by: sillyspec-design-init
scale: "large"  # Step 8 规模评估：跨 backend(agent 模型/迁移 + daemon group 子域 + run_sync 桥接) 与 frontend(设置控件/向导/api-types)，含 schema 变更与投影状态机分支，单上下文吞不下须 Wave 编排
---

# 设计文档（Design）— 2026-10-15-group-cross-mention-visibility

## 背景

群聊互 @（agent 回复中 @ 另一 agent 成员）自 2026-09-10 起默认私聊化（D-005@2026-09-10）：被 @ 成员的回复定向注入发起方影子会话、不进群时间线，投影层按 `dm_target` 硬拦截。该决策解决了「分歧讨论污染群时间线」的问题，但代价是**协作过程对群完全不可见**——用户和其它成员只能看到群里"死寂"，看不到 agent 之间的任务流转与结果，群聊的多 agent 协作价值被削弱。

对 DS Bot（Fei2411/DeepSeek-Bot）源码级调研（父会话完成）验证了「公开委派」模式的可行性：委派成员的**最终结果**进群、过程留私有通道，配合防刷屏与护栏约束，既可见又不污染。本变更为互 @ 引入可配置的「协作可见性」模式，让群主按群选择私聊化或公开委派。

## 设计目标

1. 群设置新增互 @ 模式 `cross_mention_mode`（`private`|`public`），控制 agent 互 @ 协作的可见性语义；
2. `public` 模式下：被 @ 成员的最终回复经 [[GROUP]] 标记投影进群时间线，过程内容仍留影子会话；
3. 结果回流：投影进群的同时向发起方影子会话纯注入一条轻通知（不触发新运行）；
4. 复用现有投影管线与全部防环护栏（链深/同链同成员次数/限频/Redis fail-closed），公开模式不放宽任何护栏；
5. 私聊化路径（`private`）行为零回归，存量群升级后行为完全不变。

## 非目标

- **不做过程进度播报**（DS Bot 式阶段性 [[GROUP]] 多段播报 + 短句合流窗口）——留作后续独立增量（D-003）；
- **不做结果后自动触发发起方接话**（DS Bot askedBy 自动应答语义）——控制权留在用户（D-004）；
- 不改动用户直接 @ 多成员的并行触发语义、consensus 汇总模式、影子直聊、typing/presence 等既有行为；
- 不做双写（群投影 + 发起方 DM 完整注入并存，方案 B 已否决 D-009）；
- 不做护栏参数调整（沿用现值：链深默认 4、同链同成员 2 次、6 次/60s）。

## 拆分判断

单一功能模块（group 互 @ 子域）纵向切分（模型→触发→投影→UI），模块间强耦合（同一轮型标记贯穿触发与投影），不可独立交付，不拆分；任务数为个位数的模式化改动，非批量模式。

## 总体方案

### 规模与 Wave 证据（scale=large 依据）

- **可真并行任务簇**（契约已由 §接口定义 钉死，互不等待）：task-02（触发三态分流）∥ task-03（投影与回流）∥ task-04（前端设置面），仅 task-01（模型/DTO/迁移）为其共同前置；
- **多阶段治理需求**：schema 变更 + 跨模块（agent 模型 / daemon group 子域 / run_sync 桥接 / 前端）+ 投影状态机新分支，属 CLAUDE.md 规则 3「新功能必须走完整流程」范畴，需 plan 期独立展开任务细节与验证探针、execute 期分任务 TDD 治理；同域先例（2026-09-10-group-agent-direct-chat 同规模群聊变更）均走五阶段；
- 单会话直行需同时携带 17 文件清单 + 六组测试锚点 + 双端 gen:types 义务 + grill 修正案上下文，配合上述并行簇，按 Wave 编排优于单会话串行。

### Phase 1｜数据模型与 DTO（backend/agent 模块）

`AgentGroupChat` 新增 `cross_mention_mode` 列（`String(16)`，server_default `'private'`，CHECK 约束限定两值）；alembic 加列迁移（项目未上线、数据可清空，无历史兼容负担）。`GroupChatCreate`（可选字段，默认 private）、`GroupChatUpdate`（可选字段）、`GroupChatRead`/`GroupChatListItemRead`/`GroupChatDetailRead`（回读）透传。行为判定优先级固定为：**总开关 `agent_cross_mention` 关 → 模式无效果（互 @ 纯文本，现状）→ consensus_mode 开 → consensus 语义接管（D-005 互斥）→ mode=public → 公开委派**。

### Phase 2｜触发分流（daemon/group/mentions.py）

互 @ 检测命中、护栏三层判定（**分流之前**，两模式共用计数、互不放宽；实证：护栏块 mentions.py:403-453 先于触发参数构造 :460-486）通过后，按**三态优先级**分流（D-011，堵「consensus 任务进行中群主切 public」的泄漏窗口——现路径本就按源轮 consensus_task_id 优先记 `dm_kind='consensus'`，mentions.py:460-469）：

1. **源轮 `consensus_task_id` 非空** → consensus 协作轮型（现状零改动，带 dm_target、投影拦截）——**优先于群模式**；
2. 群 `cross_mention_mode='public'` → 新 `ROLE_PROMPT_AGENT_PUBLIC`（helpers.py 新常量，指示语义：「{发起方} 委派给你的任务；给群看的结论用 [[GROUP]] 标记包起，将直接进群；其余过程内容不进群」）+ `turn_overrides` 携 `dm_kind='agent_public'` 与 `asked_by_member_id`（发起方成员 id，供回流），**不携带 dm_target**（天然绕过 `projection_blocked` 的 dm_target 判定，group_bridge.py:83-85，谓词零改动放行——评审 X2 实证）；
3. 其余（`private`）→ 现路径原样：`ROLE_PROMPT_AGENT_DM` + `dm_target_member_id` + `dm_kind='agent_dm'`（mentions.py:457-484 现状零改动）。

### Phase 3｜投影与回流（run_sync/group_bridge.py + group/service/messages.py）

- `_GroupBridgeContext`（group_bridge.py:237；design 前稿误写类名 TurnGroupMeta，实为该上下文结构，:54-76 的 dm_target/dm_kind 字段在其上）识别 `dm_kind='agent_public'`；`projection_blocked` 谓词维持拦 `agent_dm`（dm_target 非空）与 consensus 协作轮（现状），**放行 `agent_public` 轮**（无 dm_target 天然绕过，谓词零改动）：走 [[GROUP]] 标记抽取（:163）+ @ 轮无标记兜底（:304）现有管线，投影行 metadata 带 member 身份与 `delegation_of`（发起方成员名，前端可显示「受 X 委派」标签）。
- 收口钩子（`_close_group_hooks`，completed 时，group_bridge.py:427）在投影行落库后，向发起方影子会话**追加一条轻通知日志行**（D-004@v2：新增 `_inject_delegation_notice` 纯写日志 helper——评审 UB-1 实证 `send_direct_message`（messages.py:732）为触发语义〔新建群载体 run :806-818 + busy_strategy=inject :848-849〕，无可抽取的「只插行不触发」对应物，故不复用该函数）：直接向发起方**影子会话**（非群载体 run——载体 run 恒挂群会话，术语修正）最近 run 追加 `AgentRunLog(channel='user_input', metadata={'delegation_notice': True, ...})`，不建 run、不入队、不派发、不走 prepare_interactive_dispatch；注入失败**静默降级**（投影已达成可见性主目标），记 structlog warning。计入**同链通知上限**（同链同成员 2 次口径，DB metadata 与 Redis 双轨——沿链深护栏双轨先例 mentions.py:394-453，防 Redis TTL 1800s 过期归零，评审 P2 备注收口）。
- 打断（run 非 completed）：零注入（挂接点仅在 completed）；流式已投影内容不撤回——[[GROUP]] 段投影发生在 submit 流式双写（与 run 终态无关，普通 @ 轮同款现状），D-007@v2 修正语义（grill 后执行期实证）。

### Phase 4｜前端

- `member-panel.tsx` 群设置区（consensus 块旁，:362-402 同构模式）：新增「互 @ 模式」控件（私聊化/公开委派 **antd Button 对 + aria-pressed**——antd Radio.Button 的 cssinjs 组合选择器在 jsdom nwsapi 下抛 SyntaxError 级联炸渲染，执行期二分定位后改 Button 对，功能等价），三态联动——总开关关时禁用 + 「需先开启 agent 互 @」提示；consensus_mode 开时禁用 + 「汇总模式下由收口人统一发言」互斥提示。
- `create-group-wizard.tsx` 第三步护栏区（:414 附近）：同款可选项，默认 private（D-002）。
- 公开委派结果行复用现有投影行渲染（member_id 分色气泡）零新组件；`delegation_of` metadata 预留气泡副标签（「受 X 委派」），渲染为可选增强不阻塞主链。
- `pnpm gen:types`（frontend）+ `pnpm -C sillyhub-daemon gen:types` 同变更内跑并提交（CLAUDE.md 规则 21 义务）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/agent/model.py | AgentGroupChat 新增 cross_mention_mode 列（String(16)，server_default 'private'，CHECK）；producer=模型列 → 迁移 DDL → consumer=群读取侧判定 |
| 新增 | NEW:backend/migrations/versions/<rev>_add_group_cross_mention_mode.py | 加列迁移（数据可清空，直加列无回填） |
| 修改 | backend/app/modules/agent/schema.py | GroupChatCreate/Update/Read 加 cross_mention_mode 字段；producer=DTO → router PATCH/POST 透传 → consumer=service 写列；回读链 model → GroupChatRead → 前端 api-types |
| 修改 | backend/app/modules/daemon/group/service/crud.py | 写体透传两处：create_group_chat 的 AgentGroupChat 构造与 update_group_chat 的 if-None 局部更新；读体经 GroupChatRead 基类 model_validate 自动透出（router 子类继承零改动） |
| 修改 | backend/app/modules/daemon/group/service/helpers.py | 新增 ROLE_PROMPT_AGENT_PUBLIC 常量（公开委派角色指令，含 [[GROUP]] 标记要求） |
| 修改 | backend/app/modules/daemon/group/service/mentions.py | 互 @ 触发三态分流：源轮 consensus_task_id 优先（现状）→ public 分支写 dm_kind='agent_public' + asked_by_member_id（无 dm_target）→ private 现路径；护栏判定保持在分流前 |
| 修改 | backend/app/modules/daemon/run_sync/service/group_bridge.py | _GroupBridgeContext 增 agent_public 分支；projection_blocked 放行该轮；收口钩子追加发起方轻注入 |
| 新增 | NEW:backend/app/modules/daemon/group/service/delegation_notice.py | _inject_delegation_notice 纯日志注入 helper（向发起方影子会话最近 run 追加 delegation_notice 行；不建 run/不入队/不派发；失败静默降级记 warning；同链通知上限 DB+Redis 双轨）——评审 UB-1 定论：send_direct_message 为触发语义无可抽取对应物，故独立新文件 |
| 修改 | backend/app/modules/agent/tests/test_group_chat_models.py | 新列默认值/CHECK 断言 |
| 修改 | backend/app/modules/daemon/tests/test_group_cross_mention.py | 分流断言（public 群 agent_public 无 dm_target / private 群零回归）+ 护栏两模式同源计数断言 + 轻注入落点断言 |
| 修改 | backend/app/modules/daemon/tests/test_group_bridge_projection.py | agent_public 轮投影矩阵（[[GROUP]] 进群/无标记兜底/thinking 不进/agent_dm 拦截不变）+ 打断轮零副作用 |
| 修改 | frontend/src/components/group-chat/member-panel.tsx | 群设置区新增互 @ 模式 Radio（三态联动禁用 + 互斥提示） |
| 修改 | frontend/src/components/group-chat/create-group-wizard.tsx | 第三步护栏区新增模式可选项（默认 private） |
| 修改 | frontend/src/components/group-chat/__tests__/member-panel.test.tsx | 控件三态联动测试 |
| 修改 | frontend/src/lib/api-types.ts | pnpm gen:types 再生成（schema 变更同步，规则 21） |
| 修改 | backend/openapi.json | gen:types 副产物同步提交 |
| 修改 | sillyhub-daemon/src/api-types.ts | pnpm -C sillyhub-daemon gen:types 再生成（规则 21 daemon 义务） |

## 接口定义

本变更接口面：0 端点（无新端点；既有群 CRUD/PATCH 契约加字段 cross_mention_mode，经 gen:types 双端对齐）

- `AgentGroupChat.cross_mention_mode: Mapped[str]`（`'private'|'public'`，default `'private'`）
- `GroupChatCreate.cross_mention_mode: Literal['private','public'] | None = None`（None → private）
- `GroupChatUpdate.cross_mention_mode: Literal['private','public'] | None = None`（None → 不变）
- 回读体（Read/ListItem/Detail）：`cross_mention_mode: Literal['private','public']` 恒透出
- `ROLE_PROMPT_AGENT_PUBLIC = "..."`（helpers.py 常量；含发起方名、委派语境、[[GROUP]] 标记要求、过程不进群约束）
- `turn_overrides` 新键：`dm_kind='agent_public'`、`asked_by_member_id: str`（public 轮）；`agent_dm` 轮键位不变；分流判定顺序=源轮 consensus_task_id > 群 cross_mention_mode（D-011）
- 轻注入行：`AgentRunLog(channel='user_input', metadata={'delegation_notice': True, 'delegated_member_name': str, 'chain_run_id': str})` 落**发起方影子会话**最近 run（`_inject_delegation_notice` 新 helper，D-004@v2）
- 投影行 metadata 增 `delegation_of: str | None`（发起方成员名，public 轮才带）

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| 互 @ 委派触发（public 群） | group_bridge 收口钩子 | 被委派成员影子会话 | asked_by_member_id, dm_kind='agent_public', 链 metadata（chain/depth/source/sender） | 影子会话新轮（排队/steering，复用现触发管线） |
| 委派轮收口投影 | run_sync submit_steps | 群载体 run | member_id, member_name, delegation_of, [[GROUP]] 段/兜底文本, 投影标记 | AgentRunLog 追加投影行（stdout） |
| 轻通知注入 | group_bridge 收口钩子 | 发起方影子会话 | delegation_notice, delegated_member_name, chain_run_id | AgentRunLog 追加注入行（不建 run、不占队列） |
| 成员打断 | 用户（interrupt 端点） | 被委派成员影子 run | member_id | run → interrupted（非 completed）：零投影零注入 |

（本表为变更内部事件契约；不涉及 daemon↔backend 新增 RPC/lease 生命周期。）

## 数据模型

`agent_group_chat` 表加列 `cross_mention_mode VARCHAR(16) NOT NULL DEFAULT 'private'` + CHECK 约束 `cross_mention_mode IN ('private','public')`。无其它表变更；无数据回填（新列默认即存量语义等价值）。

## 兼容策略（brownfield 必填）

- **存量群零变化**：新列 server_default 'private'，存量行读取即为 private，互 @ 行为与升级前逐比特一致（D-002）；
- **未开启公开模式的群**：触发分流走 private 分支 = 现路径原样（同函数同参数），护栏、consensus、直聊、投影拦截全部不动；
- **回退路径**：群主把模式切回 private 即回退；字段级回退 = UPDATE 置 'private'（无 schema 回退需求，数据可清空）；
- **不改变的 API/表结构**：互 @ 相关既有端点、`agent_cross_mention`/`cross_mention_depth`/限频参数、consensus 表、影子会话表均零改动；`send_direct_message` 端点行为不变（仅内部 helper 抽取重构）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 轮型分流漏判：public 群互 @ 仍走私聊（或反之），可见性语义错乱 | P0 | 触发分流单测双断言（public 群 agent_public 无 dm_target / private 群现路径断言不变）；投影矩阵测试钉死两种轮型 |
| R-02 | 轻注入行在长链多委派下无限累积，膨胀发起方影子会话上下文 | P1 | 注入行计入同链通知上限（同链同成员 2 次口径，超限丢弃）；计数 DB metadata + Redis 双轨（沿链深护栏双轨先例，防 Redis TTL 1800s 过期归零）；**Redis 不可用 fail-open 放行**（通知上限是防膨胀软约束非防环红线，与互@护栏的 fail-closed 刻意相反——execute 验收评审回记） |
| R-03 | 轻注入原语无现成实现可复用（send_direct_message 为触发语义，评审 UB-1 实证），新 helper 的落库形态若与影子会话日志装配器（session-log-assembler）口径不符，前端成员会话视图可能出现异常行 | P1 | 已升级为独立任务 NEW:delegation_notice.py + 接口定义钉死字段；execute 期核对注入行与影子会话日志读取口径（timeline_reads / session-log-assembler 的 channel 过滤），单测断言注入行可被成员会话视图正常渲染 |
| R-04 | [[GROUP]] 无标记兜底把过程性文本带进群，复现「污染时间线」 | P1 | 兜底仅取首段 200 字摘要 + 「完整内容见成员会话」提示（现状口径 ：304 不放宽）；公开轮 role_prompt 强化标记要求 |
| R-05 | UI 原型跳过导致设置控件与平台双主题（blue/ai-native）样式不符 | P2 | 控件用 antd Radio.Group + 品牌语义类名（brand-*），照 FRONTEND_PAGE_STYLE.md §0.5 主题规范实现；跳过依据=标准组件紧邻同构开关（typing_preview/consensus），用户可否决要求补原型 |
| R-06 | D-002/D-003/D-004 为 AI 裁定待否决项，用户事后否决任一项将牵动设计 | P1 | proposal.md 显式列「可否决项」清单；否决走 D-xxx@v2 supersede 修订，方案 A 架构（轮型分流+投影放行）对三者的替代值均兼容（B/C 为叠加增量） |
| R-07 | 无长驻进程/外部资源，生命周期面不适用 | — | 本变更不引入后台任务/句柄/子进程；轻注入为收口钩子内同步动作，无 watcher |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | §总体方案 Phase 1（模型+优先级）、§数据模型、§接口定义 | 已覆盖 |
| D-002@v1 | §兼容策略（存量零变化）、Phase 4（向导默认 private） | 已覆盖（AI 裁定待否决） |
| D-003@v1 | §非目标（不做进度播报）、Phase 3（只投影最终结果）、R-04 | 已覆盖（AI 裁定待否决） |
| D-004@v1 | Phase 3（轻注入不触发）、§生命周期契约表（轻通知注入行）、R-02 | 已覆盖（AI 裁定待否决；v2 修正注入原语实现路径） |
| D-005@v1 | Phase 1（优先级链 consensus 接管）、Phase 4（互斥禁用提示） | 已覆盖 |
| D-006@v1 | Phase 2/Phase 3（轮型分流+投影谓词放行）、R-01 | 已覆盖 |
| D-007@v1 | Phase 3（打断零副作用）、§生命周期契约表（成员打断行） | 已覆盖（v2 修正：零注入成立，零投影修正为流式不撤回） |
| D-008@v1 | §总体方案整体（方案 A 定稿） | 已覆盖（AI 裁定待否决） |
| D-009@v1 | §非目标（不做双写） | 已覆盖（rejected 留档） |
| D-010@v1 | §非目标（不做进度播报+自动接话） | 已覆盖（rejected 留档） |
| D-004@v2 | Phase 3（_inject_delegation_notice 新原语）、§接口定义、R-03 | 已覆盖（design-grill 修正：不复用 send_direct_message） |
| D-011@v1 | Phase 2（三态分流优先级：源轮 consensus_task_id > 群模式） | 已覆盖（design-grill 新增：堵 consensus 进行中切模式的泄漏窗口） |

未解决项：D-002/D-003/D-004/D-008 四条 AI 裁定待用户否决窗口（R-06）；无其它未决风险。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale）
- [x] 引用所有当前版本 D-xxx@v1（D-001~D-010 全部入追踪表）
- [x] 涉及生命周期关键词（session/complete）→ 已含生命周期契约表
- [x] UI 原型分级核对：跳过——组件级标准控件（antd Radio）紧邻同构开关、页面骨架零变化，依据记入 R-05（用户可否决要求补）
- [x] 不确定问题标注：「⚠️ 自审存疑」R-03（轻注入载体身份口径，execute 期核对）
