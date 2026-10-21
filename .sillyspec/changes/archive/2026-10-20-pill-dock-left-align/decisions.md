---
author: flow-machine-draft
created_at: 2026-10-20T00:55:04.031Z
---
# 决策记录（Decisions）— 2026-10-20-pill-dock-left-align

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险:存档恢复首帧对齐闪动(恢复帧 items-end、下一帧切 items-start)。已消除——恢复路径改走 `snapPos`,首帧即携带正确 left。 试过但放弃的方案:① render 期读 `dockRef.getBoundingClientRect()` + bounds 现算对齐——render 读 DOM 不纯(ref 首帧为 null),且每次 render 强制布局;② 持久化存档带 left 字段——存档格式变化,既有 toEqual 断言与旧档兼容都要跟着动,left 可从坐标幂等重推导,入档属冗余状态。两案均弃,采用吸附判据单源派生。
