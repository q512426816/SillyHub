# 决策知识 — hooks-message-queue

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-hooks-message-queue-001@v1 2026-10-15-session-turn-completion-semantics——上一变更把绿点/完成通知锚定在会话终态 ended，但平台里一轮任务跑完后会话仍是 active（只有手动结束才 ended），用户在阿里云部署实测「跑完无绿点
状态：implemented
变更：2026-10-15-session-turn-completion-semantics
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-15-session-turn-completion-semantics/design.md
文件：frontend/src/components/sessions/__tests__/session-list-panel.test.tsx, frontend/src/components/sessions/session-list-panel.tsx, frontend/src/hooks/__tests__/use-session-liveness.test.ts, frontend/src/hooks/use-session-liveness.ts, frontend/src/lib/session-completed-unread.ts
最近确认：未记录
理由：上一变更把绿点/完成通知锚定在会话终态 ended，但平台里一轮任务跑完后会话仍是 active（只有手动结束才 ended），用户在阿里云部署实测「跑完无绿点无通知」。本变更把「执行完成」改为轮次级口径（用户确认）：活性 working/blocked→idle 转移即一轮执行结束。实现上把完成通知存储抽为单一源 `lib/session-completed-unread.ts`（一键一角标），use-session-liveness 的转移检测改写完成标记（取代原红色「空闲未读」——两者本就是同一时刻同一事件的两种颜色，合并后语义唯一），并新增 suppress 谓词（正选中该会话不标记，与面板终态来源判等口径一致）；面板 sessionStatusIndicator 增补「活性 idle + 完成标记 → 绿点」分支（点击进入后随角标一并消失回归留白），红色未读管线整体退役。 改四个文件：新 lib、use-session-liveness.ts（标记语义 + suppress）、session-list-panel.tsx（去 livenessUnread 管线 + 判定分支）、两测试文件重写对应断言。后端与 API 契约零变化。
