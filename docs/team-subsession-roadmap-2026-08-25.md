# 团队分身子会话化路线图（2026-08-25 立项）

> 来源：2026-08-25 会话探索 + 双子代理风险调研（daemon 侧 + backend/UI 侧）。
> 结论：分身今天已是 kind=interactive 的 SDK 会话（placement.py D-002@v3），
> 改造实质是"承认分身是会话"的治理接线 + 递归开闸 + UI，无结构性障碍。
> 本文档是 P0→P3 推进顺序的单一锚点，各阶段落地后在此勾选并链接变更名。

## 背景结论（调研已证实）

- 分身运行形态已是 SDK 交互会话：`placement.py:485-535` 统一插 `kind='interactive'` lease
  + AgentSession 行；daemon 按 kind 分流走 SessionManager → claude-agent-sdk。
- 防递归闸：`stage='mission_worker'` 被 daemon `isMainAgentSession` 谓词
  （`sillyhub-daemon/src/cli.ts:787-791`）排除，不给 5 个派工 MCP 工具。
- 用户目标：分身 = 完整子会话（流式/追问/权限卡片/恢复），且子会话可递归开子会话。

## 推进阶段

### P0 存量 bug 修复（与子会话解耦，先行）

- [x] **P0-1** daemon 会话持久化恢复丢 stage：`session-store-persistence.ts`
  `validateRecord` 不回填 `stage/mcpRefs/skillRefs/effectiveAllowedRoots`，与
  `interactive/types.ts:646` 声明矛盾。后果：重启后 mission_worker 会话 stage 变空 →
  谓词命中 → 被静默注入派工工具，防递归防线重启即失效。
  **已完成（ql-20260825-012-89d6，commit 91227636）**：isStringArray 守卫 + 四字段容错回填。
- [x] **P0-2** backend `cancel_lease` 对 interactive 的 lease-None 分支不发
  SESSION_END（`lease_service.py:432-448`，注释自认是内存僵尸缺口）。
  **已完成（ql-20260825-013-c299，commit 6e0b6396）**：by-run miss 后沿
  run→session→lease_id 回捞 interactive lease 复用主路径；测试 fixture 一并改回
  生产形态（原误写 agent_run_id=run_id 掩盖盲区）。

### P1 子会话治理地基（主变更，brainstorm 后实施）

> **P1 已实现并 verify 通过（2026-08-26）**：变更 `2026-08-25-team-subsession-governance`
> 全流程完成（brainstorm Grill 两轮 → plan 独立审查三轮 → execute 7 波 15 任务 →
> verify PASS WITH NOTES）。实现主干：48ac10f4 + merge 01406142 + verify fceb864c。
> 三端全量 4618/2268/2821 零失败。剩余：**人工确认后 archive**；Docker 部署实例
> 需重建镜像后新能力才在 8001 入口生效。

- [x] 子会话↔mission 挂载链（AgentSession 加 mission 锚或 parent_session_id；
  现状 `get_active_mission_for_session` 只认第 0 层主会话，子会话 turn run 挂不上
  mission_id/role → 治理门/成本/kill 名单漏算；worker 会话无 workspace_id）。
- [x] 「子会话完成」显式信号：替换"run 终态=分身完结"判据（busy 判定/
  awaiting_input 时钟/patrol 超时/worktree 清理时机全建立在旧判据上）。
- [x] converge/cancel → 批量 end_session(SESSION_END) 链路（converge 现在不关任何
  会话；interactive lease 永不过期 → 孤儿烧 token）。
- [x] 归属决策：子会话 owner = mission 创建者还是 daemon/apiKey 属主
  （影响追问 owner-only、权限卡片 owner-only、门户可见性、审计）。

### P2 递归开闸（独立开关，P1 之后）

> **P2 已实现并 verify 通过（2026-08-26）**：变更 `2026-08-26-team-subsession-recursion`
> 全流程完成（brainstorm Grill 两轮 → plan 独立审查一次 pass → execute 5 波 9 任务 →
> verify PASS WITH NOTES → archive）。实现合并 d6b1426b。三端全量 4694/2855/2268。
> 递归形态：总深 3 层（主控 0/分身 1/孙 2），非叶分身 5 件工具（派工集+收敛收口），
> converge/report_progress 主控独有；预算强收+会话闸+失败即收口配套齐备。

- [x] 深度上限（tree_depth 列 NOT NULL DEFAULT 0 + lease worker_depth 透传；backend 400 门 + daemon 叶档单工具双保险，双侧常量=2 有锁漂移断言）。
- [x] converge 权限收口：层 0 四通道守卫（分身 403/apiKey 裸调 403/Bearer 豁免/主控过）。
- [x] 预算树聚合：patrol 职责⑥强收（budget_force_ended_at 原子标记 + 批量收口 + 强收后可收敛 degraded 映射）。
- [x] daemon 级存活会话上限：SILLYHUB_MAX_ACTIVE_SESSIONS 默认 20（0 不限，restore 豁免）+ run_sync 失败即收口。

### P3 UI

- [ ] 分身行 → 子会话面板（TeamMissionWorkerSummary 加 agent_session_id +
  gen:types + 复用 session-panel）。
- [ ] 会话门户父子分组（origin 新值或折叠组，参考 tool_report 小节模式）。
- [ ] 按需开流（HTTP/1.1 同域 6 SSE 连接上限；只开当前查看的子会话）。

## 顺带发现（不阻塞主线，见机修）

- `list_workers` MCP 不排除主控轮，与 UI 数据源口径不一致（`mcp_tools.py:1009`）。
- session 路径不写 AgentRunWorkspace 关联行（ql-20260825-003 修的是 batch 路径同款）。
- per-worker worktree 的 SDK transcript 在副本删除后残留无人清理。
- 权限 AskUserQuestion dialog 无超时，无人应答永久挂起 turn。
