---
author: flow-machine-draft
created_at: 2026-10-03T05:43:23.076Z
---
# 需求规格（Requirements）— 2026-10-03-local-usage-caliber-fix

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 摄取落库口径归一：usage_input_tokens 存「输入−缓存读取」（非缓存输入，与平台 agent_runs 口径对齐），max(0,...) 防负
Given 系统就绪
When 摄取落库口径归一：usage_input_tokens 存「输入−缓存读取」（非缓存输入，与平台 agent_runs 口径对齐），max(0,...) 防负
Then 行为符合本条标准描述

### FR-02: 注释锚定 113/113 实证
Given 系统就绪
When 注释锚定 113/113 实证
Then 行为符合本条标准描述

### FR-03: 命中率展示归正：归一后既有公式自动正确（缓存读取/(缓存读取+输入)≈98%）
Given 系统就绪
When 命中率展示归正：归一后既有公式自动正确（缓存读取/(缓存读取+输入)≈98%）
Then 行为符合本条标准描述

### FR-04: 本地段参与时间三元组：开始=MIN(first_seen)、结束=MAX(last_seen)、耗时含跨度（ISO 字符串字典序比较）
Given 系统就绪
When 本地段参与时间三元组：开始=MIN(first_seen)、结束=MAX(last_seen)、耗时含跨度（ISO 字符串字典序比较）
Then 行为符合本条标准描述

### FR-05: 混合场景与 run 段取 MIN/MAX、耗时相加
Given 系统就绪
When 混合场景与 run 段取 MIN/MAX、耗时相加
Then 行为符合本条标准描述

### FR-06: 请求次数：本地段 SUM(invocations) 并入 api_requests
Given api 相关模块就绪
When 请求次数：本地段 SUM(invocations) 并入 api_requests
Then 行为符合本条标准描述

### FR-07: 注脚声明口径（输入=非缓存输入
Given 系统就绪
When 注脚声明口径（输入=非缓存输入
Then 行为符合本条标准描述

### FR-08: 时间为上报观察跨度
Given 系统就绪
When 时间为上报观察跨度
Then 行为符合本条标准描述

### FR-09: 请求次数含 CLI 计数）
Given 系统就绪
When 请求次数含 CLI 计数）
Then 行为符合本条标准描述

### FR-10: 轮次维持 0（无来源）
Given 系统就绪
When 轮次维持 0（无来源）
Then 行为符合本条标准描述

### FR-11: 覆盖写幂等使活跃日志下次上报自动重算
Given 幂等 相关模块就绪
When 覆盖写幂等使活跃日志下次上报自动重算
Then 行为符合本条标准描述

### FR-12: 聚焦测试全绿：test_usage_ingest + test_usage_stats + change-usage-card
Given 测试 相关模块就绪
When 聚焦测试全绿：test_usage_ingest + test_usage_stats + change-usage-card
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/platform_sync/tests/test_usage_ingest.py ::test_ingest_writes_snapshot_with_column_mapping（6800−5600=1200 断言）+ ::test_ingest_input_floor_zero_when_cache_exceeds（下界 0 防负）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/platform_sync/usage_ingest.py _ingest_one 落库段注释（113/113 实证锚定）——非测试行为：不适用：文档注释锚定，行为正确性由 FR-01 测试承载

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx 「本地 CLI 桶行 api_requests 有值直显」用例（98.3% 命中率断言）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/change/tests/test_usage_stats.py ::test_local_only_triple_from_seen_at（03:37:50.183→04:14:12.160 三元组+跨度 2181977ms）

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/change/tests/test_usage_stats.py ::test_local_triple_and_invocations_contribute（run 10:00→11:00 与本地 09:00→10:30 取 MIN/MAX、耗时 500+5400000）

<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/change/tests/test_usage_stats.py ::test_local_triple_and_invocations_contribute（api_requests==12 = invocations 合计）+ ::test_local_only_triple_from_seen_at（==9）

<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx 注脚断言（「输入均为非缓存输入口径」getByText）

<!--AGENT:测试绑定FR-08 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/change/tests/test_usage_stats.py ::test_local_only_triple_from_seen_at（跨度毫秒断言）——注脚文案侧由 FR-07 用例同文件承载

<!--AGENT:测试绑定FR-09 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/change/tests/test_usage_stats.py ::test_local_triple_and_invocations_contribute（桶行 api_requests==12 断言）

<!--AGENT:测试绑定FR-10 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/change/tests/test_usage_stats.py ::test_local_triple_and_invocations_contribute（num_turns==1 仅 run 段，本地不计）

<!--AGENT:测试绑定FR-11 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/platform_sync/tests/test_usage_ingest.py ::test_ingest_idempotent_overwrite（两次摄取同值幂等）——自动重算=幂等+节流窗口外重摄的推论，不适用：端到端重算需真机上报，属部署后验收

<!--AGENT:测试绑定FR-12 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/platform_sync/tests/test_usage_ingest.py（15 passed）+ backend/app/modules/change/tests/test_usage_stats.py（27 passed）+ frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx（10 passed）
