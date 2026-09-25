---
author: flow-machine-draft
created_at: 2026-09-25T15:44:26.935Z
---
# 任务注册表（Tasks）— 2026-09-25-knowledge-stats-layering

> 机器稿（成功标准机械推导）；轻量跑直写=零任务卡（任务即 checkbox 行）；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。

- [x] task-01: stats 覆盖率增双口径字段：routable_entries（INDEX 路由可达条目数）与 routable_used_entries（可路由且被命中）…
- [x] task-02: used 语义不变
- [x] task-03: stats 增失效命中单列：orphan_anchors 列表（解析失败锚点 + 命中次数 + 最后命中时间，按次数降序），与正常榜单分开
- [x] task-04: stats 增数据截止时间 data_until（使用计数行最大 occurred_at
- [x] task-05: 零命中为 null）
- [x] task-06: 可路由判定用与锚点容错同源的归一匹配（INDEX 小节锚点经 anchor_match_key 匹配条目锚点
- [x] task-07: 文件级路由覆盖整文件条目）
- [x] task-08: 前端运营面板配套：覆盖率卡显示可路由口径为主、全集口径为辅
- [x] task-09: 新增失效命中文案与可展开清单
- [x] task-10: 卡片区显示数据截至时间
- [x] task-11: 后端 schema 变更同步 gen:types（api-types.ts + openapi.json 一并提交）
- [x] task-12: 新增后端单测覆盖三个新字段的计算（含 INDEX 缺失退化为全集、幽灵锚单列、data_until 零命中 null）与前端面板渲染
- [x] task-13: 既有 knowledge 模块与 ops-dashboard 测试零回归
