---
author: flow-machine-draft
created_at: 2026-10-13T07:29:31.456Z
---
# 提案书（Proposal）— 2026-10-13-session-changefiles-select-fix

## 动机

任务原话转写：会话页悬浮变更文件弹窗的变更切换下拉项选择不了（用户实测反馈）：radix Dialog modal 遮罩对 body 设 pointer-events:none，antd Select 下拉默认 portal 到 body 导致选项点不动且触发弹窗 outside-close；顺带修「轻量·轻量变更」标签重复（原型口径应为「干活中」）
成功标准：
- antd Select 下拉 DOM 挂进宫 DialogContent 内（getPopupContainer=closest role=dialog），真实浏览器中选项可点击切换变更
- 下拉选择后 ChangeFileTree 以新 changeId 重挂载（既有切换用例保持全绿并加挂载位置断言）
- 轻量变更（is_thin 且 current_stage=thin）的阶段标签显示「干活中」不再「轻量·轻量变更」重复
- 前端聚焦测试全绿 + tsc 0 错

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. antd Select 下拉 DOM 挂进宫 DialogContent 内（getPopupContainer=closest role=dialog），真实浏览器中选项可点击切换变更
2. 下拉选择后 ChangeFileTree 以新 changeId 重挂载（既有切换用例保持全绿并加挂载位置断言）
3. 轻量变更（is_thin 且 current_stage=thin）的阶段标签显示「干活中」不再「轻量·轻量变更」重复
4. 前端聚焦测试全绿 + tsc 0 错

## 成功标准（可验证）

1. antd Select 下拉 DOM 挂进宫 DialogContent 内（getPopupContainer=closest role=dialog），真实浏览器中选项可点击切换变更
2. 下拉选择后 ChangeFileTree 以新 changeId 重挂载（既有切换用例保持全绿并加挂载位置断言）
3. 轻量变更（is_thin 且 current_stage=thin）的阶段标签显示「干活中」不再「轻量·轻量变更」重复
4. 前端聚焦测试全绿 + tsc 0 错
