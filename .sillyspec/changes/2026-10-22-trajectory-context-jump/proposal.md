---
author: flow-machine-draft
created_at: 2026-10-23T16:30:40.307Z
---
# 提案书（Proposal）— 2026-10-22-trajectory-context-jump

## 动机

任务原话转写：轨迹视图两处体验缺口（对照 dsh）：1) processItems 里的 system_event（agent 注入消息/后台通知等系统与上下文信息）没有派生进轨迹账本，类型数据缺失；2) 点击左侧轮次刻度在轨迹视图无反应（handleJumpToTurn 只查 data-turn-key 轮块，轨迹分支无轮块）；点击时间线泳道条块只选中不滚动，账本不会定位到对应行。

成功标准：
- processItems 的 system_event 在轨迹账本显示为「上下文」类型行（真实文案与时间锚点，缺锚点用轮首，不伪造）
- 轨迹视图下点击左侧轮次刻度，账本滚动定位到对应轮次首行并选中（复用 handleJumpToTurn 的轨迹分支）
- 点击时间线条块或键盘 ↑/↓ 移动选中时，账本自动把选中行滚入视野
- 轨迹相关测试零回归、新增用例全绿、frontend tsc --noEmit 退出 0

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. processItems 的 system_event 在轨迹账本显示为「上下文」类型行（真实文案与时间锚点，缺锚点用轮首，不伪造）
2. 轨迹视图下点击左侧轮次刻度，账本滚动定位到对应轮次首行并选中（复用 handleJumpToTurn 的轨迹分支）
3. 点击时间线条块或键盘 ↑/↓ 移动选中时，账本自动把选中行滚入视野
4. 轨迹相关测试零回归、新增用例全绿、frontend tsc --noEmit 退出 0

## 成功标准（可验证）

1. processItems 的 system_event 在轨迹账本显示为「上下文」类型行（真实文案与时间锚点，缺锚点用轮首，不伪造）
2. 轨迹视图下点击左侧轮次刻度，账本滚动定位到对应轮次首行并选中（复用 handleJumpToTurn 的轨迹分支）
3. 点击时间线条块或键盘 ↑/↓ 移动选中时，账本自动把选中行滚入视野
4. 轨迹相关测试零回归、新增用例全绿、frontend tsc --noEmit 退出 0
