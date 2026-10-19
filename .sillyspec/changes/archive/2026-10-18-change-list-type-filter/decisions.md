---
author: flow-machine-draft
created_at: 2026-10-18T14:05:07.066Z
---
# 决策记录（Decisions）— 2026-10-18-change-list-type-filter

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：筛选值集与展示映射漂移（feat↔feature 口径在后端 aliases、前端 COMMIT_TYPE_DISPLAY 两处维护）。缓解：两端各有测试钉（后端 feat 等价命中用例 / 前端 feature→feat 显示用例），且值集注释互指对方为权威。残余面：TYPE_OPTIONS 未 列 ci/revert/quick（防下拉过长），后端白名单仍可筛——深链手输 URL 可用，下拉不可 选，属有意取舍。 试过放弃：A. 类型筛选复用 lineage 的「全局集合→SQL IN」两阶段——类型是列值非 投影字段，直接 where 即可，无需两阶段；B. 前端本地过滤——total/分页会错 （pending_review_only gap② 前车之鉴），必须服务端筛。
