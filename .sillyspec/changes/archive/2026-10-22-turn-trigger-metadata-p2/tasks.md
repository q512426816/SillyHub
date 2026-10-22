---
author: flow-machine-draft
created_at: 2026-10-22T04:34:10.397Z
---
# 任务注册表（Tasks）— 2026-10-22-turn-trigger-metadata-p2

- [x] task-01: 定时消息派发轮（空闲直注/忙轮排队回放两路径）user_input 行 metadata_.turn_trigger='schedule'，前端时间线轮头出现「⏰ 定时消息到点」标注行、消息正文照常显示
- [x] task-02: task_wakeup/auto_resume 派发轮 user_input 行 metadata_.turn_trigger 正确盖戳（直注入+队列回放双路径），前端分类改 metadata 优先
- [x] task-03: 群聊 chain_metadata 与 turn_trigger 戳合并不互吞；metadata 缺失的存量行回退内容前缀检测（零回归）
- [x] task-04: 后端相关面 pytest 绿 + ruff/mypy 零错；前端受影响套件绿 + tsc 零错
