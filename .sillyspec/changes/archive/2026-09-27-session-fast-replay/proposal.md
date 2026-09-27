---
author: flow-machine-draft
created_at: 2026-09-27T14:08:32.242Z
---
# 提案书（Proposal）— 2026-09-27-session-fast-replay

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:75b42f8c0624296bb76a342924d0337585502ddbca6a6e2fd4ab87d127245e0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-session-fast-replay 留痕重锚 -->
任务原话转写：会话回显加速（对齐 DeepSeek harness 尾页+大纲模式）+ 轮次导航列重做。

动机：用户反馈会话回显加载太慢（轮次一多要加载很久），对标本地 deepseek-harness 源码调研结论——人家打开只取尾部 50 条消息+全轮大纲一次下发，点旧轮直达；我们按日志行 400 条/页串行翻页（44 轮会话 1.1 万条日志），每条带 tool result 全文（单页数 MB），/runs 全量 500 条含 system_prompt 原文无压缩每轮重拉。同时左侧轮次刻度轨命中区过小（用户两轮抱怨）、600 轮密度失效、>500 轮截断。

成功标准：
- 新增轮次大纲端点：GET 会话全轮摘要（轮号/状态/时间/prompt 60 字/answer 120 字/游标），服务端投影+会话级缓存，打开会话一次下发全量
- 日志端点支持按轮直达（run_id 维度游标）与 slim 模式（tool result 截断，点开再看全文）
- /runs 瘦身（agent_profile_snapshot 摘要化去 system_prompt 原文）+ gzip
- 打开会话首屏 ≤2 次请求可见最近内容+全量导航；点任意未加载轮 ≤2 次往返直达定位
- 轮次导航重做为常驻行式导航列（约 220px：轮号+摘要常驻、整行命中区≥40px 高、当前轮高亮、未加载轮显示大纲摘要、>500 轮不截断）
- 既有行为零回归：SSE 实时流/steering/深链/草稿/触顶翻页保留（页单位优化）、mobile Drawer 导航同步吃大纲数据
- 既有测试改断言不改意图全绿；tsc/eslint 零新增；pnpm gen:types 同步
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:f3c468e69ee67d4452bb75b6f9edfb731a1b96df353f8638e3e2228a2c41b804:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-session-fast-replay 留痕重锚 -->
按成功标准机械推导，共 11 条验收面：
1. 新增轮次大纲端点：GET 会话全轮摘要（轮号/状态/时间/prompt 60 字/answer 120 字/游标），服务端投影+会话级缓存，打开会话一次下发全量
2. 日志端点支持按轮直达（run_id 维度游标）与 slim 模式（tool result 截断，点开再看全文）
3. runs 瘦身（agent_profile_snapshot 摘要化去 system_prompt 原文）+ gzip
4. 打开会话首屏 ≤2 次请求可见最近内容+全量导航
5. 点任意未加载轮 ≤2 次往返直达定位
6. 轮次导航重做为常驻行式导航列（约 220px：轮号+摘要常驻、整行命中区≥40px 高、当前轮高亮、未加载轮显示大纲摘要、>500 轮不截断）
7. 既有行为零回归：SSE 实时流/steering/深链/草稿/触顶翻页保留（页单位优化）、mobile Drawer 导航同步吃大纲数据
8. 既有测试改断言不改意图全绿
9. tsc
10. eslint 零新增
11. pnpm gen:types 同步
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:f22d01d5c51255b998b24db0b1ec7caa81605dcd0bc4aa1f0b013f90eac1eb96:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-session-fast-replay 留痕重锚 -->
1. 新增轮次大纲端点：GET 会话全轮摘要（轮号/状态/时间/prompt 60 字/answer 120 字/游标），服务端投影+会话级缓存，打开会话一次下发全量
2. 日志端点支持按轮直达（run_id 维度游标）与 slim 模式（tool result 截断，点开再看全文）
3. runs 瘦身（agent_profile_snapshot 摘要化去 system_prompt 原文）+ gzip
4. 打开会话首屏 ≤2 次请求可见最近内容+全量导航
5. 点任意未加载轮 ≤2 次往返直达定位
6. 轮次导航重做为常驻行式导航列（约 220px：轮号+摘要常驻、整行命中区≥40px 高、当前轮高亮、未加载轮显示大纲摘要、>500 轮不截断）
7. 既有行为零回归：SSE 实时流/steering/深链/草稿/触顶翻页保留（页单位优化）、mobile Drawer 导航同步吃大纲数据
8. 既有测试改断言不改意图全绿
9. tsc
10. eslint 零新增
11. pnpm gen:types 同步
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
