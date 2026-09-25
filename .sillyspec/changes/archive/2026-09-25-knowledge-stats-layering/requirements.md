---
author: flow-machine-draft
created_at: 2026-09-25T15:44:26.935Z
---
# 需求规格（Requirements）— 2026-09-25-knowledge-stats-layering

## 功能需求（agent 填写——每条 FR 格式 ### FR-NN: 标题 + Given/When/Then；FR 进知识索引，写清行为语义）

<!--AGENT:FR区 agent 填写功能需求（直接书写，不走 amend） -->
### FR-01: 覆盖率分母分层（可路由口径）

- Given：知识树含 INDEX 路由面与 unmapped/uncategorized 等结构性不可路由条目
- When：GET /knowledge/stats 聚合
- Then：coverage 增 routable_entries（INDEX 小节锚点经归一匹配 + 文件级路由整文件）与
  routable_used_entries；既有 total/used 语义不变；INDEX 缺失/无路由行时 routable == total

### FR-02: 失效命中（幽灵锚）单列

- Given：命中锚点解析后仍不对应任何当前条目（知识面换代/标题漂移）
- When：同一次聚合
- Then：orphan_anchors 列表（anchor/total/last_hit，按 total 降序、同数按锚点字典序），
  不与 usage_board 混排

### FR-03: 数据截止时间

- Given：使用计数行集（含 fr-inject 行）
- When：同一次聚合
- Then：data_until = 最大 occurred_at；零命中为 None

### FR-04: 前端运营面板配套

- Given：三新字段
- When：渲染 ops-dashboard
- Then：覆盖率主数值为可路由口径（routable=0 回退全集）、全集口径副显说明；头部行显示
  「数据截至 X」；失效命中可展开/收起清单（锚点 + 次数 + 最后命中日期）

### FR-05: 契约同步

- Given：后端 schema 新字段
- When：pnpm gen:types
- Then：api-types.ts 与 openapi.json 同步重生成并随变更提交；旧消费者（字段带默认值）零破坏

### FR-06: 测试与零回归

- Given：后端 hits/parser 测试与前端 ops-dashboard 测试
- When：定向跑测
- Then：新增用例覆盖三字段口径（含退化/零命中）与前端渲染/开合；既有用例零回归
<!--
参考摘录（非约束——agent 可采纳/改写/忽略；每条格式 ### FR-NN: 标题 + Given/When/Then）
FR-01: stats 覆盖率增双口径字段：routable_entries（INDEX 路由可达条目数）与 routable_used_entries（可路由且被命中），既有 total
FR-02: used 语义不变
FR-03: stats 增失效命中单列：orphan_anchors 列表（解析失败锚点 + 命中次数 + 最后命中时间，按次数降序），与正常榜单分开
FR-04: stats 增数据截止时间 data_until（使用计数行最大 occurred_at
FR-05: 零命中为 null）
FR-06: 可路由判定用与锚点容错同源的归一匹配（INDEX 小节锚点经 anchor_match_key 匹配条目锚点
FR-07: 文件级路由覆盖整文件条目）
FR-08: 前端运营面板配套：覆盖率卡显示可路由口径为主、全集口径为辅
FR-09: 新增失效命中文案与可展开清单
FR-10: 卡片区显示数据截至时间
FR-11: 后端 schema 变更同步 gen:types（api-types.ts + openapi.json 一并提交）
FR-12: 新增后端单测覆盖三个新字段的计算（含 INDEX 缺失退化为全集、幽灵锚单列、data_until 零命中 null）与前端面板渲染
FR-13: 既有 knowledge 模块与 ops-dashboard 测试零回归
-->


## 测试绑定（每条 FR 至少一行——test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/knowledge/tests/test_hits.py::test_stats_layering_fields（routable=1 用例 + 空壳 INDEX 退化为全集用例）


<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_hits.py::test_stats_layering_fields（drift_ws 的 foo.bar + 内容漂移锚两幽灵单列断言）


<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_hits.py::test_stats_layering_fields + test_stats_zero_hits_data_until_none（零命中 None）


<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx::可路由口径为主数值 + 全集口径副显 + 数据截至 + 失效命中期开合


<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向命令 cd frontend && pnpm gen:types && pnpm exec tsc --noEmit（tsc 0 错；api-types/openapi 已随提交）


<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向：backend uv run pytest app/modules/knowledge -q --no-cov（128 passed = 基线 126 + 新 2）+ frontend vitest ops-dashboard（7 passed = 基线 6 + 新 1）


<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_hits.py::test_stats_layering_fields（hits_ws 小节路由经归一匹配命中 提交规范 条目）


<!--AGENT:测试绑定FR-08 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
frontend ops-dashboard.test.tsx::可路由口径用例（fixture routable>0 正常路径）+ 组件回退分支（routable=0 → coveragePct）


<!--AGENT:测试绑定FR-09 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
frontend ops-dashboard.test.tsx::可路由口径用例 后半（orphan-toggle 两段点击 + 行数/文案断言）


<!--AGENT:测试绑定FR-10 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
frontend ops-dashboard.test.tsx::可路由口径用例（toHaveTextContent("数据截至")）+ 零使用空态用例（空态不渲染卡片区）


<!--AGENT:测试绑定FR-11 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向命令 cd frontend && pnpm gen:types（产物已随本次提交：backend/openapi.json + frontend/src/lib/api-types.ts）


<!--AGENT:测试绑定FR-12 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_hits.py::test_stats_layering_fields（drift_ws 全集退化段）+ test_stats_zero_hits_data_until_none


<!--AGENT:测试绑定FR-13 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_hits.py::test_stats_endpoint_literal_route_not_swallowed（键集断言已更新）

### FR-07: 可路由判定与锚点容错同源

- Given：INDEX 小节锚点与条目锚点存在规则漂移
- When：计算可路由面
- Then：小节路由经 anchor_match_key 归一匹配（与命中解析同源）；文件级路由覆盖该文件全部条目

### FR-08: 前端可路由口径回退

- Given：routable_entries=0 且 total>0（旧后端/异常形态）
- When：渲染覆盖率卡
- Then：主数值回退全集口径（不出现除零或空读数）

### FR-09: 失效命中期开合交互

- Given：orphan_anchors 非空
- When：点击切换
- Then：清单展开渲染（锚点/次数/最后命中日期）与收起；空列表时不渲染切换行

### FR-10: 数据截至展示形态

- Given：data_until 非 None / None
- When：渲染头部行
- Then：非 None 显示「数据截至 <zh-CN 本地化时间>」；None 不显示该段

### FR-11: gen:types 契约闭环

- Given：后端 schema 新字段
- When：提交前
- Then：api-types.ts 与 openapi.json 均为重生成后状态且随变更一并提交（不让类型落后后端形成债）

### FR-12: 退化与零命中端用例

- Given：INDEX 空壳（无路由行）与零命中两种形态
- When：跑后端用例
- Then：前者 routable==total==used 三值对齐；后者 data_until None、orphan_anchors 空

### FR-13: 端点形状契约更新

- Given：stats 响应新增字段
- When：GET /knowledge/stats
- Then：响应键集含 orphan_anchors/data_until，coverage 键集含 routable_entries/routable_used_entries（字面量路由不被通配吞的既有断言同步更新）
