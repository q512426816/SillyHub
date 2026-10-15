---
author: flow-machine-draft
created_at: 2026-10-14T07:14:18.840Z
---
# 提案书（Proposal）— 2026-10-14-session-bottom-passive-grow

## 动机

任务原话转写：上轮修复（bottom-follow-insert）实测 3 次冷加载 2 次仍停距底 9092px：大纲后到中段插入预览卡 → 列表高度骤增 → 浏览器对视口未动也派发 scroll 事件（scrollHeight 增长使距底从 <80px 变 9092px）→ handleScroll 误判「用户上滚离开底部」清 isNearBottomRef → 贴底跟随被关 → length 分量触发时守卫已 false。第二层根因：被动增高与用户主动上滚未区分。

成功标准：
- 被动增高（scrollHeight 增长且 scrollTop 未减少）不改变贴底判定——handleScroll 跳过 near 清零与新消息计数锚设置，仅更新基线
- 用户真实上滚（scrollTop 减少）照常清贴底判定（读历史不被拉底，既有行为不变）
- 真实上滚后的内容增长（读历史时后台预取插入）不恢复贴底（near 保持 false）
- 连续 3 次冷加载全部落底（导航 active=末轮=视口末轮），真浏览器实测
- 贴底/翻页/跳转/preview 测试面复跑绿 + tsc 0

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 被动增高（scrollHeight 增长且 scrollTop 未减少）不改变贴底判定——handleScroll 跳过 near 清零与新消息计数锚设置，仅更新基线
2. 用户真实上滚（scrollTop 减少）照常清贴底判定（读历史不被拉底，既有行为不变）
3. 真实上滚后的内容增长（读历史时后台预取插入）不恢复贴底（near 保持 false）
4. 连续 3 次冷加载全部落底（导航 active=末轮=视口末轮），真浏览器实测
5. 贴底/翻页/跳转/preview 测试面复跑绿 + tsc 0

## 成功标准（可验证）

1. 被动增高（scrollHeight 增长且 scrollTop 未减少）不改变贴底判定——handleScroll 跳过 near 清零与新消息计数锚设置，仅更新基线
2. 用户真实上滚（scrollTop 减少）照常清贴底判定（读历史不被拉底，既有行为不变）
3. 真实上滚后的内容增长（读历史时后台预取插入）不恢复贴底（near 保持 false）
4. 连续 3 次冷加载全部落底（导航 active=末轮=视口末轮），真浏览器实测
5. 贴底/翻页/跳转/preview 测试面复跑绿 + tsc 0
