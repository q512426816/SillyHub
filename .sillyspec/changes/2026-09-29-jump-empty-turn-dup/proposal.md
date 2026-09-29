---
author: flow-machine-draft
created_at: 2026-09-29T00:09:15.860Z
---
# 提案书（Proposal）— 2026-09-29-jump-empty-turn-dup

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:d80719216406ec177b5a26873e4f91bd4969af25b06f354a6c2947a5ec95deab:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-jump-empty-turn-dup 留痕重锚 -->
任务原话转写：会话轮次导航直达跳转对「有日志但零可渲染正文」的轮次（群聊空 user_input 形态，e31d0e07b 实证 14/46 轮）防重判定失效：loadedHasBody 恒 false，每次点击都重新发起 run_id 单轮请求并 prepend 装饰键相同的重复块（React key 撞 + 空块累积）。修复：该轮已进装配状态即视为已加载，不再发起直达请求。

成功标准：
- 二次点击已在装配状态中的零正文轮，不再发起 run_id 单轮请求（调用计数不增长、无重复 prepend 块）
- 首次点击未加载轮的单轮直达行为不变（一次请求 + prepend + 定位高亮 + 零翻页）
- 既有直达/回退/空日志兜底用例全绿，聚焦测试 + tsc/eslint 0 错
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:e9da9f3c1b8f298eeec08896f9211bd1f63245e80b9d894b6f7ee2871955a99e:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-jump-empty-turn-dup 留痕重锚 -->
按成功标准机械推导，共 3 条验收面：
1. 二次点击已在装配状态中的零正文轮，不再发起 run_id 单轮请求（调用计数不增长、无重复 prepend 块）
2. 首次点击未加载轮的单轮直达行为不变（一次请求 + prepend + 定位高亮 + 零翻页）
3. 既有直达/回退/空日志兜底用例全绿，聚焦测试 + tsc/eslint 0 错
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:e353b806502060dc5bf030f422bb3fffbf0bc2341495f40b5fc3fa2cba188eb5:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-jump-empty-turn-dup 留痕重锚 -->
1. 二次点击已在装配状态中的零正文轮，不再发起 run_id 单轮请求（调用计数不增长、无重复 prepend 块）
2. 首次点击未加载轮的单轮直达行为不变（一次请求 + prepend + 定位高亮 + 零翻页）
3. 既有直达/回退/空日志兜底用例全绿，聚焦测试 + tsc/eslint 0 错
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
