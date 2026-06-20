---
author: qinyi
created_at: 2026-06-20T02:40:00
---

# module-impact: 交互式会话历史回看体验增强

## 三重交叉验证
- **声明范围**（design §13 文件变更清单）：backend daemon module + sillyhub-daemon src/tests + frontend lib/page/panel/tests + 4 docs
- **任务范围**（plan.md / task-01~12 allowed_paths）：一致
- **真实变更**（git diff 主 repo）：一致
- 结论：三方一致，以 git diff 为准

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| backend | 逻辑变更 + 接口变更 + 数据结构变更 | `app/modules/daemon/service.py`（create/inject 落 user_input log、delete 去 active 拒绝+active先end、新增 reopen_session/get_agent_session、删 DaemonSessionDeleteConflict）、`router.py`（POST /sessions/{id}/reopen + GET /sessions/{id}）、`protocol.py`（DAEMON_MSG_SESSION_RESUME 常量）、`schema.py`（SessionReopenResponse）、`tests/`（test_session_reopen/user_log/delete_active + test_session_history 改） | reopen 续聊端点 + WS 常量 + 用户消息落库（AgentRunLog channel=user_input，无 migration）+ 任意状态删除 | false |
| sillyhub-daemon | 逻辑变更 + 接口变更 | `src/daemon.ts`（_routeSessionControl 加 SESSION_RESUME 分流 + _routeSessionResume 调 restoreAndReconnect + null 守卫）、`src/protocol.ts`（SESSION_RESUME 常量）、`tests/`（daemon-session-resume-route + protocol-session-contract） | daemon 收 session_resume → SDK resume（复用 restoreAndReconnect，未改 SDK/SessionManager 核心） | true（_module-map 索引基于旧 Python scan，实际 TS） |
| frontend | 逻辑变更 + 接口变更 | `app/(dashboard)/runtimes/page.tsx`（SessionHistoryView channel 渲染 + 续聊按钮 + SessionListSection attach 接线 + logsToTurns）、`page.test.tsx`、`components/daemon/interactive-session-panel.tsx`（attach 模式 + 轮询）、`__tests__/interactive-session-panel.test.tsx`、`lib/daemon.ts`（reopenSession/getAgentSession）、`lib/daemon.test.ts`、`lib/agent.ts`（AgentRunLogChannel 加 user_input） | 历史回看用户/agent 气泡 + 任意状态删除按钮 + reopen 续聊 attach 面板 + API | false |
| docs | 文档变更 | `docs/multi-agent-platform/modules/{backend,frontend,sillyhub-daemon}.md`（变更索引）、`docs/frontend/modules/app-pages.md`（MANUAL_NOTES） | 变更索引追加 + 回看/续聊/删除说明 | false |

## 未匹配文件
无。所有改动文件均匹配到 backend / sillyhub-daemon / frontend / docs 模块（主项目 _module-map 粗粒度 paths glob `backend/**` / `sillyhub-daemon/**` / `frontend/**`）。

## 备注
- 主项目 `_module-map.yaml` 为粗粒度（backend/frontend/sillyhub-daemon/deploy/docs），sillyhub-daemon 标 `needs_review: true`（索引描述旧 Python，实际已 TS 重写，本次改动以实际 `src/` TS 源码为准）
- interactive-session-panel.tsx 在 frontend 细粒度 _module-map 未注册（孤儿组件），归入 frontend 模块（page.tsx 命中 app-pages）
- 无 Alembic migration（AgentRunLog.channel 为 String 列，新增 user_input 取值无需 DDL）
