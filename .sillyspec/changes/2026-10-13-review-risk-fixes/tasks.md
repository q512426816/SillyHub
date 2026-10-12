---
author: flow-machine-draft
created_at: 2026-10-12T23:08:59.047Z
---
# 任务注册表（Tasks）— 2026-10-13-review-risk-fixes

- [x] task-01: task-runner 渲染轨生产路径（spawn-stream handleLine）传入 MessageCoalescer：流式 delta 缓冲合并为单行提交，attempt 收尾 flushAll 残留缓冲冲刷转发（宁碎片不丢内容），新增测试证明接线后多条 delta 仅产出一行合并内容+完结行、流结束残留被冲刷
- [ ] task-02: backend 启动清理的 AskUserQuestion 等待豁免加 24h 时间上限：最后 ask 信号超龄后不再豁免、按既有判死路径收口，测试覆盖时限内豁免与超时限判死两分支
- [ ] task-03: path-utils.ts isPathUnderAnyRoot 注释与实现对齐（anchor 仅 target 透传，roots 维持单参解析）
- [ ] task-04: shell-paths.ts isFlagToken 注释补记已知残留放行面（- 开头文件名不进白名单校验）与 cd 盲区既有边界
- [ ] task-05: sillyhub-daemon 定向 vitest（event-wire/task-runner/coalescer）+ pnpm typecheck 通过；backend 定向 pytest（stale runs 两文件）通过；不跑全量
