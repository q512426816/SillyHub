---
author: flow-machine-draft
created_at: 2026-09-27T14:08:32.245Z
---
# 任务注册表（Tasks）— 2026-09-27-session-fast-replay

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。

- [x] task-00: 双子代理调研（deepseek-harness 加速机制 + 本仓瓶颈定位）与方案选型（用户拍板方案 A+形态 1）——调研结论入 design 槽 1
- [x] task-01: 后端 turn-outline 端点（runs 轻列+窗口函数摘要+LRU 指纹缓存+归属闸门）+ 后端测试（摘要正确性/缓存命中/权限/空会话/>500 轮不截断）(FR-01)
- [x] task-02: 后端 /logs 增 run_id 单轮直达 + slim 截断（content_truncated DTO 字段）+ 单条全文端点 + /runs 剥 system_prompt + gzip + 后端测试 + pnpm gen:types 提交 (FR-02, FR-03)
- [x] task-03: 前端 lib 接线（getTurnOutline/getAgentSessionLogFull/logs 参数扩展）+ 打开并行大纲/尾页(slim) + 未加载轮 run_id 直达跳转（interval 循环退役为回退）+ autoFill 收敛 + slim 工具展开按需全文 + 相关测试 (FR-04, FR-05, FR-07)
- [x] task-04: TurnNavList 行式导航列重做（desktop 常驻 ~220px 可拖宽、整行命中 ≥40px、当前轮高亮滚动联动、未加载轮大纲摘要、长列表分组/虚拟防卡、aria 保留）+ mobile Drawer 同源 + 相关测试 (FR-06)
- [x] task-05: 行为零回归审查（SSE/steering/深链/草稿/触顶锚定/旧会话首开）+ 性能对照记录（请求数与 payload 前后量化）(FR-08)
- [x] task-06: 全量验证（后端相关测试+前端会话域测试改断言不改意图+tsc/eslint 零新增）+ 功能对照 + 收口
