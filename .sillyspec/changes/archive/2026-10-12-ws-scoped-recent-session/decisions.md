---
author: flow-machine-draft
created_at: 2026-10-12T07:43:20.760Z
---
# 决策记录（Decisions）— 2026-10-12-ws-scoped-recent-session

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：过滤依赖 `AgentSessionRead.workspace_id` 字段可靠性——后端该字段自 2026-08-22 起即为列表稳定字段（深链选中快照同源消费，sessions-portal.tsx:1072），风险低；测试以跨工作区固件直接锁定。次要风险：三入口共分支若未来新增 scope 种类（如 runtime 空门户化）需显式决策过滤维度，本变更注释已留判别说明。 试过但放弃的方案：① 工作区入口直接取消「继续最近会话」——丢功能，本工作区有历史会话时快捷续聊路径消失；② 后端新增按工作区查最近会话端点——旁路数据已在手，属过度设计；③ 顺带把 resolveDefaultMachineId 也按 scope 过滤——机器是用户偏好非工作区内容，在 A 工作区默认选用户最近用过的机器是合理语义，改动反成回归。
