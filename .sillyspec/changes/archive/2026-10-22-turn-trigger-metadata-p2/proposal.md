---
author: flow-machine-draft
created_at: 2026-10-22T04:34:10.397Z
---
# 提案书（Proposal）— 2026-10-22-turn-trigger-metadata-p2

## 动机

任务原话转写：轮触发溯源 Phase 2：定时消息接入与 metadata 戳驱动
动机与背景：Phase 1（2026-10-22-turn-trigger-generalize）落地 turn_trigger 段后，溯源检测靠内容前缀（伪造误标面）且定时消息无标记。本变更打通服务端溯源：①scheduled_send 派发沿 task_wakeup 既有管道携带 origin='schedule'（排队行 origin→派发回放 turn_metadata→user_input 日志 metadata_ 列），前端新增「⏰ 定时消息到点」触发行（正文可见）；②inject 链把 task_wakeup/auto_resume 溯源升级为 user_input 日志 metadata_.turn_trigger 戳（task_wakeup 经 router task_wakeup=True、auto_resume 经队列 origin 前缀/auto_resume_of 参数推导，派发回放与直注入双路径统一盖戳）；③前端 classifyTurnTrigger 改 metadata 优先、内容前缀降为兜底，消除伪造误标面。群聊 turn_metadata 合并语义保留（chain_metadata 不丢）。

成功标准：
- 定时消息派发轮（空闲直注/忙轮排队回放两路径）user_input 行 metadata_.turn_trigger='schedule'，前端时间线轮头出现「⏰ 定时消息到点」标注行、消息正文照常显示
- task_wakeup/auto_resume 派发轮 user_input 行 metadata_.turn_trigger 正确盖戳（直注入+队列回放双路径），前端分类改 metadata 优先
- 群聊 chain_metadata 与 turn_trigger 戳合并不互吞；metadata 缺失的存量行回退内容前缀检测（零回归）
- 后端相关面 pytest 绿 + ruff/mypy 零错；前端受影响套件绿 + tsc 零错

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 定时消息派发轮（空闲直注/忙轮排队回放两路径）user_input 行 metadata_.turn_trigger='schedule'，前端时间线轮头出现「⏰ 定时消息到点」标注行、消息正文照常显示
2. task_wakeup/auto_resume 派发轮 user_input 行 metadata_.turn_trigger 正确盖戳（直注入+队列回放双路径），前端分类改 metadata 优先
3. 群聊 chain_metadata 与 turn_trigger 戳合并不互吞；metadata 缺失的存量行回退内容前缀检测（零回归）
4. 后端相关面 pytest 绿 + ruff/mypy 零错；前端受影响套件绿 + tsc 零错

## 成功标准（可验证）

1. 定时消息派发轮（空闲直注/忙轮排队回放两路径）user_input 行 metadata_.turn_trigger='schedule'，前端时间线轮头出现「⏰ 定时消息到点」标注行、消息正文照常显示
2. task_wakeup/auto_resume 派发轮 user_input 行 metadata_.turn_trigger 正确盖戳（直注入+队列回放双路径），前端分类改 metadata 优先
3. 群聊 chain_metadata 与 turn_trigger 戳合并不互吞；metadata 缺失的存量行回退内容前缀检测（零回归）
4. 后端相关面 pytest 绿 + ruff/mypy 零错；前端受影响套件绿 + tsc 零错
