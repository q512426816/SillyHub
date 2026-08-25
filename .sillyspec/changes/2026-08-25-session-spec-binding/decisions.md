---
author: qinyi
created_at: 2026-08-25 22:15:45
change: 2026-08-25-session-spec-binding
---

# 决策台账（decisions.md）

## D-001@v1
- type: data-model
- status: confirmed
- source: brainstorm step3-4（调研报告 §4/§5：quicklog_entries 双源合并、placeholder 行语义）
- question: quicklog 侧会话绑定表怎么设计？FK 到 quicklog_entries 还是自然键？
- answer: `quicklog_session_links` 用自然键 (workspace_id, ql_id, session_id) + 唯一约束，**不**建 FK 到 quicklog_entries。模型放 change/model.py（变更中心拥有 spec记录↔会话关联域）。
- normalized_requirement: quicklog 绑定行在条目 DB 行不存在（文件源/推送未达）时也能先落；会话/工作区删除级联清绑定；并发 upsert 幂等。
- impacts: FR-02, FR-04；design §8
- evidence: backend/app/modules/change/quicklog_service.py:261-297（双源合并去重键 ql_id）；platform_sync/schema.py:153-174（推送无 session 字段）；agent/model.py agent_sessions FK 先例
- 锚点: backend/app/modules/change/model.py（QuicklogSessionLink 新增）
- 模块域: backend, change
- priority: P0

## D-002@v1
- type: architecture
- status: confirmed
- source: brainstorm step4 方案对比（A 收敛 M:N 单一真相 / B 增量并行 / C JSON 字段）；自治模式用户未及时作答，AI 按 CLAUDE.md 规则11（未上线可重置数据）+ 现状双轨割裂痛点选定 A，CLI 回执如实记录来源
- question: 变更侧既有单 FK（AgentSession.change_id）与 change_session_links 双轨如何收敛？
- answer: links 为唯一关联真相：读侧全部改走 links；alembic 一次性把存量 change_id 播种成 link 行（ON CONFLICT DO NOTHING）；change_id 列保留并继续写入（创建时锚定主变更的冗余提示，双写），后续变更再评估删列。
- normalized_requirement: 变更关联读取（列表/筛选/卡）语义 = M:N links；存量数据不丢；对外参数与响应 schema 兼容。
- impacts: FR-01, FR-03, FR-05；design §5.W1.2/§6/§9
- evidence: change/model.py:246-287（links 表已存在）；change/router.py:331-333（list 走单 FK）；daemon/session/service.py:3892-3893（筛选走单 FK）
- 锚点: backend/migrations/versions/20260825223000_add_quicklog_session_links.py（播种）
- 模块域: backend, change, daemon
- priority: P0

## D-003@v1
- type: detection
- status: confirmed
- source: brainstorm step3-4（调研报告 §2：tool_kind 打标点 + agent-logs hub 分支忽略 ctx）
- question: 自动绑定的检测写入口放哪里？改 CLI 还平台侧？
- answer: 平台侧双通道，不改 CLI：(a) run_sync.submit_messages 消息入库时解析 tool_kind='sillyspec' 的 bash 命令提取 --change（变更主通道，覆盖会话内跑任意阶段）；(b) platform_sync.upsert_agent_log_entries hub 分支补消费 entry 的 change_key/quick_id（quick 唯一可靠通道）+ 聚合分支 tool_report 会话同步落绑定。全部幂等 best-effort。
- normalized_requirement: 会话内跑 sillyspec run --change X / run quick 即自动绑定，无需用户操作，不依赖 CLI 升级（quick 依赖既有 agent-logs 上报，R-01 记录）。
- impacts: FR-01, FR-02；design §5.W2/§7.5
- evidence: daemon/run_sync/service.py:677-691（打标点）；platform_sync/service.py:715-778（两分支）；sillyhub-daemon/src/spawn-env.ts:173（SILLYHUB_SESSION_ID）
- 锚点: backend/app/modules/daemon/run_sync/service.py（submit_messages 循环）
- 模块域: backend, daemon, platform_sync
- priority: P0

## D-004@v1
- type: parsing-rule
- status: confirmed
- source: brainstorm step3（锚点报告 §3：`sillyspec run quick --done --change quick-990f8c09` 实证）
- question: `sillyspec run quick ... --change X` 的 X 是变更名吗？
- answer: 不是。quick 子命令的 --change 值是 CLI 内部 quick 会话 id（quick-<hex> 或 default），不作变更绑定；quick 的会话绑定不经命令解析通道（ql_id 在命令时刻未知），由 agent-logs 通道（entry.quick_id）覆盖。
- normalized_requirement: 解析器对 quick 子命令不产出变更绑定；quick 绑定正确性由 agent-logs hub 分支保证。
- impacts: FR-01, FR-02；design §5.W2.1/§7 extract_spec_bindings 规则
- evidence: docs/.sillyspec 命令样例（quick --done --change quick-990f8c09）；quicklog_parser.py:38（ql_id 格式）
- 锚点: backend/app/modules/change/binding.py（extract_spec_bindings）
- 模块域: backend, change
- priority: P0

## D-005@v1
- type: parsing-rule
- status: superseded（by D-005@v2）
- source: brainstorm step3（锚点报告 §3：`sillyspec run scan --done --change default` 样例）
- question: --change default 要绑吗？
- answer: 跳过。default 是 CLI 无名操作伪键，绑定会污染变更列表（placeholder 行）。
- normalized_requirement: extract_spec_bindings 对 change_key=='default' 不产出。
- impacts: FR-01；design §5.W2.1
- evidence: 锚点报告 §3 命令样例
- 锚点: backend/app/modules/change/binding.py
- 模块域: backend, change
- priority: P1

## D-006@v1
- type: frontend
- status: confirmed
- source: brainstorm step3-4（对齐 2026-08-22-workspace-sessions-portal D-002@v1 变更级门户模式；用户"快速修复补弹出会话"诉求）
- question: 快速修复的"弹出会话"承载形态？
- answer: 对齐变更：quicklog 抽屉新增关联会话卡（预览+深链）+ 新路由 /workspaces/[id]/quicklog/[qlId]/sessions（QuicklogScope 门户，组头＋新建自动绑定本快速修复）；悬浮会话 preContext 加 quickId 顺手补齐。不建独立详情页（遵循 quicklog D-006@v1 不建路由页先例，门户路由是会话域不是详情域）。
- normalized_requirement: 快速修复侧可见关联会话、可弹出工作台、可新建绑定会话；深链 ?session= 恢复复用门户既有逻辑。
- impacts: FR-04, FR-06；design §5.W4
- evidence: change-sessions-card.tsx（变更卡先例）；changes/[cid]/sessions/page.tsx（门户薄壳先例）；stores/floating-session.ts:24-28
- 锚点: frontend/src/app/(dashboard)/workspaces/[id]/quicklog/[qlId]/sessions/page.tsx（新建）
- 模块域: frontend, frontend_components, frontend_stores
- priority: P0

## D-005@v2
- type: consistency
- status: confirmed
- supersedes: D-005@v1
- source: design-grill（X-004：v1 只在命令解析通道跳过 default，agent-logs hub 分支消费 entry.change_key 时仍会建 'default' placeholder 变更行并绑定，与 v1 防污染目标自相矛盾）
- question: default 伪键跳过应该在哪个层级生效？
- answer: 收敛到 `bind_session_to_change` 函数内部：change_key=='default' 直接返回。命令解析层保留跳过作为第一道（少做无谓查询），函数内部兜底为第二道——两个写通道（run_sync 命令解析、platform_sync agent-logs hub）统一受保护。
- normalized_requirement: 任何通道调用 bind_session_to_change('default') 均无副作用（无 placeholder 行、无 link 行）；test_spec_binding 样例库覆盖两通道的 default 用例。
- impacts: FR-01, FR-02；design §5.W1.3/W2.1/W2.2
- evidence: grill X-004（platform_sync/service.py:715-729 hub 分支将消费 entry.change_key）；schema.py entry change_key 可为 'default'（CLI default 语境）
- 锚点: backend/app/modules/change/binding.py（bind_session_to_change 开头守卫）
- 模块域: backend, change, platform_sync
- priority: P1
