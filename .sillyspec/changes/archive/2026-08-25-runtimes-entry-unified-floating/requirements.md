---
author: qinyi
created_at: 2026-08-25 15:30:00
---
# 需求（Requirements）— /runtimes 会话入口统一为智能会话助手 + 抽屉列表换工作区树

- FR-01 /runtimes 某 runtime 点「会话」唤起全局悬浮会话助手，抽屉头部显示「🔒 {机器} · {智能体}」锁定徽标，不再渲染旧 RuntimeSessionDialog。
- FR-02 抽屉左侧列表只显示当前 runtime 的会话（跨工作区按组展示）；新建会话钉死该 runtime（不弹机器/智能体选择浮层）。
- FR-03 抽屉左侧列表使用 /sessions 页同款工作区树 SessionListPanel，保留搜索（回车应用）、状态下拉、机器+智能体两层筛选 tab（锁定态）、分组手风琴、机器小节、紧凑两行条目、归档/取消归档、批量删除、展开记忆。
- FR-04 抽屉加宽至约 960px（左树 320px 固定列 + 右面板自适应），不使用 tailwind md: 视口断点布局（视口≠容器坑）。
- FR-05 ?session= URL 恢复保持可用：打开抽屉并选中该会话；会话 runtime 与锁定不一致时按全局态打开并清锁定。
