---
author: qinyi
created_at: 2026-07-06 19:09:09
---
# Proposal

## 动机
2026-07-06 修 5 个 daemon-client bug（ql-006/008/009/010 + complete_lease 500）后，架构 review 发现 8 处 backend 容器内做宿主操作的 bug 同源（5 已修 dispatch 侧 / 3 未修 complete_lease 侧）。根因：path_source 信号没贯穿到 complete_lease 收尾链路 + 缺"宿主操作委托"统一抽象。

## 关键问题（现有方案为什么不够）
1. **complete_lease 500**：apply_patch 在 backend 容器内 `git apply` 宿主 worktree，`FileNotFoundError`——用户 dispatch 失败看不到原因（ql-009 failure log 兜底也被 500 回滚冲掉）。
2. **收尾链路漏 path_source 分流**：complete_lease 3 处回调（apply_patch/post_scan/stage_callback）裸做宿主操作，没读 path_source。
3. **缺统一抽象**：8 处靠作者自觉判断 跳过/用容器路径/委托 daemon，漏判即 bug（已踩 8 次，point-fix 堆叠）。

## 变更范围
- backend 容器**零宿主路径访问**（完全委托，8 处全改 daemon WS RPC）。
- HostFsDelegate 抽象（path_source 分流：daemon-client WS RPC / server-local 本地）。
- complete_lease 入口 path_source 贯穿 3 回调。
- 删死代码 _run_sillyspec_background。

## 不在范围内
- 不改 daemon-client 架构本身（claude 宿主跑 + backend 容器调度模式保留）。
- 不改 server-local 模式行为。
- 不重构 daemon WS 基础设施（复用 daemon-entity-binding per-daemon WS）。
- 不修 ql-008/009/010（daemon 代码逻辑 bug，已修）。

## 成功标准（可验证）
- complete_lease daemon-client 不再 500（apply_patch 走 daemon RPC）。
- 8 处容器越界统一 HostFsDelegate（grep 无残留 `path_source != 'daemon-client'` 散落 if）。
- daemon-client dispatch 失败原因（529 等）前端可见（RPC + failure log 双路径）。
- 现有 dispatch/scan/import/runtime/preflight/complete_lease 测试零回归。
