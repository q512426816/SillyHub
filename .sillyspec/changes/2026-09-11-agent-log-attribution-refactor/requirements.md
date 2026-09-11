---
author: qinyi
created_at: 2026-09-11 23:25:46
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 本地 agent 会话 | ZCode/Claude Code/pi/codex/dsh 等 CLI 在本机产生的会话及其子代理 |
| SillySpec CLI | agent 内执行的 `sillyspec run <stage>`，探测/登记/上报 agent 日志 |
| 平台（backend） | 接收 POST /api/agent-logs，落库并解析归属到会话 |
| 平台会话 | daemon 派发的会话（hub，env SILLYHUB_SESSION_ID 注入）或自动聚合会话（tool_report） |
| 用户 | 在平台 UI 查看会话/变更/quick 详情中的本地 agent 日志卡片 |

## 功能需求

### FR-01: ctx 打标会话身份锚定
覆盖决策：D-001@v1, D-008@v1

Given 某 agent 会话内执行 `sillyspec run --change X`（或 quick）
When CLI 探测本地日志文件
Then 仅「本 run 所属 agent 会话（锚定主会话）及其子代理（zcode parent_id 链，不比 directory）」的条目被写入 ctx=X，其余条目 ctx 不写不动（仅留底探测事实）

Given zcode 进程（env 无会话 id）
When 锚定器运行
Then 读 `~/.zcode/cli/db/db.sqlite`（node:sqlite mode=ro，directory==cwd 归一比较复用 normCwd/cwdsMatch）取 time_updated 最新主会话；node:sqlite 不可用/库缺失/查询异常时回退「最新活跃主会话文件」且子代理不打标（宁缺毋滥，debug 日志留原因）

Given own 命中文件被 MAX_PER_HARNESS 探测上限挤出
When 组装 detected
Then own 文件豁免上限定向补收（DG-17）

### FR-02: quick/change 双向互斥
覆盖决策：D-006@v2

Given quick 会话内的 run（quickId=quick-xxx）
When 更新 own 条目
Then entry 置 quick_id=quick-xxx 且 change_key=null

Given 普通变更 run（--change X）
When 更新 own 条目
Then entry 置 change_key=X 且 quick_id=null（防止 change 日志漏进旧 quick 会话，DG-01 镜像修正）

### FR-03: 平台 ctx-owner 归属解析
覆盖决策：D-002@v1, D-003@v1

Given 平台收到无 hub_session_id 的推送，条目 ctx=Q（quick_id 优先于 change_key）
When 解析 Q 的 owner
Then 第一级查 links（quick→quicklog_session_links.ql_id / change→changes(change_key) JOIN change_session_links）JOIN agent_sessions（未软删）取 last_active_at 最新；未命中第二级按 aggregation_key="{Q}" 的 tool_report 会话兜底；两级命中→条目挂 owner 并刷 last_active_at（不改 status）；均未命中→find-or-create origin=tool_report（aggregation_key="{Q}"，title="本地 · {quick 短码或变更名}"，provider 映射沿用原 D-007）

Given 平台 pi 会话已通过自身 run 登记变更 X（hub 分支 _bind_entry_ctx）
When 本地 zcode 推送 ctx=X 的条目
Then 挂到该 pi 会话（同变更就挂，跨 harness 不限制）

Given 推送条目无 ctx
When 归属解析
Then 维持现状单桶（aggregation_key="{harness}|"，标题含 harness 名）

### FR-04: hub 分支 own-only 语义
覆盖决策：D-007@v1

Given daemon 派发会话（SILLYHUB_SESSION_ID 注入）内执行 run
When CLI 推送
Then payload entries = 留底条目 ∩ own 集合（按 log_path）；hub 会话名下不再出现非本会话产物（旧 CLI 过渡期除外，见 NFR 兼容）

### FR-05: 存量清理与重建
覆盖决策：D-004@v2

Given 生产库存在错配时代数据
When 执行数据迁移（CLI 升级后一次性运维动作，不随 backend 发布自动前滚）
Then ① platform_agent_logs.agent_session_id 全置 NULL；② origin=tool_report 会话软删；③ change_session_links 全表清空；④ quicklog_session_links 全表清空；downgrade no-op；此后正确归属由重推重建

### FR-06: 无关日志零出现
覆盖决策：D-001@v1, D-007@v1

Given 本地某会话从未执行 sillyspec run
When 其日志文件在 cwd 活跃窗口内被其它会话的 run 探测到
Then 该条目不出现在任何推送中，平台任何会话/变更/quicklog 视图不可见

### FR-07: 协议文档更新
覆盖决策：D-006@v2, D-007@v1, D-008@v1

Given 协议 docs/platform-agent-log-protocol.md
When 本变更发布
Then §1 推送范围改 own 条目、§3 补 per-harness 锚定规则与回退、会话化上下文改双向互斥与 ctx-owner 平台行为

## 非功能需求

- 兼容性：旧 CLI × 新 backend 过渡期非 own 条目按各自持久化 ctx 解析（错配不扩大）；新 CLI × 旧 backend own-only 推送先行消除 hub 污染（design 兼容策略节）
- 可回退：CLI 回退=恢复全量推送；backend 回退=harness|ctx 分组；迁移 downgrade no-op 数据可重建；API/表结构全程不变
- 可测试：CLI 锚定/互斥/推送范围、backend 归属解析各分支均有单测（design Phase 1/2 测试项）

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-06 | 打标收敛为 own 集合 |
| D-002@v1 | FR-03 | ctx-owner 解析（同变更就挂） |
| D-003@v1 | FR-03 | find-or-create + 聚合键/标题新格式 |
| D-004@v2 | FR-05 | 四条清理（含 links 全清，用户裁决） |
| D-005@v1 | NFR 可回退 | 不动表结构约束 |
| D-006@v2 | FR-02, FR-03, FR-07 | 双向互斥 + quick 优先分组 |
| D-007@v1 | FR-04, FR-06, FR-07 | 推送收敛 own |
| D-008@v1 | FR-01, FR-07 | zcode 锚定实现与回退链 |
| D-009@v1 | FR-03（否决约束） | 不做 harness 拦截——跨 harness 挂接是需求 |
| D-010@v1 | —（否决记录） | 保守修补不采用 |
| D-011@v1 | —（否决记录） | 登记表不采用（违反 D-005） |
