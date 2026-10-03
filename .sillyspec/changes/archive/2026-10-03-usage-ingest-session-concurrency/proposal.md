---
author: flow-machine-draft
created_at: 2026-10-03T03:37:59.553Z
---
# 提案书（Proposal）— 2026-10-03-usage-ingest-session-concurrency

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:77f4c8ffd2cd5f82b2fefb31ad5c33682deadeee5bc37fe5b53914ca3b8ef764:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-usage-ingest-session-concurrency 留痕重锚 -->
任务原话转写：修复 1462b8c55 引入的 usage_ingest 并发共用 AsyncSession 缺陷：Semaphore(3) 下多个协程持同一 session 进 _resolve_agent_log_read_target 触发 SQLAlchemy 并发禁令，多日志上报场景摄取大面积失败；顺手把 AgentLogTotalUsage.model_validate 挪进兜底保护圈防一坏整批丢。
成功标准：
- 定位段（session 查询）串行执行，RPC 段保持 Semaphore(3) 并发，AsyncSession 不再被并发使用
- 新增回归测试：并发窗口下断言定位调用永不重叠，且旧实现（定位在信号灯内）该测试必红
- model_validate 校验异常不再炸出 gather，单条畸形不丢弃同批已成功条目
- 既有 test_usage_ingest.py 全部保持通过
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:98fc0ce51a110f7612a37ab29e10c0f06c8b007787e0b685e2ff0a6ddc45d2de:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-usage-ingest-session-concurrency 留痕重锚 -->
按成功标准机械推导，共 4 条验收面：
1. 定位段（session 查询）串行执行，RPC 段保持 Semaphore(3) 并发，AsyncSession 不再被并发使用
2. 新增回归测试：并发窗口下断言定位调用永不重叠，且旧实现（定位在信号灯内）该测试必红
3. model_validate 校验异常不再炸出 gather，单条畸形不丢弃同批已成功条目
4. 既有 test_usage_ingest.py 全部保持通过
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:d06bc72cbfd1e343dd7027bba9261e62baeedd5829b37d8ddd1debc942153aaa:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-usage-ingest-session-concurrency 留痕重锚 -->
1. 定位段（session 查询）串行执行，RPC 段保持 Semaphore(3) 并发，AsyncSession 不再被并发使用
2. 新增回归测试：并发窗口下断言定位调用永不重叠，且旧实现（定位在信号灯内）该测试必红
3. model_validate 校验异常不再炸出 gather，单条畸形不丢弃同批已成功条目
4. 既有 test_usage_ingest.py 全部保持通过
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
