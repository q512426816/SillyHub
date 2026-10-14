---
author: flow-machine-draft
created_at: 2026-10-14T07:14:18.840Z
---
# 任务注册表（Tasks）— 2026-10-14-session-bottom-passive-grow

- [x] task-01: 被动增高（scrollHeight 增长且 scrollTop 未减少）不改变贴底判定——handleScroll 跳过 near 清零与新消息计数锚设置，仅更新基线
- [x] task-02: 用户真实上滚（scrollTop 减少）照常清贴底判定（读历史不被拉底，既有行为不变）
- [x] task-03: 真实上滚后的内容增长（读历史时后台预取插入）不恢复贴底（near 保持 false）
- [x] task-04: 连续 3 次冷加载全部落底（导航 active=末轮=视口末轮），真浏览器实测
- [x] task-05: 贴底/翻页/跳转/preview 测试面复跑绿 + tsc 0
