---
author: qinyi
created_at: 2026-10-15 11:33:20
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 群主 | 建群用户，可切换互 @ 模式（群设置/向导）；影子会话与计量归属者 |
| 群成员（用户） | 可见群时间线（含公开委派投影行）、可打断任意成员 |
| 群成员（agent） | 互 @ 的发起方（委派者）与被 @ 方（受委派者）；轮型由群模式与三态优先级决定 |
| 系统 | 后端触发分流/投影/轻注入管线的执行者（不依赖 agent 自觉，硬驾驭语义沿用） |

## 功能需求

### FR-01: 互 @ 模式设置
覆盖决策：D-001@v1, D-002@v1, D-005@v1, D-008@v1
Given 一个已存在的群（`agent_cross_mention=true`）
When 群主在群设置（或建群向导第三步）选择互 @ 模式（私聊化/公开委派）
Then `AgentGroupChat.cross_mention_mode` MUST 持久化为所选值（默认与存量值 MUST 为 `'private'`）；总开关关闭时控件 MUST 禁用且模式字段 MUST NOT 产生行为效果；`consensus_mode=true` 时控件 MUST 禁用并提示互斥，consensus 语义 MUST 接管。

### FR-02: 公开委派触发三态分流
覆盖决策：D-006@v1, D-011@v1
Given 群内一 agent 成员回复中 @ 另一 agent 成员，护栏（链深≤群设置、同链同成员 2 次、6 次/60s、Redis 可用）全部放行
When 互 @ 触发执行（分流判定 MUST 位于护栏判定之后）
Then 分流 MUST 按三态优先级执行：①源轮 `consensus_task_id` 非空 → consensus 协作轮型（现状，带 dm_target，优先级最高）；②群 `cross_mention_mode='public'` → 轮型 `dm_kind='agent_public'` + `asked_by_member_id`，MUST NOT 携带 `dm_target_member_id`，role_prompt MUST 为公开委派指令（含 [[GROUP]] 标记要求与「过程不进群」约束）；③其余 → 现路径（`agent_dm` + dm_target）参数 MUST 与变更前逐比特一致。

### FR-03: 公开委派投影
覆盖决策：D-003@v1, D-006@v1
Given 被委派成员轮（`dm_kind='agent_public'`）收口且 run status=completed
When 投影管线执行
Then 其回复的 [[GROUP]] 段 MUST 投影为群时间线行（metadata 含 member 身份与 `delegation_of`=发起方成员名）；整轮无标记时 MUST 走首段 200 字兜底 +「完整内容见成员会话」提示；thinking/tool_use/stderr/系统行 MUST NOT 投影；`agent_dm` 轮与 consensus 协作轮的投影拦截 MUST 与现状完全一致。

### FR-04: 结果轻通知回流
覆盖决策：D-004@v2, D-007@v1
Given 公开委派投影行落库完成
When 收口钩子执行回流（`_inject_delegation_notice`）
Then 发起方影子会话 MUST 追加一条 `delegation_notice` 注入行（含被委派成员名与结果摘要首段），MUST NOT 创建 run、MUST NOT 占用会话队列、MUST NOT 触发任何 agent 运行；注入行 MUST 计入同链通知上限（同链同成员 2 次口径，DB+Redis 双轨），超限 MUST 丢弃并出群内系统行；注入失败 MUST 静默降级（投影不受影响）并记 structlog warning；被委派轮被打断（非 completed）时 MUST 零投影零注入。

### FR-05: 零回归与护栏同源
覆盖决策：D-002@v1, D-008@v1
Given 任意 private 群（含全部存量群）
When 任意互 @ 链推进、护栏计数（链深/同成员次数/限频）被读写
Then 触发参数、投影拦截、注入路径 MUST 与变更前完全一致（零回归断言）；public 与 private 两模式的护栏计数 MUST 共享同一计数器（MUST NOT 互不重置、MUST NOT 放宽任何阈值）；前端 `pnpm gen:types` 与 `pnpm -C sillyhub-daemon gen:types` MUST 在同一变更内执行并提交（api-types 对齐义务）。

## 非功能需求
- 兼容性：存量群 MUST 零变化（新列 server_default 'private'，行为等价）；未开启公开模式的群全路径零改动；模式 MAY 随时切回 private 回退。
- 可观测：轻注入行与投影行 MUST 落库可回放（MUST NOT 为 ephemeral）；超限丢弃 SHOULD 有群内系统行提示。
- 权限：模式设置 MUST 仅群主可操作（沿现有群设置权限口径）；轻注入 MUST 走服务身份（沿成员触发先例）。
- 可测试：分流/投影矩阵/轻注入/零回归/consensus 优先/打断六组后端单测 + 前端控件三态联动测试 MUST 全绿。

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 模式枚举建模，总开关优先 |
| D-002@v1 | FR-01, FR-05 | 默认 private + 存量零变化（AI 裁定待否决） |
| D-003@v1 | FR-03 | v1 只投影最终结果（AI 裁定待否决） |
| D-004@v2 | FR-04 | 轻注入纯日志 helper 不触发（supersede v1；AI 裁定待否决项随 v1 语义延续） |
| D-005@v1 | FR-01 | consensus 互斥、consensus 优先 |
| D-006@v1 | FR-02, FR-03 | 轮型分流 + 投影谓词放行 |
| D-007@v1 | FR-04 | 打断零副作用（completed 挂接天然成立） |
| D-008@v1 | FR-01~FR-05 | 方案 A 定稿（AI 裁定待否决） |
| D-009@v1 | — | rejected 留档：不做双写（无 FR 承接，防复潮通道） |
| D-010@v1 | — | rejected 留档：不做进度播报+自动接话（无 FR 承接，防复潮通道） |
| D-011@v1 | FR-02 | 三态分流优先级：源轮 consensus_task_id > 群模式（design-grill） |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
