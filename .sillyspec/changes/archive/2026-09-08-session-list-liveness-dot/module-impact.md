---
author: qinyi
created_at: 2026-09-08 00:45:00
---
# 模块影响分析（Module Impact）— 会话列表活性小灯 + idle 未读点

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| frontend:frontend_lib | 新增 | hooks/use-session-liveness.ts：useQuery 固定 "all" 槽 30s 轮询调既有 listWorkspaceAgentLogs(100)（lib/agent-logs.ts 零修改）+ 客户端转移检测状态机（localStorage 两键 try/catch 降级）+ isUnread/clearUnread helper |
| frontend:frontend_components | 修改 | components/sessions/session-list-panel.tsx：SessionListPanel 调 hook 经 props 链（WorkspaceTreeList→WorkspaceGroupNode→SessionRow）传 liveness/livenessUnread；SessionRow 行尾 antd Popover（portal）包裹 18px LivenessDot + 组合渲染悬停卡（LIVENESS_META/静默时长/证据/推导时间）+ 未读红点（selected 置真 useEffect 清除）；布局零变化（不新增列） |
| frontend:tests | 修改+新增 | sessions/__tests__/session-list-panel.test.tsx 补用例（mock 集补 vi.mock @/lib/agent-logs）；NEW hooks/__tests__/use-session-liveness.test.ts（状态机各边/map/queryKey） |
| backend | 无改动 | 数据全部来自既有 GET /api/agent-logs（platform_sync 域零触碰）；无迁移无 gen:types |
| docs（.sillyspec modules） | 修改 | 归档时同步：frontend.md 变更索引条目（execute/verify 阶段不动，archive 阶段处理） |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| .sillyspec/.runtime/stage-reviews/* | 流程运行时产物（审查证据），不入模块映射 |

## 关联任务

light 单隐式 Wave 串行：task-01（hook）→ task-02（组件）→ task-03（测试）。

## 更新结果

| 目标 | 操作 | 状态 |
|---|---|---|
| （plan 阶段首版，待 execute 后按实际 diff 复核） | — | — |
