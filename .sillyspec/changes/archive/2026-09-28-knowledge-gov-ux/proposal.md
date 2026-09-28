---
author: flow-machine-draft
created_at: 2026-09-28T06:45:19.283Z
---
# 提案书（Proposal）— 2026-09-28-knowledge-gov-ux

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:36d1b97cbf02a458f2fd74bd695f0f7d62cfaf5358dc8265f946172d3126cb03:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-gov-ux 留痕重锚 -->
任务原话转写：知识治理信号卡（工作区知识库页 GovernanceCards）改造成普通人可操作的形态：
- 现状问题：卡片文案是术语+CLI 命令（「伪域在库 auto-*/unmapped」「处置指引为 CLI 命令」），伪域迁移要手填目标域字符串（如 platform-sync），非开发者无法理解和操作
- 目标：每个信号用人话说明（这是什么/要不要紧/影响什么），可机械处理的给一键按钮（推荐目标预填 + 确认弹窗 + 完成反馈），不能一键的（需内容判断的）明说建议交给 AI 助手处理
- 动作复用既有 POST /knowledge/governance/actions（redomain/repair），不加新写通道

成功标准：
- 伪域各池（auto-sillyhub-daemon/auto-backend/auto-frontend/auto-sillyspec）每池一行：人话描述+条数+推荐去向+[一键归位]（Popconfirm 确认），unmapped 699 混合池不提供一键（人话解释为无害历史存量）
- 信号卡标题/说明全部改为非开发者可懂文案，不再出现 CLI 命令字样
- 操作成功/失败有明确反馈（结果行/toast + 刷新）
- 既有 governance 前端测试同步更新全绿，tsc/eslint 0 错
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:ca8a0417b918b90b5effa1ccb691d39aa028ae31c58206be7b9639da4bb8159f:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-gov-ux 留痕重锚 -->
按成功标准机械推导，共 8 条验收面：
1. 目标：每个信号用人话说明（这是什么/要不要紧/影响什么），可机械处理的给一键按钮（推荐目标预填 + 确认弹窗 + 完成反馈），不能一键的（需内容判断的）明说建议交给 AI 助手处理
2. 动作复用既有 POST /knowledge/governance/actions（redomain/repair），不加新写通道
3. 伪域各池（auto-sillyhub-daemon/auto-backend/auto-frontend/auto-sillyspec）每池一行：人话描述+条数+推荐去向+[一键归位]（Popconfirm 确认），unmapped 699 混合池不提供一键（人话解释为无害历史存量）
4. 信号卡标题
5. 说明全部改为非开发者可懂文案，不再出现 CLI 命令字样
6. 操作成功/失败有明确反馈（结果行/toast + 刷新）
7. 既有 governance 前端测试同步更新全绿，tsc
8. eslint 0 错
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:c707487dc9e0a443269b6ea284be350a5baf0afc95f2d1705dc283b10256203c:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-gov-ux 留痕重锚 -->
1. 目标：每个信号用人话说明（这是什么/要不要紧/影响什么），可机械处理的给一键按钮（推荐目标预填 + 确认弹窗 + 完成反馈），不能一键的（需内容判断的）明说建议交给 AI 助手处理
2. 动作复用既有 POST /knowledge/governance/actions（redomain/repair），不加新写通道
3. 伪域各池（auto-sillyhub-daemon/auto-backend/auto-frontend/auto-sillyspec）每池一行：人话描述+条数+推荐去向+[一键归位]（Popconfirm 确认），unmapped 699 混合池不提供一键（人话解释为无害历史存量）
4. 信号卡标题
5. 说明全部改为非开发者可懂文案，不再出现 CLI 命令字样
6. 操作成功/失败有明确反馈（结果行/toast + 刷新）
7. 既有 governance 前端测试同步更新全绿，tsc
8. eslint 0 错
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
