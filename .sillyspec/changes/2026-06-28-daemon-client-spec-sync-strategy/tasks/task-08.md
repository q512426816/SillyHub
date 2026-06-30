---
author: qinyi
created_at: 2026-06-30T10:20:00
task_id: task-08
status: implemented
---
# task-08: pullSpecBundle 三分支（签名扩展）

## 状态：已实现（回填蓝图，代码已 apply）
**实现位置**：`sillyhub-daemon/src/spec-sync.ts:89-103`（repo-native 分支：建 junction + 跳过 getSpecBundle 覆盖 + 不走 rm）；`:107-124`（repo-mirrored 分支：缓存空时 fs.cp 从 rootPath/.sillyspec）；platform-managed 现状分支。签名 `pullSpecBundle(client, wsId, {strategy, rootPath, existingSpecRoot})`

## 目标
pullSpecBundle 加 strategy+rootPath 参数，按三分支（platform-managed 现状 / repo-mirrored 首次 fs.cp / repo-native 建 junction 跳过覆盖）。

## 验收标准（已通过）
- [x] platform-managed 现状回归
- [x] repo-mirrored 缓存空时 fs.cp
- [x] repo-native 建 junction 跳过 getSpecBundle 覆盖
- [x] batch 调用点 task-runner.ts:351 不传 strategy 保持现状

## 覆盖
FR-05, FR-06, FR-07, D-002@v1, D-004@v1, D-005@v1。参考 design §5.2 Phase2。
