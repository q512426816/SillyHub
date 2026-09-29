---
author: flow-machine-draft
created_at: 2026-09-29T00:09:15.861Z
---
# 任务注册表（Tasks）— 2026-09-29-jump-empty-turn-dup

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: 二次点击已在装配状态中的零正文轮，不再发起 run_id 单轮请求（调用计数不增长、无重复 prepend 块）——jumpEmptyJumpedRunIdsRef 幂等短路 + 零正文不 prepend；回归用例先红（expected 2 to be 1）后绿实证
- [x] task-02: 首次点击未加载轮的单轮直达行为不变（一次请求 + prepend + 定位高亮 + 零翻页）——新用例首点断言 + 既有 task-04 三用例（直达/回退/空日志兜底）复跑绿
- [x] task-03: 既有直达/回退/空日志兜底用例全绿，聚焦测试 + tsc/eslint 0 错——page.test.tsx 46/46 + 相邻 history-race/turn-nav-list 17/17 + tsc 0 + eslint 0 error（5 warning 均预存债）
