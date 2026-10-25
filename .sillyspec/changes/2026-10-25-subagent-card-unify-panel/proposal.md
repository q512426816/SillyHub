---
author: flow-machine-draft
created_at: 2026-10-25T02:38:35.812Z
---
# 提案书（Proposal）— 2026-10-25-subagent-card-unify-panel

## 动机

任务原话转写：子代理卡片统一为紧凑卡片+详情栏

动机：用户裁决——子代理卡片去掉弹窗内的原地展开形态，统一为紧凑卡片+右侧详情栏（与整页会话一致）。

成功标准：
- SubagentBlockView 删除内联展开分支：无面板上下文时渲染同款头部纯展示（不可点击），不再原地展开 children
- 会话弹窗（dialog 模式）挂 SubagentPanelContext：点击紧凑卡片右侧滑出 Drawer，内嵌 SubagentDetailPanel 展示子代理完整内部过程
- 整页会话行为零变化（右栏详情照旧）
- 内联展开相关测试改写为纯展示断言；弹窗新增点击开 Drawer 用例；全部通过
- lint与typecheck通过

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. SubagentBlockView 删除内联展开分支：无面板上下文时渲染同款头部纯展示（不可点击），不再原地展开 children
2. 会话弹窗（dialog 模式）挂 SubagentPanelContext：点击紧凑卡片右侧滑出 Drawer，内嵌 SubagentDetailPanel 展示子代理完整内部过程
3. 整页会话行为零变化（右栏详情照旧）
4. 内联展开相关测试改写为纯展示断言；弹窗新增点击开 Drawer 用例；全部通过
5. lint与typecheck通过

## 成功标准（可验证）

1. SubagentBlockView 删除内联展开分支：无面板上下文时渲染同款头部纯展示（不可点击），不再原地展开 children
2. 会话弹窗（dialog 模式）挂 SubagentPanelContext：点击紧凑卡片右侧滑出 Drawer，内嵌 SubagentDetailPanel 展示子代理完整内部过程
3. 整页会话行为零变化（右栏详情照旧）
4. 内联展开相关测试改写为纯展示断言；弹窗新增点击开 Drawer 用例；全部通过
5. lint与typecheck通过
