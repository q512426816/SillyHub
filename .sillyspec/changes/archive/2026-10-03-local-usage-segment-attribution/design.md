---
author: qinyi
created_at: 2026-10-03 17:33:58
generated_by: sillyspec-design-init
scale: large  # TODO：Step 8 规模评估落值——单上下文可吞吐=small（flow start 收编）；需 Wave 编排/上下文分片/多阶段治理=large（run plan）；拿不准 small
---

# 设计文档（Design）— 2026-10-03-local-usage-segment-attribution

<!-- 由 sillyspec design-init 生成的骨架（2026-10-03-local-usage-segment-attribution）——逐节填散文后删除本注释；存量手写路径不受影响 -->
<!-- 引用规范：全文源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## 背景

本地 CLI 用量归属协议缺陷（用户实证）：一个日志文件（CLI 会话）连续干多个变更时，agent-logs 上报按「当时 ctx」把整个 entry 重归属到「本地 · <变更>」聚合会话——后一个变更的上报覆盖前一个的归属（`_bind_entry_ctx` + 整行覆盖 upsert），前变更聚合会话被抽空、用量全记到最后变更。2026-10-03 实证：caliber-fix 的用量被 backfill 抢走。

## 设计目标

1. 用量按**实际发生时段**归属正确变更：差分水位协议（D-001）。
2. 时序正确（同步 upsert + 异步摄取并存，D-002 推演守恒无缺口）。
3. 存量兼容：无水位历史的 entry 维持现状归属（整行快照归当前 ctx，回填成果不动）。
4. 前端零改动（聚合 DTO 不变，数字变准）。

## 非目标

- 不重算历史归属（caliber-fix 已错归到 backfill 的量不迁移——无历史水位可差分）。
- 不改 CLI/daemon 协议（仍整行上报；水位在 backend 侧记录）。
- 不改平台派发执行（agent_runs）链路与会话级二选一防双计。

## 拆分判断

单变更三 Wave：水位表 + 上报链路（platform_sync 域）→ 聚合改造（change 域）→ 测试收口。共享水位表 schema，拆分会造成中间态口径断裂。

## 总体方案

```
CLI 上报 POST /api/agent-logs（entry 带 ctx=change_key/quick_id）
  └─ upsert 循环内、行覆盖前：
       读旧行已落库累计五值（无旧行/NULL 按 0）
       → INSERT 水位行 (entry, ctx, mark_五值, reported_at)
       → （既有 upsert 覆盖 + _bind_entry_ctx 照旧）
       → count>200 时修剪（D-003@v2；统一 seq 键；**豁免每 entry 最旧一条**——首水位是隐式起点 0 锚定的载体，被删会使 [0,mark_new_first) 转移给新首水位 ctx（复审 L1 组合缺口））

异步摄取照旧：daemon 解析 → entry 快照五列刷新（累计值单调增）

聚合（usage_service 本地段改造）：
  变更 X 的本地用量 = Σ over 水位行 w (ctx=X, entry=E)：
      next = E 的下一水位（按 seq 序）的 mark；无下一水位 → E 当前快照值
      差分 = max(0, next − w.mark)  → 四维 token + invocations(→api_requests)
  首水位锚定（X2 P0 修正）：每 entry 的差分序列隐式起点 0——首水位的
      ctx 认领 [0, mark_first) 段（等价于所有水位前隐式放 (ctx=first_ctx,
      mark=0) 行）。存量 entry 被 CLI 全量重推卷入水位协议时（首次上报插
      首水位 mark=存量基线 V0），V0 归首水位 ctx——与改造前「整行快照归
      当前 ctx」同值同主（重推 ctx 即当时 ctx），数字连续平滑迁移；全新
      文件首水位 mark=0 无影响。
  无水位行且不再活跃的 entry（回填后死日志）→ 整行快照归属当前 ctx（现状路径不变）
```

### Wave 划分

- **Wave 1 存储+上报**：migration 水位表 + ORM + service upsert 内插水位/修剪 + platform_sync 单测。
- **Wave 2 聚合**：usage_service 本地段改双路径（水位差分 ∪ 存量整行）+ change 单测。
- **Wave 3 收口**：模块聚焦回归 + 文档同步。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:backend/migrations/versions/20261003020000_add_agent_log_usage_marks.py | 水位表 platform_agent_log_usage_marks |
| 修改 | backend/app/modules/platform_sync/model.py | UsageMarkORM（水位行） |
| 修改 | backend/app/modules/change/service.py | enrich_summaries 调用点跟随 summarize_changes 新增 workspace 锚参（task-03 连带） |
| 修改 | backend/app/modules/change/tests/conftest.py | 测试库建 marks 表（整行路径 NOT EXISTS 谓词依赖，task-03 连带基建） |
| 修改 | backend/app/modules/platform_sync/service.py | upsert 循环内读旧值插水位 + 修剪 200 |
| 修改 | backend/app/modules/change/usage_service.py | 本地段双路径聚合（水位差分 ∪ 存量整行快照） |
| 修改 | backend/app/modules/platform_sync/tests/test_agent_log_push.py | 水位插入/修剪/ctx 空行为用例 |
| 修改 | backend/app/modules/change/tests/test_usage_stats.py | 差分归属/跨变更切换/存量兼容用例 |

## 接口定义

本变更接口面：0 端点（既有 POST /api/agent-logs 行为扩展——响应/鉴权/DTO 不变；usage 端点 DTO 字段集不变，数值口径变准）。

```text
水位表 platform_agent_log_usage_marks：
  id UUID PK / workspace_id / log_path String(1024)（对齐 entry 复合键，不 FK entry id——
    entry 行恒在，但用 log_path 与上报键同构省 join；唯一键 (workspace_id, log_path, seq)
  seq BigInteger（每 entry 单调递增，插入时取 MAX+1——并发上报经 upsert 单写者串行）
  change_key String(200) NULL（对齐 changes.change_key）/ quick_id String(128) NULL（对齐 quicklog_entries.ql_id）——互斥，均 NULL=空 ctx 片段（X6 列域对齐审查修正）
  mark_invocations BigInteger / mark_input_tokens / mark_output_tokens /
  mark_cache_read_tokens / mark_cache_write_tokens BigInteger（接管时点已落库累计，NULL 快照按 0）
  reported_at DateTime(UTC)
索引：(workspace_id, log_path, seq) 唯一；(change_key)；(quick_id)
```

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| 上报（既有） | CLI | backend | AgentLogPushRequest | entry upsert（不变）+ 新增水位行（append-only） |
| 修剪（新） | backend | DB | — | 每 entry >200 行删最旧（片段被消费后即无用，无状态语义） |
| 摄取（既有） | backend 后台 | daemon/DB | — | entry 快照刷新（不变，水位不受影响） |

无 claim/heartbeat/lease 状态迁移；水位 append-only + 定长修剪。

## 数据模型

见接口定义节水位表；不改动 platform_agent_logs 既有列。

## 兼容策略（brownfield 必填）

- 存量 entry（410 条回填快照）：无水位行 → 聚合走既有「整行快照归属当前 ctx」路径，数字与现状一致；被 CLI 全量重推卷入时经首水位锚定平滑迁移（见总体方案 X2 修正——基线 V0 归首水位 ctx，同值同主）。
- 旧 CLI/旧上报（无 ctx）：水位 ctx 双 NULL → 差分不计任何变更（与现状 _bind_entry_ctx 不绑 default 一致）。
- 回退：downgrade 删水位表；聚合双路径自动全部走存量路径（与改造前一致）。
- API/DTO 零变化。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 水位差分与异步摄取竞态 | P0 | 恒总量守恒（telescoping）；「尾巴归属」精度边界见 R-06（D-002@v2）—— D-002 时序推演：水位取「接管时点已落库值」，A 尾巴归 A、B 从 mark 起——单调累计下差分守恒；单测覆盖「上报→摄取→再上报」序列断言守恒 |
| R-02 | seq 并发（同 entry 并发上报） | P1 | upsert 已是单写者语义（CLI 串行上报）；MAX+1 + 唯一键兜底，撞键按 IntegrityError 重试一轮（对齐既有 upsert 先例） |
| R-03 | 水位表增长 | P2 | D-003：每 entry 保留 200 行修剪（先例变更事件 5000 修剪） |
| R-04 | 修剪误删待消费水位 | P2 | 修剪只删第 200 行之前的；**首尾水位均豁免**（首=隐式起点锚定载体防量转移〔L1〕、末=待消费锚点）；聚合取「下一水位或当前快照」不依赖中段老水位 |
| R-06 | 摄取滞后窗口的跨界错归（X1 审查修正） | P1 | 声明边界：A 尾巴 token 在「A 最后上报→B 接管上报」之间若摄取未落库，落入 B 差分（后继多计、前驱少计）——总量恒守恒（telescoping），错归窗口=一次摄取延迟（秒级~分钟级）；invocations 为同步 CLI 值不受此影响。反例序列进单测断言总量守恒与边界语义 |
| R-07 | 水位路径防双计（X5 审查修正） | P1 | 水位差分 join entry 行时沿用同一条会话级谓词 NOT EXISTS agent_runs（r.agent_session_id = pal.agent_session_id）——与整行路径同一防双计面；hub 会话双派发窗口两侧同判 |
| R-08 | 两卡分叉声明（X5） | P2 | 「关联会话卡」= _bind_entry_ctx 绑定语义照旧（最后 ctx 重归属）；「用量卡」= 水位差分归属——两卡会话集合可不同，注脚与本文档声明（接受：绑定卡表达「最后工作现场」，用量卡表达「实际消耗分布」） |
| R-05 | quicklog 侧差分同构遗漏 | P1 | quick_id 水位与 change_key 同表同路径，测试双覆盖 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 总体方案（水位差分）、非目标（不重算历史）、兼容策略（存量路径） | 已覆盖 |
| D-002@v1 | 接口定义（mark 语义）、R-01 时序守恒 | 已覆盖 |
| D-002@v2 | 总体方案时序（supersedes v1 尾巴断言）、R-06、FR-04a | 已覆盖 |
| D-003@v1→@v2 | 接口定义（修剪豁免首条）、R-03/R-04 | 已覆盖 |
| D-004@v1 | 总体方案首水位锚定段、R-01、FR-04b | 已覆盖 |

## 自审

- [x] 章节齐全 / frontmatter（scale=large：跨模块 + 新表 migration + 协议语义）
- [x] 引用全部当前版本 D-001/002/003@v1
- [x] 生命周期契约表已填（上报/修剪/摄取三行，无状态迁移声明）
- [x] UI 原型分级：跳过——纯后端协议变更，前端零改动（组件无新文件/新交互）
- [x] 组合裁定推演：D-001（协议）×D-003（修剪）存在约束面——R-04 已推演（修剪不触末水位）；D-002 与 D-001 正交（语义 vs 结构）——无死锁格
- [x] ⚠️ 自审存疑：无——时序推演经 D-002 逐步验证；「seq 并发」保守按 R-02 防御

