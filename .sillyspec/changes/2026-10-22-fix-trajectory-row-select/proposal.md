---
author: flow-machine-draft
created_at: 2026-10-22T01:21:47.535Z
---
# 提案书（Proposal）— 2026-10-22-fix-trajectory-row-select

## 动机

任务原话转写：会话页「进度→轨迹」面板点击账本行无反应：TrajectoryPane 接入 TrajectoryView 时漏传 selectedRowId/onSelectRow，选中态与右侧检查器失效（dev 预览页正常）。

成功标准：
- 「进度」→「轨迹」下点击任意账本行，该行进入选中态（aria-selected=true）且右侧检查器显示该行详情（输入/输出/元数据）
- 点击三泳道时间轴上的条目同样选中对应账本行（timeline 的 onSelectRow 已支持）
- 选中行可用 ↑/↓ 切换、Esc 清除
- 新增轨迹选中交互用例通过，既有 turn-timeline 轨迹用例零回归
- 相关目录 tsc --noEmit 退出 0

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 「进度」→「轨迹」下点击任意账本行，该行进入选中态（aria-selected=true）且右侧检查器显示该行详情（输入/输出/元数据）
2. 点击三泳道时间轴上的条目同样选中对应账本行（timeline 的 onSelectRow 已支持）
3. 选中行可用 ↑/↓ 切换、Esc 清除
4. 新增轨迹选中交互用例通过，既有 turn-timeline 轨迹用例零回归
5. 相关目录 tsc --noEmit 退出 0

## 成功标准（可验证）

1. 「进度」→「轨迹」下点击任意账本行，该行进入选中态（aria-selected=true）且右侧检查器显示该行详情（输入/输出/元数据）
2. 点击三泳道时间轴上的条目同样选中对应账本行（timeline 的 onSelectRow 已支持）
3. 选中行可用 ↑/↓ 切换、Esc 清除
4. 新增轨迹选中交互用例通过，既有 turn-timeline 轨迹用例零回归
5. 相关目录 tsc --noEmit 退出 0
