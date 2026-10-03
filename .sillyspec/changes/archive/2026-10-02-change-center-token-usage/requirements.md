---
author: qinyi
created_at: 2026-10-02
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 工作区成员 | 查看变更中心列表/详情的用户（权限 CHANGE_READ），期望本地 CLI 跑的变更也展示执行用量 |
| 本地 CLI | ZCode / Claude Code 等直接本地跑 sillyspec 命令的客户端，best-effort 上报 agent-logs（既有行为不变） |

## 功能需求

### FR-01: agent-logs 上报后异步摄取用量快照
覆盖决策：D-002@v1
Given CLI 上报 `POST /api/agent-logs`（1..50 entry）且元信息落库成功
When 上报响应返回后
Then backend 以 fire-and-forget 后台任务对候选 entry 逐个解析用量并覆盖写 `platform_agent_logs` 五列快照；上报响应时延与成功语义不变（摄取失败不影响上报结果）

Given entry 满足全部条件：exists=true、已关联 agent_session_id、format ∈ {zcode-model-io-jsonl, claude-code-jsonl}
When 后台任务筛选候选
Then 该 entry 进入解析队列；其余（cursor 恒 null / codex unsupported / 未关联会话 / 文件不存在）跳过不解析

Given 同一 entry 的 size_bytes 与 mtime_ms 与库中一致，且 usage_parsed_at 距今 < 300 秒
When 再次上报触发摄取
Then 节流跳过该 entry（日志未增长不重复解析）

Given daemon 解析返回 status=parsed 且 totalUsage 非 null
When 落库
Then 四维 token 写入 usage_* 列（cacheWriteTokens → usage_cache_write_tokens 映射）、usage_parsed_at=now，覆盖旧值（幂等）

Given daemon 离线 / RPC 超时 / method_not_found（旧 daemon）/ status ∈ {unsupported, too_large, parse_error} / totalUsage 为 null
When 摄取
Then 跳过该 entry 仅记日志，不抛错不重试（下次上报天然补齐）；并发解析上限 3（Semaphore）

### FR-02: 变更/快速修复用量聚合并入本地 CLI 段
覆盖决策：D-001@v1, D-002@v1
Given 变更有会话绑定（change_session_links）且该会话无任何 agent_runs 行，其名下 platform_agent_logs entry 有非空快照
When 聚合该变更用量
Then 本地段 SUM 四维 token 并入 totals，并形成 by_model「本地 CLI」桶行（api_requests=0）；本地段不贡献时间三元组、轮次、请求次数（无数据来源，诚实值）

Given 同一会话既有 agent_runs 行又有非空快照
When 聚合
Then 只计 run 段（run 为权威终态），快照不计——会话级二选一防双计（NOT EXISTS agent_runs）

Given 快速修复（quicklog_session_links 锚点）
When 聚合
Then 与变更同口径并入本地段

Given 本地 CLI 会话绑定多个变更
When 分别查看各变更用量
Then 各变更分别完整显示一次（共享口径特性，与 2026-08-30 D-002 同族，注脚声明）

Given entry 快照列为 NULL（存量未摄取 / 解析不支持）
When 聚合
Then 该 entry 不计入本地段，显示与现状一致（不伪造 0）

### FR-03: 前端用量展示扩展
Given 变更/快速修复的用量数据含本地 CLI 段
When 用户查看详情用量卡
Then 摘要行四维 token 为合并值；明细表出现「本地 CLI」绿阶 tag 桶行（对齐「未记录」灰阶兜底桶先例），其请求列显示「—」，命中率照常计算；口径注脚更新为「统计平台派发执行、关联会话执行与本地 CLI 会话……本地 CLI 用量来自 daemon 解析日志的落库快照，请求次数与轮次无来源不计」

When 用户查看列表「执行」列
Then token 总量自动包含本地 CLI 用量（数据来自批量摘要聚合，无 UI 结构变化）

Given 纯本地 CLI 变更（无 runs：时间三元组 None、轮次 0）且 totals 非 0
When 渲染用量卡
Then 不触发「尚无关联执行」空态（hasNoExecution 要求 totals 全 0）；时间/耗时显示「—」

### FR-04: 兼容与回退
Given daemon 未升级（read_agent_log_messages 未注册）
When 摄取任务 RPC
Then 回 method_not_found → 捕获跳过（复用回放通道既有异常分类），上报主流程不受影响

Given 迁移回退（downgrade）
When 执行
Then 5 列删除，聚合本地段空结果时与改造前完全一致（API DTO 结构不变，旧前端无破坏）

## 非功能需求

- 摄取路径资源约束：单次上报触发的解析并发 ≤3、单 entry RPC 超时沿用 30s 默认；不引入队列/重试/定时器（下次上报即天然重试）。
- 聚合性能：列表批量摘要维持单查询零 N+1（本地段并入既有锚点查询，不新增 per-change 查询）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02, FR-03 | 范围=本地 CLI 会话用量纳入变更中心（tool_report 链路），平台派发统计维持现状 |
| D-002@v1 | FR-01, FR-02 | 落库触发=上报链路顺带解析（方案 A）：fire-and-forget + WS RPC 复用 + best-effort 降级；否决 daemon 周期推送与查询时实时解析 |

## 测试绑定（收编追加——每条 FR 至少一行：test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名，如 test/foo.test.mjs「用例组」或 test/foo.test.mjs#用例；无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名，如 test/foo.test.mjs「用例组」或 test/foo.test.mjs#用例；无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名，如 test/foo.test.mjs「用例组」或 test/foo.test.mjs#用例；无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名，如 test/foo.test.mjs「用例组」或 test/foo.test.mjs#用例；无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
