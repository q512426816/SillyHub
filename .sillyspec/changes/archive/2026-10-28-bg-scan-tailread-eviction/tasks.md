---
author: flow-machine-draft
created_at: 2026-10-27T23:44:45.002Z
---
# 任务注册表（Tasks）— 2026-10-28-bg-scan-tailread-eviction

- [x] task-01: 新增 sillyhub-daemon/src/bg-task-scan.ts + tests/bg-task-scan.test.ts——readFileTailBytes（open+按偏移 read、小于窗口整读、失败抛错）与 evictUnseenSnapshotPaths（可见集核对、返回淘汰数）两纯函数六用例，先落测试跑绿（函数自包含，不依赖 daemon.ts 改动）
- [x] task-02: daemon.ts _bgTaskFinalLoop 接线——读侧换 readFileTailBytes（保留 try/catch continue）、清理侧删 size>200 空操作块换 seenPaths 集合 + evictUnseenSnapshotPaths（debug 记淘汰数）；daemon 侧触及面既有测试回归（knowledge-hits-flush 等）
- [x] task-03: 构建面核验——tsc --noEmit 零错 + daemon 全量 vitest 跑绿（新文件与既有面）
