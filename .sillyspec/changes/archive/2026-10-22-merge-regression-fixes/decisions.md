---
author: flow-machine-draft
created_at: 2026-10-22T08:51:59.349Z
---
# 决策记录（Decisions）— 2026-10-22-merge-regression-fixes

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：扩容 metadata 闭包引入 users↔agent_profiles、workspaces↔agent_profiles 环——姊妹 conftest 已实证同形态可建表（SQLite 内存库 + to_metadata + create_all），本变更照抄该范式并在隔离复跑中验证 62 passed。放弃方案：给 agent_profiles 建仅含 id 列的 stub 表——放弃理由：stub 与真实表结构漂移会掩盖后续 FK 问题，纳入真实表闭包与姊妹模块一致、可维护。
