---
author: qinyi
created_at: 2026-08-22 03:10:07
---

# 决策台账 — 2026-08-22-team-session-unify

> 本文件是本变更的决策台账，只记录有实现/验收影响的决策。长期术语在 archive/scan 时提升到 glossary.md。

## D-001@v1: 团队=会话内能力而非独立会话类型
- type: architecture
- status: accepted
- source: user
- question: 团队会话如何集成到统一会话体验？（独立会话类型 vs 会话内能力）
- answer: 用户明确：团队类似子代理——当前会话的 agent（主控）通过 MCP 工具派分身（worker），进度与结果回到当前消息流，全程不离开对话。不新增会话类型、不新增列表条目、没有独立团队页面。
- normalized_requirement: 团队操作发生在既有 AgentSession 内；分身状态经消息流内嵌块呈现；/sessions 列表与新建表单无团队专属类型。
- impacts: [FR-01, FR-04, design §总体方案]
- evidence: 用户 2026-08-22 对话（原型 v1 被否、v2 通过）；prototype-team-session-unify.html
- priority: P0

## D-002@v1: 团队工具常驻注入（Claude 引擎）
- type: architecture
- status: accepted
- source: user
- question: 团队 MCP 工具何时注入给会话 agent？（常驻 vs 首次触发按需注入+重载）
- answer: 用户拍板 A：所有 Claude 引擎交互会话默认注入 5 个团队工具，agent 自主判断派分身；「派团队」按钮/指令仅为前端引导，无协议级切换。依据查证：turn 级注入现状不存在，常驻零机制成本。
- normalized_requirement: daemon `isMainAgentSession` 谓词放宽为 provider=claude 恒真；不新增控制消息；工具描述须含「仅用户明确要求时派团队」约束。
- impacts: [FR-02, design §Phase 2, task daemon 注入]
- evidence: 用户 2026-08-22 02:59 后回复"按你推荐继续"；查证 cli.ts:719、session-manager.ts:1049-1090
- priority: P0

## D-003@v1: 一期 Claude 专属，Codex 按钮置灰
- type: boundary
- status: accepted
- source: user
- question: Codex 引擎会话如何处理？（Codex driver 现不消费 mcpServers）
- answer: 一期仅在 Claude 引擎会话提供团队能力；Codex 会话中触发入口置灰并提示「团队需要 Claude 引擎」。Codex MCP 注入另立后续变更（codex driver 契约注释已标"留后续任务"）。
- normalized_requirement: Codex 会话不注入团队工具；前端触发按钮对 Codex 会话 disabled + tooltip 说明。
- impacts: [FR-02, design §Phase 2/3]
- evidence: 用户 2026-08-22 02:59 后回复；interactive/driver.ts:139 注释、codex-app-server-driver.ts 无 mcpServers 消费
- priority: P0

## D-004@v1: 触发四路等价
- type: architecture
- status: accepted
- source: user
- question: 会话中如何触发团队？
- answer: 原型 v2 确认四条等价路径：①输入区「派团队」按钮+配置弹层 ②/team 指令前缀 ③自然语言（agent 常驻工具自主判断）④AskUser 卡选择。四路最终统一到同一条后端链路（显式预建或懒建 mission）。
- normalized_requirement: 按钮与 /team 走预建端点（带 scope/预算配置）；自然语言走 dispatch_worker 懒建兜底（默认当前工作区/无限预算）。
- impacts: [FR-03, design §Phase 1/3]
- evidence: prototype v2 §02 用户评审通过；用户立项提示词"触发四路等价"
- priority: P0

## D-005@v1: 删除独立团队页面与入口
- type: boundary
- status: accepted
- source: user
- question: 旧 mission-console 页面与菜单怎么处理？
- answer: 删除 /workspaces/[id]/missions、/projects/[id]/missions 两个页面路由、mission-console 组件与「Agent 团队」菜单项；普通会话面板的「用团队分析」按钮改为在当前会话直接触发团队；历史 mission 数据不做迁移（项目未上线允许重置）。
- normalized_requirement: 上述路由/组件/菜单删除后全仓无引用；gen:types 同步；无历史数据兼容负担。
- impacts: [FR-06, design §Phase 4]
- evidence: 用户立项提示词"删独立 missions 页面/路由/菜单"；CLAUDE.md 规则 11
- priority: P0

## D-006@v1: AgentMission 新增 session_id 列绑定发起会话
- type: compatibility
- status: accepted
- source: code
- question: mission 如何关联发起会话？（既有 session_id 放 constraints JSON 但无人消费）
- answer: 代码查证：AgentMission 无 session_id 列，旧"用团队分析"把 session_id 塞 constraints JSON 且全链路无消费（死参数）。本变更新增 agent_missions.session_id 列（FK agent_sessions，索引），废弃 constraints.session_id 约定。
- normalized_requirement: alembic migration 加列；所有 mission 创建路径（预建/懒建）写入 session_id；会话侧查询按 session_id 取活跃 mission。
- impacts: [FR-01, design §数据模型/Phase 1]
- evidence: model.py:630-742 全字段核对；router.py:989-990（constraints 死参数）
- priority: P0

## D-007@v1: worker 独立 lease/会话结构不变
- type: architecture
- status: accepted
- source: code
- question: 分身 run 与主控会话的 lease 关系？
- answer: 代码查证：worker=独立 lease+独立 AgentSession+独立 worktree（execution.py:153-349、placement.py:484-539）。本变更维持该结构，仅主控侧从"mission 专属会话"改为"发起会话当轮 run"。
- normalized_requirement: worker 派发链路（worktree 隔离/scope 校验/治理门）零改动复用。
- impacts: [FR-01, design §总体方案]
- evidence: execution.py:225-324、placement.py:484-539
- priority: P1

## D-008@v1: 会话结束与团队任务并存
- type: boundary
- status: accepted
- source: code
- question: 发起会话结束时 running 的团队任务怎么办？
- answer: worker 独立 lease 存活不受会话影响；mission 收敛由主控工具调用与 patrol 兜底完成；用户重新开启会话（reopen 基建已有）可继续看到任务块与结果。
- normalized_requirement: 会话 end 不触发 mission 取消；patrol 对"主控会话非活跃"的 mission 按超时自动收敛而非判死。
- impacts: [FR-05, design §5 Phase 1 patrol 适配]
- evidence: session-reopen-resume 变更（ROADMAP 2026-08-21）；patrol.py 现有三重收敛
- priority: P1

## D-002@v2: 团队工具常驻注入（Claude 引擎，分身会话除外）
- type: architecture
- status: accepted
- supersedes: D-002@v1
- source: design-grill
- question: v1 谓词"provider=claude 恒真"会把工具也注入分身（worker）会话，分身可递归派发、干扰 converge（Grill CC-12）
- answer: 谓词收窄：provider==='claude' 且 stage 非 worker 标识（stage 为空=普通会话或 'orchestrator'=存量主控 → 注入；分身角色/'mission_worker' → 不注入）。用户授权来源同 v1（按推荐继续）。
- normalized_requirement: 分身会话不注入团队工具；普通/主控会话注入不变。
- impacts: [FR-02, design §5 Phase 2]
- evidence: Grill CC-12（execution.py:322 worker stage=run.role）；用户 step3 预授权
- priority: P0

## D-007@v2: worker 派发链路复用（治理门查询加判别）
- type: architecture
- status: accepted
- supersedes: D-007@v1
- source: design-grill
- question: v1"零改动"表述过宽——主控轮回填 mission_id 后会被治理门/workers 列表/成本统计按 mission_id 全量查询误计入（Grill B3/CC-05）
- answer: 收窄为"派发链路（worktree/scope 校验/治理门规则/预算扣减）复用"；control.py 等查询条件加 role!='orchestrator' 判别。
- normalized_requirement: MAX_WORKERS 并发额度、成本统计、workers 列表均只计分身 run。
- impacts: [FR-01, design §5 核心机制]
- evidence: Grill B3（control.py:39-87）
- priority: P1

## D-009@v1: 主控轮双标记 mission_id + role='orchestrator'
- type: architecture
- status: accepted
- source: design-grill
- question: 主控 run 从"mission 专属 run"变为"会话当轮 run"后，converge/finalize 锚点（_get_main_run 查 role='orchestrator'）与治理门判别如何统一？（Grill B2/B3）
- answer: 会话存在活跃 mission 时 inject 当轮 AgentRun 回填 mission_id + role='orchestrator' 双标记；_get_main_run 取该 mission 最新 orchestrator run（存量 external mission 同规则天然兼容）；治理门/统计查询加 role!='orchestrator' 判别。
- normalized_requirement: derive_status/control/finalizer 三处依赖均以双标记区分主控轮与分身 run。
- impacts: [FR-01/FR-04, design §5 核心机制, task backend]
- evidence: Grill B2/B3（mcp_tools.py:363-374、control.py:39-87、finalizer.py:545-578）
- priority: P0

## D-010@v1: converge 语义重定义（session 定位 + busy 引导 + 独立置位）
- type: architecture
- status: accepted
- source: design-grill
- question: 旧 converge 锚定 mission 专属 orchestrator run 且依赖其完成；新链路 prompt 下线后 id 无来源、mid-turn 调用无置位路径（Grill B1/B2）
- answer: converge 按 X-Session-Id 解析 mission；分身未全终态返回 status=busy 引导 agent 等待；全终态直接置 converged_at（不依赖主控 run 状态）→ finalize 锚点=最新 orchestrator run；响应 status ∈ converged/busy/conflict/needs_manual。
- normalized_requirement: converge 不再 404；busy 幂等可重入；终态置位与 finalize 分离锚定。
- impacts: [FR-04/FR-05, design §7.5]
- evidence: Grill B1/B2（mcp-server.ts:169-210、mcp_tools.py:363-374）
- priority: P0

## D-011@v1: 旧 mission 端点删除范围精确化
- type: boundary
- status: accepted
- source: design-grill
- question: v1"旧创建端点删除"未核引用面——GET /missions/{id} 与 cancel 被 team-progress.tsx（change 详情）使用（Grill CC-07）
- answer: 删除范围=create+list 四端点及对应前端 client；保留 GET /missions/{id}、POST /missions/{id}/cancel、全部 MCP 端点；team-progress.tsx 不动。
- normalized_requirement: 删除后全仓无 dangling 引用；change 详情团队进度功能不回归。
- impacts: [FR-06, design §5 Phase 4]
- evidence: Grill CC-07（team-progress.tsx:33-113、interactive-session-panel.tsx:74）
- priority: P1

