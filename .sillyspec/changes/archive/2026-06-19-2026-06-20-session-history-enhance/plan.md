---
author: qinyi
created_at: 2026-06-20T01:00:00
---

# plan: 交互式会话历史回看体验增强

- plan_level: **full**
- design：`design.md`｜decisions：D-001@v1、D-002@v1、D-003@v1、D-004@v1、D-005@v1 全 accepted｜requirements：FR-1~3
- 无 Spike（两轮调研已验证 SDK resume 可行性）

## 任务总表

| ID | 任务 | 模块 | 优先级 | Wave | 依赖 | 决策 |
|---|---|---|---|---|---|---|
| task-01 | create/inject 落 AgentRunLog(channel=user) | backend | P0 | 1 | — | D-001 |
| task-02 | SessionHistoryView 按 channel 渲染 | frontend | P0 | 2 | task-01 | D-001 |
| task-03 | delete 去 active 拒绝、active 先 end 再删 | backend | P0 | 1 | — | D-003 |
| task-04 | SessionsSidebar 去 {!active} 删除限制 | frontend | P0 | 2 | task-03 | D-003 |
| task-05 | reopen_session + POST /reopen + 错误码 | backend | P0 | 1 | — | D-002/D-004 |
| task-06 | protocol SESSION_RESUME + GET /sessions/{id} | backend | P0 | 1 | — | D-002 |
| task-07 | reopen 状态转换+新 lease+rotate token+发 WS | backend | P0 | 2 | task-05, task-06 | D-002 |
| task-08 | daemon SESSION_RESUME route 调 restoreAndReconnect | daemon | P0 | 3 | task-06, task-07 | D-002 |
| task-09 | reopenSession + getAgentSession API | frontend | P0 | 2 | task-05, task-06 | D-002 |
| task-10 | InteractiveSessionPanel attach 模式+轮询 | frontend | P0 | 4 | task-08, task-09 | D-002 |
| task-11 | 续聊按钮 + SessionListSection 接线 | frontend | P0 | 5 | task-10 | D-002/D-004 |
| task-12 | 模块文档同步 + 测试补齐 | doc/test | P1 | 6 | task-01~11 | D-001~D-005 |

总任务 12（≤15）。P0×11 + P1×1。D-001~D-005 全覆盖可追踪。

## Wave 分组（按 depends_on 拓扑排序，同 Wave 内无依赖可并行）

### Wave 1（无依赖，可并行）
- [x] task-01: backend create/inject 落 AgentRunLog(channel=user)
- [x] task-03: backend delete 去 active 拒绝、active 先 end 再删
- [x] task-05: backend reopen_session + POST /sessions/{id}/reopen + 错误码
- [x] task-06: backend protocol SESSION_RESUME + GET /sessions/{id} + get_agent_session

### Wave 2
- [x] task-02: frontend SessionHistoryView 按 channel 渲染（← task-01）
- [x] task-04: frontend SessionsSidebar 去 {!active}（← task-03）
- [x] task-07: backend reopen 状态转换+新 lease+发 WS（← task-05, task-06）
- [x] task-09: frontend reopenSession + getAgentSession API（← task-05, task-06）

### Wave 3
- [x] task-08: daemon SESSION_RESUME route 调 restoreAndReconnect（← task-06, task-07）

### Wave 4
- [x] task-10: frontend InteractiveSessionPanel attach 模式+轮询（← task-08, task-09）

### Wave 5
- [x] task-11: frontend 续聊按钮 + SessionListSection 接线（← task-10）

### Wave 6
- [x] task-12: 模块文档同步 + 测试补齐（← task-01~11）

无循环依赖。Wave 1 可并行启动 4 个独立任务。

## 关键路径（拓扑最长链）
`task-05 → task-07 → task-08 → task-10 → task-11 → task-12`（续聊主链路，6 步）

## 依赖关系
```
Wave1: task-01, task-03, task-05, task-06   (无依赖, 并行)
Wave2: task-02(←01), task-04(←03), task-07(←05,06), task-09(←05,06)
Wave3: task-08(←06,07)
Wave4: task-10(←08,09)
Wave5: task-11(←10)
Wave6: task-12(←01..11)
```

## 调用点搜索（接口/DTO/client 变更）
- `InteractiveSessionPanel` props 新增 attach 模式 → 调用点 `SessionListSection`/`InteractiveSessionChatSection`（`runtimes/page.tsx:379/1031`）→ task-11
- `AgentRunLogEntry` type 加 channel → 调用点 `SessionHistoryView`（`page.tsx:957`）→ task-02
- backend reopen/delete → 调用点 `lib/daemon.ts` → task-09/task-04
- daemon `SESSION_RESUME` → 调用点 `_routeSessionControl`（`daemon.ts:1375`）→ task-08
- 搜索：`grep -rn "InteractiveSessionPanel\|AgentRunLogEntry\|reopenSession\|deleteAgentSession\|_routeSessionControl" frontend/src sillyhub-daemon/src backend/app`（已纳入各 task）

## 全局验收标准（对照 requirements FR）
- **FR-1**（D-001/D-005）：新建会话发 2 条 → 回看含 2 用户气泡(右)+agent 回复(左)按 turn 分组；旧会话不报错仅显 agent
- **FR-2**（D-002/D-004）：ended/failed claude 续聊保留上下文；codex/无 agent_session_id 置灰；active 不显示续聊；reopen 返回 reconnecting、轮询到 active 启用输入
- **FR-3**（D-003）：任意状态可删；active 删后 daemon session 关+lease completed+run/logs 保留
- **兼容性**（brownfield）：存量旧会话回看不报错（D-005）；Wave 不稳可前端隐藏续聊入口回退

## 风险回退
详见 `design.md §11`。关键：SDK resume 失败→backend failed+前端提示；reopen 不 confirm→reconnecting 超时 sweep+前端 ~15s 回退只读；Wave 5 不稳→前端 feature flag 隐藏续聊入口（Wave 1~4 不受影响）。

## 测试（local.yaml）
- backend：`cd backend && uv run pytest`（reopen/delete-active/user-log）
- daemon：`cd sillyhub-daemon && pnpm test`（SESSION_RESUME route + restoreAndReconnect）
- frontend：`cd frontend && pnpm test`（channel 渲染/续聊可用性/删除全状态）
- test_strategy: module
