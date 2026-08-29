---
author: qinyi
created_at: 2026-08-29 17:37:48
---

# 符号影响面报告（Symbol Impact）— daemon SELF_UPDATE 安全层增强

> 逐 task 签名级结论；无签名级变更也显式声明。

| task | 签名级变更 | 受影响调用点 | 范围内处置 |
|---|---|---|---|
| task-01 | 无既有签名变更；新增符号：session-manager `hasRunningTurn()`、task-runner `hasActiveLease()`（均零参薄查询） | 纯新增；消费方 task-04（同变更） | 新增测试两文件 |
| task-02 | 无签名变更；新增列 DaemonInstance.pending_update（JSON nullable）+ 迁移 | 新列无既有消费方；task-06 upsert 消费 | 迁移+列测试 |
| task-03 | 无既有签名变更；新增符号：`startDiskProbe(onDiskChange)`、`writePendingUpdate(...)`、`clearPendingUpdate()`、pending 读取口（daemon.ts 方法组）；config 新增 self_reload_check_interval_sec | 纯新增；消费方 task-04/05（同变更）；cli statusAction 输出追加（无签名变） | 卡内四文件 |
| task-04 | **TaskRunnerLike 接口增可选方法 `hasActiveLease?()`**（缺省视为不忙，照 cancel? 先例向后兼容）；daemon.ts SELF_UPDATE case 内部改 fire-and-forget（方法级无签名变）；**preflight 新增目标版本回传等价接口（不动 runDaemonSelfUpdate boolean 返回）** | TaskRunnerLike 实现仅 TaskRunner（已由 task-01 加方法）；preflight.test 既有布尔断言不破+补新用例 | 卡内四文件 |
| task-05 | **hub-client `heartbeat` 追加第 4 可选位置参数 pendingUpdate**（不破坏既有 3 参调用，TS 可选参数向后兼容）；daemon `_sendHeartbeatOnce` 内部组装 | heartbeat 调用点仅 daemon 心跳循环（同变更注入）；测试 fake 兼容（缺省 undefined） | 卡内三文件 |
| task-06 | 无签名变更；心跳请求内联 DTO 增可选字段 pending_update；响应组装（_build_machine_read/_runtime_read 注入）增字段 | 旧 daemon 不带字段（清除路径）+旧 backend 忽略多余字段——双向兼容；pydantic DTO 可选 | 卡内三文件 |
| task-07 | 无签名变更；DaemonMachineRead（手写接口）增可选字段 pending_update | 仅 machine-card 消费（同变更）；旧后端缺字段=undefined 走无横幅分支 | 卡内三文件 |
| task-08 | 无签名级变更；生成物+集成测试 | api-types 追加可选字段不破坏既有引用 | 三生成文件+新测试 |

**汇总**：签名级变更三处（task-04 TaskRunnerLike 可选方法、task-05 heartbeat 第 4 可选参数、task-06 DTO 可选字段）——全部追加式可选，零破坏性；受影响调用点均在同变更对应 task 内闭环。
