---
author: qinyi
created_at: 2026-09-08 00:02:00
---
# 模块影响分析（Module Impact）— 会话置顶/重命名 + 定时发送

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend:agent | 修改 | model.py：AgentSession 加 pinned_at 列 + ix_agent_sessions_pinned_at 索引（照 archived_at 先例）；AgentSessionQueuedMessage 邻域新增 AgentSessionScheduledMessage 表（快照字段/四态 status/FK CASCADE/复合索引 ix_agent_ssm_session_status_dispatch） |
| backend:daemon | 修改+新增 | schema.py（AgentSessionRead.pinned_at + SessionTitleUpdateRequest + ScheduledMessageCreateRequest/Read）；router.py（pin/unpin/title 三 PATCH 204 + scheduled POST/GET/DELETE 三端点 + q 参数过时注释修正）；service.py 门面六委托；session/service.py（pin/unpin/rename 照 archive 模板 + list_agent_sessions 排序前置谓词 + scheduled CRUD 实现）；NEW scheduled_send.py（sweep_once 四分支 + 30s 常驻循环）；main.py lifespan 注册 scheduled-send-sweeper（三段关停契约） |
| backend:migrations | 新增 | 20260907231000_add_session_pin_title_scheduled.py（down_revision=20260907141041 当前 head）：加列/索引/建表，纯 DDL 无回填 |
| backend:daemon-tests | 新增 | tests/ 三文件：test_session_pin_rename.py（幂等/404/排序/422/SSE）、test_scheduled_messages_crud.py（时间/内容/终态/列表序/取消 409）、test_scheduled_send_sweeper.py（四分支含 queue_full + 失败隔离 + 幂等） |
| frontend:session-list | 修改 | session-list-panel.tsx：SessionRow hover 按钮区加置顶/取消置顶/重命名按钮（Pin/PinOff/Pencil）、行内重命名编辑态（Enter/blur 提交、Esc 取消）、置顶 Pin 徽标（brand 阶）；renaming 状态防重入照 archiving 模式 |
| frontend:sessions-portal | 修改 | sessions-portal.tsx：onPinSessions/onUnpinSessions/onRenameSession 三回调接线（dynamic import lib/daemon → Promise.allSettled → invalidate ["agentSessions"] → toast），重命名不动 ?session= 深链 |
| frontend:daemon-components | 修改+新增 | session-input-bar.tsx 发送左侧 ⏰ 定时按钮（Clock，可选 onSchedule）；session-panel.tsx 定时 Modal 接线 + ScheduledMessagesBar page/dialog 双点挂载 + 创建成功系统提示行；NEW scheduled-messages-bar.tsx（四态 tag + pending 取消 + 局部 QueryClientProvider 收口 dialog 零 useQuery 约束） |
| frontend:hooks | 新增 | use-scheduled-messages.ts（react-query queryKey [agentSessions, scheduled, sessionId] 30s 轮询 + invalidate） |
| frontend:lib | 修改 | daemon.ts 六 API 函数（pin/unpin/renameAgentSession + create/list/cancelScheduledMessage，照 archiveAgentSession 模板）；api-types.ts 经 pnpm gen:types 再生成（不手写，规则 21） |
| frontend:tests | 修改+新增 | sessions/__tests__/session-list-panel.test.tsx 补用例；NEW daemon/__tests__/scheduled-messages-bar.test.tsx + hooks/__tests__/use-scheduled-messages.test.ts |
| docs（.sillyspec modules） | 修改 | 归档时同步：backend.md / frontend.md 变更索引条目（execute/verify 阶段不动，archive 阶段处理） |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/openapi.json、frontend/src/lib/api-types.ts | 生成物，task-05 跑 pnpm gen:types 再生成，不手改 |
| .sillyspec/.runtime/stage-reviews/* | 流程运行时产物（审查证据），不入模块映射 |

## 关联任务

W1：task-01（模型与迁移）；W2：task-02（置顶/重命名/排序）；W3：task-03（scheduled CRUD）；W4：task-04（sweeper）+ task-05（gen:types+API 函数）；W5：task-06（backend 测试）+ task-07（会话树 UI）+ task-08（定时 UI）；W6：task-09（前端测试）；W7：task-10（回归）。

## 更新结果

| 目标 | 操作 | 状态 |
|---|---|---|
| （plan 阶段首版，待 execute 后按实际 diff 复核） | — | — |
