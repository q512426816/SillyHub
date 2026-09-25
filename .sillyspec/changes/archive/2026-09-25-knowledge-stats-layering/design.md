---
author: flow-machine-draft
created_at: 2026-09-25T15:44:26.935Z
---
# 设计记录（Design Record）— 2026-09-25-knowledge-stats-layering

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-knowledge-stats-layering 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
三个纯增量字段挂在既有 stats 聚合上：①`parser.parse_index_routes()` 解析 INDEX.md 路由行
（小节锚点集 + 文件级路由文件集，与 CLI knowledge-match.js 同口径正则），`HitsService.stats` 用
`anchor_match_key` 归一匹配条目锚点算 `routable_entries`/`routable_used_entries`（INDEX 缺失/无路由
行退化为全集，不虚摊不缩水）；②聚合循环里解析失败（不在条目全集）的锚点单列为 `orphan_anchors`
（次数 + 最后命中，按次数降序）——「没人用」与「对不上」两类信号分开；③循环里顺手维护
`data_until` = 使用计数行最大 occurred_at（零命中 None）。

选这个方案：三字段全部只读聚合、零迁移零回填；DTO 全部带默认值（旧客户端向前兼容）；INDEX 是
CLI 既有的唯一路由真相源，平台此前从未消费——分母分层的判定源与 CLI 注入侧天然同源。


## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-knowledge-stats-layering 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
改动：`backend/app/modules/knowledge/parser.py`（新 `parse_index_routes` + 路由正则）、
`schema.py`（CoverageOut +routable_entries/routable_used_entries；新 OrphanAnchorOut；
KnowledgeStatsOut +orphan_anchors/data_until）、`hits.py`（stats 三段计算）、
`frontend/src/lib/api-types.ts` + `backend/openapi.json`（gen:types 重生成）、
`frontend/src/components/knowledge/ops-dashboard.tsx`（可路由口径主数值 + 全集副显 + 数据截至 +
失效命中期开合清单）+ 两测试文件。

对外可见：`GET /knowledge/stats` 响应**新增字段**（全部带默认值，旧消费者零破坏——已同步
gen:types 提交契约）；既有字段语义零变化。前端面板：覆盖率主数值换成可路由口径、全集口径降为
副显说明，头部行显示数据截至时间，新增失效命中可展开清单。


## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-knowledge-stats-layering 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. **乱序/迟到到达**：三字段都是 stats 请求内一次性聚合（INDEX 读盘一次 + 行集一次），与命中行到达顺序无关；data_until 取 max，天然幂等。
2. **并发写**：stats 全程只读（既有不变）；INDEX 在聚合中途被改写最多读本文件前一版本——与条目全集读树是同一既有竞态窗口，本变更不放大。
3. **切换/生命周期**：无状态无持久化；请求中断即丢弃局部聚合。旧 daemon/前端读新响应：字段带默认值，零破坏；新前端读旧后端：routable 缺省 0 → 前端回退全集口径显示（回退分支已实现）。
4. **作用域**：INDEX 读取走 `_spec_content_root` 同源根（与条目全集同一棵树）；命中行按 workspace_id 过滤（既有）；路由行解析是纯字符串函数无跨工作区状态。


## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-knowledge-stats-layering 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
**最大风险**：可路由口径被误读为「真实覆盖率上限」——INDEX 路由面本身可能缺行（知识有但没人
登记路由），此时 routable 偏小、口径读数偏乐观。缓解：卡片副显保留全集口径（两个数并排，读数
可对照）；退化形态（无 INDEX）恒等于全集；后续若做「未路由条目」清单可再补第三层。

**次生风险**：orphan_anchors 无上限（理论 = 命中锚点数，当前量级 ≤ 百）——榜单本就全量渲染，
同量级不新增分页需求；若未来爆量再补 TopN。

**试过但放弃的方案**：
1. 把全集覆盖率字段直接改成可路由口径（语义变更）——旧前端/消费方读数跳变，且「结构性不可达
   条目」的可见性（全集口径）仍有运营价值，弃。
2. 未路由条目也单列清单——本次范围外（需要第三组对照数据），留后续。
3. data_until 取 anchor_last 最大值——fr-inject 行无锚点时不进 anchor_last，会漏；改用行级
   occurred_at max（含 fr-inject），口径更真。

## 文件变更清单

- backend/app/modules/knowledge/parser.py
- backend/app/modules/knowledge/schema.py
- backend/app/modules/knowledge/hits.py
- backend/app/modules/knowledge/tests/test_hits.py
- backend/openapi.json
- frontend/src/lib/api-types.ts
- frontend/src/components/knowledge/ops-dashboard.tsx
- frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx
