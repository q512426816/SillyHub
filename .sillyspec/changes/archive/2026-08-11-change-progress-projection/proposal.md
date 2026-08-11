---
author: qinyi
created_at: 2026-08-11 15:43:48
---
# 提案书（Proposal）

## 动机

进度同步链路三段中第三段「收件箱 → 变更中心展示」缺失：工具上行的权威 current_stage 躺在 `platform_change_progress` 表里没人用，变更中心继续读 `changes` 表里 reparse 扫文件猜的值（`parser.py:574`），「状态/阶段」与实际严重不符（识别不出 quick/blocked/审核等待/rerun）。同时收件箱无 workspace 隔离（`change_name` 全局 PK），多 workspace 同名 change 会串值。

## 关键问题

1. **展示与实际不符**：`parser._infer_current_stage` 只看文件存在性，是 fallback 非权威；reparse 重新扫描还会反复覆盖 agent 写的真实值。
2. **权威值闲置**：`platform_change_progress` 已存工具上行的权威 current_stage，但 change 模块零引用该表、前端零调用同步端点，断点无人接。
3. **workspace 隔离缺失**：收件箱全局 PK 无 workspace_id；平台无法从上行请求确定 workspace（ApiKey 只绑 user，User 可属多 workspace），投影无法按 workspace 区分。

## 变更范围

workspace-scoped token 派生隔离 + connect 自动下发 + change 模块实时 join 投影 current_stage。跨两仓（主仓 platform_sync/change + sillyspec 工具 sync.js connect + 契约补章）。

## 不在范围内（显式清单）

- 不改 `serializeForSync()` body / 契约 §3（workspace 走 token 派生）
- 不做 status 投影（D-004@v2，仅投 current_stage）
- 不做 push 时回写 changes 表缓存（实时 join）
- 不顺带修 mcp 段同源假设坑（NG-4，留单独 change）
- 不实现 `/api/changes/{name}/{documents,approval}` 无前缀端点
- 不做 token 管理 UI / 字段级 auto-merge / sillyhub-mcp 派发层

## 成功标准（可验证）

- 变更中心 current_stage 显示工具上行权威值，与实际 sillyspec.db 一致
- workspace A 的 change 不串 workspace B 同名 change 的进度（复合唯一隔离）
- 工具未上行的 change 行为不变（fallback 现有值）
- connect 自动下发 workspace-scoped token 到 local.yaml（保留注释）
- resolve-by-root-path 无 WORKSPACE_WRITE 权限返回 403，root_path 反查不到 404
