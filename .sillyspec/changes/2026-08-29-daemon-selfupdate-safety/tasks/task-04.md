---
id: task-04
title: 'daemon tryUpdate 编排器（所有权/推迟 30s/终检/disk_change 直启/TaskRunnerLike 可选化/SELF_UPDATE case 改造/preflight 目标版本回传）（depends_on: task-01, task-03）'
title_zh: 'daemon tryUpdate 编排器（所有权/推迟 30s/终检/disk_change 直启/TaskRunnerLike 可选化/SELF_UPDATE case 改造/preflight 目标版本回传）（depends_on: task-01, task-03）'
author: 'qinyi'
created_at: 2026-08-29 15:04:03
priority: P0
depends_on: [task-01, task-03]
blocks: [task-05, task-08]
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001@v1, D-002@v1, D-003@v2, D-005@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/preflight.ts
  - sillyhub-daemon/tests/preflight.test.ts
  - sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts
expects_from:
  task-01:
    - contract: BusyCheckApi
      needs: [hasRunningTurn, hasActiveLease]
  task-03:
    - contract: DiskProbeAndPending
      needs: [onDiskChange, writePendingUpdate, clearPendingUpdate, startDiskProbe]
goal: >
  daemon.ts 落地 _tryUpdate(reason) 单入口编排器——所有权占位、忙则推迟（pending+30s 复查）、空闲按 reason 分流（server_command 走现有升级链+stop 前终检、disk_change 不下载直启）、一切非交接路径释放可再触发，接线 SELF_UPDATE case 与磁盘探测回调，preflight 补目标版本回传等价接口。
implementation:
  - daemon.ts 新增 _tryUpdate(reason) 单入口——先占所有权 _updateBusy（已占则本次忽略仅记日志）；忙判定 _isBusyForUpdate() 消费 task-01 hasRunningTurn/hasActiveLease，TaskRunnerLike（:639）加可选 hasActiveLease?（缺省视为不忙，照 cancel?（:654）可选方法先例不砸碎测试 mock）；忙则释放所有权+writePendingUpdate（task-03）+排 30s _updateRetryTimer（unref；已 pending 仅刷新目标版本不叠定时器；离开推迟态必清防 noop 后死循环）
  - 空闲按 reason 分流——server_command 走现有链 runDaemonSelfUpdate（preflight.ts :184 加目标版本回传等价接口——可选 out 参数或伴生函数，不动既有 boolean 返回；preflight.test.ts 既有布尔断言不破+补新用例）→ stop 前终检（重跑 _isBusyForUpdate，忙回推迟；终检与 stop 首动作间无 await）→ stop()（含挂起）→ respawnDaemonAndExit 交接（所有权持有到进程退出）
  - disk_change 不下载不查 manifest 直接 stop() → respawn 到盘上版本（操作者换文件即意图，防降级被 noop 挡死永不收敛）；一切非交接排定路径（noop/下载失败/异常/终检回推迟）释放所有权+clearPendingUpdate 可再触发；respawn 失败注释停摆语义（spawn 在 stop 后进程已停，保活=不退出待人工介入，backend 45s 判 offline，释放仅语义自洽）
  - MSG.SELF_UPDATE case（daemon.ts :3997）改为 void this._tryUpdate('server_command')（fire-and-forget）；启动接线 task-03 探测 onDiskChange=() => void this._tryUpdate('disk_change')；新建 tests/daemon-selfupdate-orchestrator.test.ts 注入 mock 覆盖推迟/终检/直启/释放全路径
acceptance:
  - 忙（在跑轮次或活跃 lease）→ 释放所有权+写 pending+排 30s 定时器，30s 后重探空闲即升级（无限等 D-002）；已 pending 仅刷新目标不叠，离开推迟态（升级执行/noop/异常）必清定时器无死循环
  - 所有权已占时新触发忽略仅记日志；所有权仅交接排定后持有到进程退出，noop/下载失败/异常路径释放后新指令可再触发
  - 下载完成 stop 前终检发现新忙→回推迟不打断在跑任务（终检与 stop 首动作间无 await）；disk_change 直启——不调 runDaemonSelfUpdate 不查 manifest，直接 stop+respawn 到盘上版本
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/daemon-selfupdate-orchestrator.test.ts tests/preflight.test.ts && pnpm exec tsc --noEmit
constraints:
  - 不破坏 preflight.ts runDaemonSelfUpdate 既有 boolean 返回与 preflight.test.ts 既有断言——目标版本回传走可选 out 参数或伴生函数等价接口并补新用例；不改下载替换原子性（tmp+rename 保留）不做 drain-hook 状态机（推迟=每轮从零重探，D-002）
  - respawn 失败停摆保活语义不得混入「可再触发」叙述——停摆=进程已停 WS 已关、保活待人工/看护介入、backend 45s 判 offline 可见（释放所有权仅为语义自洽）；心跳携带 pending_update 归 task-05，本 task 不动 hub-client.ts
---
