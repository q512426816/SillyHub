
## ql-20260921-009-b4f4 | 2026-09-21 15:59:24 | 升级 sillyspec 横幅回显提速——daemon 终态后补发心跳 + 前端短窗加速轮询
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/daemon.ts（SILLYSPEC_UPDATE case 补发心跳（.finally + 防御 catch））
- sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts（+2 用例（落定即补发 / 意外 reject 也补发））
- frontend/src/lib/use-daemon-machines.ts（opts.refetchInterval 覆盖口）
- frontend/src/app/(dashboard)/runtimes/page.tsx（加速窗状态 + 下发点开窗 + 到期回退 effect）
- frontend/src/app/(dashboard)/runtimes/__tests__/page.test.tsx（+1 fake timers 加速窗用例）
需求：升级 sillyspec 横幅回显提速——daemon 终态后补发心跳 + 前端短窗加速轮询
根因：用户实测点击升级后横幅不自动出现、刷新页面才加载：daemon 版本门两次 npm 探测 ~12s + 15s 心跳节拍 + 前端 15s 轮询三段叠加，横幅最差 ~30s 后才到，用户在到达前刷新误判「只在刷新后出现」；ql-20260911-024 已为 resolve/ghost_cleanup 修过同型回显延迟但漏了升级指令
方案：镜像两级方案：daemon.ts SILLYSPEC_UPDATE case 的 requestManualUpgrade 链 .finally 补发一次 _sendHeartbeatOnce（前置防御 .catch 防意外 reject 崩进程）；前端 useDaemonMachines 增 opts.refetchInterval 覆盖口，runtimes 页下发成功后开 60s 加速窗切 5s 轮询，到期 setTimeout 清 0 回退 15s
结果：daemon-heartbeat-sillyspec 34 passed（+2 补发心跳用例）、runtimes 页面 3 测试文件 34 passed（+1 fake timers 加速窗用例）、前后端 tsc 0 错
审计：[gate] L1（跨 0 模块 · 8 文件：3 代码/2 测试）advisory；每文件注记缺失（--file-notes 覆盖变更文件全集）；测试增量已含
