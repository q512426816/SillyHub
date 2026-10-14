---
author: flow-machine-draft
created_at: 2026-10-14T06:20:49.727Z
---
# 任务注册表（Tasks）— 2026-10-14-session-preview-defect-fixes

- [x] task-01: 额度失败轮（有 prompt 无 output）点击预览卡/导航后原位展开：用户消息气泡 + 失败详情卡（error_detail 注入），预览卡被替换无双块
- [x] task-02: 真零正文轮（无 prompt 无 output，群聊空 user_input）幂等语义不变：首次直达后重复点击仍不重复请求不重复 prepend
- [x] task-03: 已加载块 RoundDivider 轮号 = 大纲权威 seq（初始窗口/直达/预取/翻页四路径一致），与预览卡/导航轮号对齐
- [x] task-04: 盖章不击穿 TurnRow memo（同输入重复派生保持同引用）
- [x] task-05: 既有 preview 相关测试面复跑绿 + 新增失败轮展开/轮号盖章用例绿 + tsc 0
