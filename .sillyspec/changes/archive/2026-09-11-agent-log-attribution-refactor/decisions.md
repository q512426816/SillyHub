---
author: qinyi
created_at: 2026-09-11 23:28:21
---

# 决策记录 — 2026-09-11-agent-log-attribution-refactor

背景实证：`docs/sillyspec/agent-log-ctx-attribution-mismatch.md`（ctx 错配）+
`docs/sillyspec/agent-log-hub-attribution-cross-session-contamination.md`（hub 全量重推污染）。

---

## D-001@v1

- type: architecture
- status: confirmed
- source: user
- question: CLI ctx 打标单位是什么？（现状：cwd 活跃窗口内所有日志文件广撒网，多窗口并行互相抢标）
- answer: 会话身份锚定——只给「本 run 所属 agent 会话及其子代理（zcode parent_id 链）」打 ctx；识别不出不打标（宁缺毋滥）
- normalized_requirement: sillyspec run 的 agent-log 登记中，entry 级 ctx 仅写入 own 集合（锚定主会话 + 其 subagent）；非 own 条目仅本地留底
- impacts: [FR-01, task-cli-*, verify-*]
- evidence: 实证=本会话窗口（zcode db sess_0848df09「SillySpec CLI 本地agent日志与会话不对应」）从未跑 sillyspec 却被标 group-agent-direct-chat（留底 2026-09-11 快照）；用户 2026-09-11 AskUserQuestion 轮 1
- priority: P0
- 锚点: sillyspec 仓 src/agent-session-log.js（detectZcode/detectAgentLogEntries/recordAgentLogInvocation）
- 模块域: sillyspec

## D-002@v1

- type: architecture
- status: confirmed
- source: user
- question: 平台侧日志条目归属到会话的判定规则？（现状：hub 分支时间重叠全挂 + ctx 分组 harness|ctx）
- answer: ctx-owner 解析——按 entry 自身 ctx（quick 优先）解析「主」会话：已绑定该 ctx 的会话（change/quicklog links，含平台派发会话与自动会话）取最近活跃者优先挂；无主则 find-or-create 自动会话。跨 harness 不限制（平台 pi 会话 + 本地 zcode 同变更聚到一起）
- normalized_requirement: 无 hub 分支按 ctx 分组后逐组解析 owner（links 命中 → 刷新并挂；未命中 → find-or-create）；hub 分支保持全挂（推送已收敛为 own）
- impacts: [FR-03, FR-04, task-backend-*]
- evidence: 用户 2026-09-11 轮 1「同变更就挂，不应该限制 agent 类型」+ 轮 2 补充；backend/app/modules/platform_sync/service.py:1387-1452 现状
- priority: P0
- 锚点: backend/app/modules/platform_sync/service.py（_upsert_agent_log_entries_once 归属段）
- 模块域: backend

## D-003@v1

- type: architecture
- status: confirmed
- source: user
- question: 平台上没有对应会话怎么办？
- answer: 沿用现有 find-or-create origin=tool_report 自动会话；聚合键从 "{harness}|{ctx}" 改为 "{ctx}"（同 ctx 跨 harness 聚合进同一会话），标题改「本地 · {ctx}」；空 ctx 保持 workspace+harness 单桶现状
- normalized_requirement: ctx 非空组的 aggregation_key="{ctx}"，title="本地 · {ctx 或 '本地活动'}"；空 ctx 组维持 "{harness}|" 键
- impacts: [FR-03, task-backend-*]
- evidence: 用户 2026-09-11「如果平台上没有对应的会话，要创建会话去挂哦，我记得这个是存在的」；原设计 2026-08-23-agent-activity-sessions D-001
- priority: P0
- 锚点: backend/app/modules/platform_sync/service.py（find-or-create 段）
- 模块域: backend

## D-004@v2

- type: data
- status: confirmed
- source: user
- supersedes: D-004@v1
- question: 平台存量错挂数据如何处理？（v1 清归属列+软删自动会话；Grill DG-04 发现错配时代的 links 行成为新 ctx-owner 解析的永久候选源）
- answer: 四项全清重建：① platform_agent_logs.agent_session_id 全置 NULL（行保留）；② origin=tool_report 会话软删；③ change_session_links 全表清空；④ quicklog_session_links 全表清空——links 表无来源列（model.py:255-296/299-340 实证），污染行（hub 分支把 hub 会话绑到无关 ctx，service.py:1378-1384）与合法行（命令解析/reparse 自动绑定/quick 门户三写入口）不可区分，按用户裁决全清；合法绑定靠活跃会话后续 run 重推重建，已终会话历史绑定不可重建（接受，未上线可清）
- normalized_requirement: 可回滚 Alembic 数据迁移执行上述四条；downgrade 为 no-op（数据可重建）；迁移在 CLI 升级后作为一次性运维动作执行（DG-03：与 backend 代码发布解耦）
- impacts: [FR-05, task-backend-migration]
- evidence: 用户 2026-09-11 Grill 轮「并入清理（全清重建）」+ v1 轮「清归属列重推」；Grill DG-04；CLAUDE.md 规则 11
- priority: P1
- 模块域: backend

## D-005@v1

- type: architecture
- status: confirmed
- source: user
- question: 归属存储模型是否动表结构（M:N）？
- answer: 不动表结构——保留 agent_session_id 单列，靠打标修复 + ctx-owner 解析保证正确性；一条日志行只挂一个会话（其 ctx 的当前 owner），同 ctx 多会话时向最近活跃 owner 漂移
- normalized_requirement: 无 schema 迁移（除 D-004 数据清理）；行归属由 ctx owner 解析决定，重复推送幂等
- impacts: [FR-03, task-backend-*]
- evidence: 用户 2026-09-11 轮 1 大白话确认「格子保留，把乱填乱换的规则修好」
- priority: P1
- 模块域: backend

## D-006@v2

- type: behavior
- status: confirmed
- source: design-grill
- supersedes: D-006@v1
- question: 互斥单向不够——quick run 清 change_key 但 change run 保留旧 quick_id（合并规则 ctxQuickId ?? prev?.quick_id），平台分组转 quick 优先后 change 日志会漏进旧 quick 会话（DG-01 镜像形态）
- answer: 互斥双向落地——quick run 对 own 条目清空 change_key，change run 对 own 条目清空 quick_id；平台分组与绑定统一 quick_id 优先
- normalized_requirement: CLI 合并规则对 own 条目：quick run 置 quick_id 且 change_key=null；change run 置 change_key 且 quick_id=null；平台分组 ctx=quick_id or change_key or ''
- impacts: [FR-02, task-cli-*, task-backend-*]
- evidence: Grill DG-01（agent-session-log.js:725 合并规则 + run/command.js:719-721 ctx 构造 + service.py:145-148 绑定 quick 优先实证）；留底双键实证同 v1
- priority: P0
- 锚点: sillyspec 仓 src/agent-session-log.js（recordAgentLogInvocation 合并段）
- 模块域: sillyspec

## D-007@v1

- type: behavior
- status: confirmed
- source: user
- question: CLI 推送范围（现状：留底 top-10 全量重推，hub 会话把共享留底里别人的条目一起挂走）
- answer: 推送收敛=只推 own 条目（本 run 锚定会话+子代理的 ledger 条目）；留底仍记全部（本地调试用）；hub_session_id 语义不变
- normalized_requirement: push payload entries = ledger 条目 ∩ own 集合（按 log_path）；非 own 条目不出现在任何推送中
- impacts: [FR-04, FR-06, task-cli-*]
- evidence: hub 污染实证（d4c29d95 名下 9+ 条本地日志）；用户确认方案 A
- priority: P0
- 锚点: sillyspec 仓 src/agent-session-log.js（recordAgentLogInvocation push payload 段）
- 模块域: sillyspec

## D-008@v1

- type: implementation
- status: confirmed
- source: code
- question: zcode 会话身份如何锚定（env 无会话 id）？
- answer: 读 ~/.zcode/cli/db/db.sqlite（node:sqlite DatabaseSync，只读 URI mode=ro）取 directory==cwd 的最新主会话（time_updated desc），subagent 按 parent_id 等值匹配；node:sqlite 导入失败/库缺失/查询异常 → 回退只锚定主会话（最新活跃 model-io-sess_<uuid>.jsonl），subagent 不打标
- normalized_requirement: 锚定器 per harness：claude=CLAUDE_SESSION_ID env；zcode=db.sqlite 读取；pi=safePath 目录直算（天然锚定）；codex=rollout 首行 cwd==cwd 的最新主文件；SILLYSPEC_AGENT_LOG 覆盖=视为 own
- impacts: [FR-01, task-cli-anchor]
- evidence: 本进程 env 实证仅 ZCODE_APP_VERSION/RUNTIME_ENV 等无会话 id；node v24.15.0 node:sqlite OK；sillyspec engines >=22.13.0（node:sqlite 免 flag 线）；daemon 先例 read-zcode-sqlite.ts 同源三表 schema
- priority: P0
- 锚点: sillyspec 仓 src/agent-session-log.js（新增 anchorZcode）
- 模块域: sillyspec

## D-009@v1

- type: architecture
- status: rejected
- source: user
- question: hub 归属是否加 harness↔provider 一致性校验（pi 会话拒收 zcode 条目）？
- answer: 否——用户明确「不应该限制 agent 类型」，跨 harness 同变更挂接是需求而非缺陷
- normalized_requirement: 不实现 harness 一致性拦截；错挂治理全部交给 D-001/D-007 的推送收敛
- impacts: []
- evidence: 用户 2026-09-11 轮 2 原话
- 否决理由: 与「同变更就挂」需求直接冲突
- 复潮条件: 未来出现同变更跨 harness 归属仍需区分展示的需求
- priority: P2

## D-010@v1

- type: architecture
- status: rejected
- source: user
- question: 备选方案 B（保守修补：禁改写他人 ctx + hub 时间窗收紧）？
- answer: 否——首次错标仍会发生、subagent 归属仍靠 cwd 猜，治标不治本
- normalized_requirement: 不采用
- impacts: []
- evidence: 方案选择轮用户选 A
- 否决理由: 治标；不满足 FR-01
- 复潮条件: 锚定方案在某个 harness 上不可实施时的局部回退
- priority: P2

## D-011@v1

- type: architecture
- status: rejected
- source: user
- question: 备选方案 C（平台新建 session↔ctx 登记表 + 推送带 own 标记）？
- answer: 否——动表结构与 D-005 冲突；现有 change/quicklog links 表已能表达「会话↔ctx」登记
- normalized_requirement: 不采用
- impacts: []
- evidence: 方案选择轮用户选 A
- 否决理由: 违反已确认的「不动表结构」决策；现有 links 表能力足够
- 复潮条件: ctx owner 解析出现性能问题或需要显式管理界面
- priority: P2
