---
author: flow-machine-draft
created_at: 2026-10-03T03:37:59.554Z
---
# 需求规格（Requirements）— 2026-10-03-usage-ingest-session-concurrency

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 定位段（session 查询）串行执行，RPC 段保持 Semaphore(3) 并发，AsyncSession 不再被并发使用
Given 系统就绪
When 定位段（session 查询）串行执行，RPC 段保持 Semaphore(3) 并发，AsyncSession 不再被并发使用
Then 行为符合本条标准描述

### FR-02: 新增回归测试：并发窗口下断言定位调用永不重叠，且旧实现（定位在信号灯内）该测试必红
Given 测试 相关模块就绪
When 新增回归测试：并发窗口下断言定位调用永不重叠，且旧实现（定位在信号灯内）该测试必红
Then 行为符合本条标准描述

### FR-03: model_validate 校验异常不再炸出 gather，单条畸形不丢弃同批已成功条目
Given 系统就绪
When model_validate 校验异常不再炸出 gather，单条畸形不丢弃同批已成功条目
Then 行为符合本条标准描述

### FR-04: 既有 test_usage_ingest.py 全部保持通过
Given 系统就绪
When 既有 test_usage_ingest.py 全部保持通过
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/platform_sync/tests/test_usage_ingest.py::test_ingest_locate_never_overlaps_across_batch（4 条 entry 批次定位永不重叠 + count==4 全落库；同文件其余 12 用例锚定 RPC 并发语义不变）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/platform_sync/tests/test_usage_ingest.py::test_ingest_locate_never_overlaps_across_batch（本会话两步实证：旧实现 HEAD 版该用例与 FR-03 用例 2 failed，新实现 14 passed）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/platform_sync/tests/test_usage_ingest.py::test_ingest_malformed_usage_isolates_failure（畸形 totalUsage 只废单条 count==1，同批 good 照常落库）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/platform_sync/tests/test_usage_ingest.py 全文件 14 用例（重构后全绿实测；含 test_ingest_degrades_on_app_error / test_ingest_idempotent_overwrite 等既有降级与幂等语义锚定）
