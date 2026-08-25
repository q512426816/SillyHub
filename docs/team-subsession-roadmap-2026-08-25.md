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

- [ ] 子会话↔mission 挂载链（AgentSession 加 mission 锚或 parent_session_id；
  现状 `get_active_mission_for_session` 只认第 0 层主会话，子会话 turn run 挂不上
  mission_id/role → 治理门/成本/kill 名单漏算；worker 会话无 workspace_id）。
- [ ] 「子会话完成」显式信号：替换"run 终态=分身完结"判据（busy 判定/
  awaiting_input 时钟/patrol 超时/worktree 清理时机全建立在旧判据上）。
- [ ] converge/cancel → 批量 end_session(SESSION_END) 链路（converge 现在不关任何
  会话；interactive lease 永不过期 → 孤儿烧 token）。
- [ ] 归属决策：子会话 owner = mission 创建者还是 daemon/apiKey 属主
  （影响追问 owner-only、权限卡片 owner-only、门户可见性、审计）。

### P2 递归开闸（独立开关，P1 之后）

- [ ] 深度上限（stage 编码深度或 metadata 新字段；daemon 谓词 + backend 派发门双保险）。
- [ ] converge 权限收口：只许第 0 层主控收敛（现状任何 apiKey 身份可对任意 mission 调）。
- [ ] 预算树上聚合（现状 mission.budget_tokens 原样塞每个子会话各自为限 → N 倍超支）。
- [ ] daemon 级存活会话/进程上限（现状无总闸；每会话 ≈3 常驻子进程）。

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
