---
author: flow-machine-draft
created_at: 2026-09-25T15:44:26.934Z
---
# 提案书（Proposal）— 2026-09-25-knowledge-stats-layering

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:0e827f3ae8586e7f88ac839cbda374796db2a64a320841f2a6c2142b1bb85037:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-knowledge-stats-layering 留痕重锚 -->
任务原话转写：动机：知识页运营面板的三个口径缺口（用户实证「命中的怎么那么局限」的残留层）：①覆盖率分母把 unmapped/uncategorized 等结构性不可路由条目全额计入（fr/unmapped 713 条从未可命中），单一分母让覆盖率系统性偏低且误导；②命中锚点解析失败（幽灵锚，如 9-24 知识面换代后的 66% 历史命中）在榜单上与正常条目混排，用户无法区分「没人用」与「对不上」；③面板不知道数据截止时间（上行断流 4 天无人察觉）。

成功标准：
- stats 覆盖率增双口径字段：routable_entries（INDEX 路由可达条目数）与 routable_used_entries（可路由且被命中），既有 total/used 语义不变
- stats 增失效命中单列：orphan_anchors 列表（解析失败锚点 + 命中次数 + 最后命中时间，按次数降序），与正常榜单分开
- stats 增数据截止时间 data_until（使用计数行最大 occurred_at；零命中为 null）
- 可路由判定用与锚点容错同源的归一匹配（INDEX 小节锚点经 anchor_match_key 匹配条目锚点；文件级路由覆盖整文件条目）
- 前端运营面板配套：覆盖率卡显示可路由口径为主、全集口径为辅；新增失效命中文案与可展开清单；卡片区显示数据截至时间
- 后端 schema 变更同步 gen:types（api-types.ts + openapi.json 一并提交）
- 新增后端单测覆盖三个新字段的计算（含 INDEX 缺失退化为全集、幽灵锚单列、data_until 零命中 null）与前端面板渲染
- 既有 knowledge 模块与 ops-dashboard 测试零回归
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:01674a47f245e1ea8d4d93e56ce10392d9a73305543082f2cbf1c4eca04e72bf:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-knowledge-stats-layering 留痕重锚 -->
按成功标准机械推导，共 13 条验收面：
1. stats 覆盖率增双口径字段：routable_entries（INDEX 路由可达条目数）与 routable_used_entries（可路由且被命中），既有 total
2. used 语义不变
3. stats 增失效命中单列：orphan_anchors 列表（解析失败锚点 + 命中次数 + 最后命中时间，按次数降序），与正常榜单分开
4. stats 增数据截止时间 data_until（使用计数行最大 occurred_at
5. 零命中为 null）
6. 可路由判定用与锚点容错同源的归一匹配（INDEX 小节锚点经 anchor_match_key 匹配条目锚点
7. 文件级路由覆盖整文件条目）
8. 前端运营面板配套：覆盖率卡显示可路由口径为主、全集口径为辅
9. 新增失效命中文案与可展开清单
10. 卡片区显示数据截至时间
11. 后端 schema 变更同步 gen:types（api-types.ts + openapi.json 一并提交）
12. 新增后端单测覆盖三个新字段的计算（含 INDEX 缺失退化为全集、幽灵锚单列、data_until 零命中 null）与前端面板渲染
13. 既有 knowledge 模块与 ops-dashboard 测试零回归
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:428033feef96189e15b760ca8136a0466cafd2c85a2ebbde5fcfaf846322ff99:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-knowledge-stats-layering 留痕重锚 -->
1. stats 覆盖率增双口径字段：routable_entries（INDEX 路由可达条目数）与 routable_used_entries（可路由且被命中），既有 total
2. used 语义不变
3. stats 增失效命中单列：orphan_anchors 列表（解析失败锚点 + 命中次数 + 最后命中时间，按次数降序），与正常榜单分开
4. stats 增数据截止时间 data_until（使用计数行最大 occurred_at
5. 零命中为 null）
6. 可路由判定用与锚点容错同源的归一匹配（INDEX 小节锚点经 anchor_match_key 匹配条目锚点
7. 文件级路由覆盖整文件条目）
8. 前端运营面板配套：覆盖率卡显示可路由口径为主、全集口径为辅
9. 新增失效命中文案与可展开清单
10. 卡片区显示数据截至时间
11. 后端 schema 变更同步 gen:types（api-types.ts + openapi.json 一并提交）
12. 新增后端单测覆盖三个新字段的计算（含 INDEX 缺失退化为全集、幽灵锚单列、data_until 零命中 null）与前端面板渲染
13. 既有 knowledge 模块与 ops-dashboard 测试零回归
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
