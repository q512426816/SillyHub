---
schema_version: 1
doc_type: module-card
module_id: sillyspec-manager
author: qinyi
created_at: 2026-08-31 16:30:00
---

# sillyspec 运行期版本管理与升级状态机（sillyspec-manager）

## 定位
运行期 sillyspec 版本探测与升级状态机（`src/sillyspec-manager.ts`，2026-08-31-machine-sillyspec-version）。把 preflight 的启动期一次性 sillyspec 检查延伸到运行期：本机/最新版本探测（latest 10min 缓存）+ npm 安装升级 + 内存升级状态机，为 daemon 的心跳上报 / WS SILLYSPEC_UPDATE 触发 / 1h 自动循环接线提供独立可测核心。探测/安装 spawn 一律复用 preflight 基建（runCmd / installSillySpec，底层 runWithTreeKill 超时杀树），版本比较复用 isOutdated——本模块零自写进程与比较逻辑；不 import daemon.ts（isBusy 回调由 daemon 注入 `_isBusyForUpdate`，依赖单向）。

## 契约摘要
- `SillySpecManager(deps: SillySpecManagerDeps)`——全依赖注入可测：`runCommand`（默认 preflight runCmd）/ `install`（默认 preflight installSilly；ql-20260907-001 加 `opts.officialRegistry`——true 时 install 同带官方源 --registry，镜像滞后时仍走默认源会装回旧版）/ **`isBusy`（必填）**（生产接 daemon._isBusyForUpdate 三臂忙判定）/ `now`（假钟）/ `logger` / 三个间隔常量（latestCacheTtlMs / deferredRecheckMs / terminalWindowMs）。
- 对外 API：`probeLocal()`（`sillyspec --version`，失败缓存置 null=未安装语义）；`probeLatest(force?)`（`npm view sillyspec version --prefer-online`，成功结果缓存 TTL 10 分钟，失败不缓存下次即重试；ql-20260907-001：force=true 绕过缓存读强制现探——手动升级触发用）；`probeLatestOfficial()`（ql-20260907-001 仲裁信源：`--registry=SILLYSPEC_OFFICIAL_REGISTRY --prefer-online` 直查官方源，失败 null 静默回退、结果不缓存）；`getSnapshot()`（纯同步零 spawn，返回 `{version, latest_version, update?}` 浅拷贝——update 键仅在存在且未过 10min 终态展示窗时携带）；`requestUpgrade(trigger, useOfficialRegistry?)`（WS 指令 server_command / 自动 auto 统一入口，全路径 catch 收敛不 reject；官方源安装 flag 随 deferred 保留、复查时消费）；`requestManualUpgrade()`（WS SILLYSPEC_UPDATE 手动指令入口——先版本门再 requestUpgrade：ql-20260907-001 门信源升级为官方源仲裁（`_resolveLatestForGate(true)` 强制现探 + 本地源/官方源取较新者），官方较新时升级切官方源安装；已安装且 !isOutdated(effective) → 写 up_to_date 终态不白跑 npm（ql-20260904-019：横幅明示「已是最新版」；running/deferred in-flight 期不覆盖只记 debug）；探测失败/未安装放行。刻意独立于 requestUpgrade——后者依赖「running 同步置位先于首个 await」契约，异步探测须外置）；`checkAndUpgrade(trigger?)`（1h 循环入口：仲裁版本门（本地源走 10min 缓存）+ probeLocal → 未安装或 isOutdated(effective) 才 requestUpgrade，已最新 no-op，两路 latest 不可达仅 warn——仲裁让镜像滞后机器在自动检查中自愈）。
- 类型导出：`SillySpecUpdateTrigger`（'server_command'|'auto'）、`SillySpecUpdateStatus`（'running'|'deferred'|'success'|'failed'|'up_to_date'，idle 以快照 update 键缺席表达）、`SillySpecUpdateState`（state/trigger/from_version/to_version?/error?——heartbeat sillyspec_update 键的载荷形状，hub-client 复用）、`SillySpecSnapshot`。
- 常量导出：`SILLYSPEC_LATEST_CACHE_TTL_MS`（10min）/ `SILLYSPEC_DEFERRED_RECHECK_MS`（30s）/ `SILLYSPEC_TERMINAL_WINDOW_MS`（10min）/ `SILLYSPEC_OFFICIAL_REGISTRY`（`https://registry.npmjs.org`，ql-20260907-001 仲裁直查地址）。
- 升级成败判定：installSillySpec 保持 preflight 原样 void 返回，故以**安装后 probeLocal** 为准——探到版本即 success（to_version=探测值），探不到即 failed。

## 关键逻辑
```text
版本门 latest 仲裁（ql-20260907-001，requestManualUpgrade/checkAndUpgrade 共用）:
  本地源 probeLatest(force) ──┐ 取较新者 = effective
  官方源 probeLatestOfficial ─┘ （isOutdated 比较；官方不可达→本地源值）
  officialNewer = 官方 > 本地源（或本地源不可达）→ install 切官方源 --registry
  官方较新时: 心跳缓存覆盖为官方值（徽标显示真实最新）+ sillyspec_latest_arbitrated
  设计取舍: 官方安装失败不自动回退镜像安装——装回旧版报 success 比诚实 failed 更糟

状态机（内存态，daemon 重启即回 idle——重启后 preflight 启动检查已保证最新）:
  idle ──requestUpgrade(空闲)──▶ running ──成功──▶ success ─┐
    │ 机器忙(isBusy)                └─失败──▶ failed ───────┼─10min 展示窗─▶ idle
    ▼                                                  （惰性判定，非定时器）
  deferred ──每 30s 复查：转空闲 ▶ running（原 trigger + 官方源 flag 保留）；
              仍忙 ▶ 再推迟（定时器单实例不叠，unref）

in-flight 门: running/deferred 期间新 requestUpgrade 仅记日志去重（CLEANUP 惯例）；
  终态(success/failed/up_to_date)展示窗内新请求可再次进入升级
requestManualUpgrade 已最新(!isOutdated(effective)) ─▶ up_to_date（终态，同 10min 展示窗；
  ql-20260904-019——原静默 no-op 改为横幅明示「已是最新版」）
终态 10min 过期为惰性判定: getSnapshot 每次调用(生产=每拍心跳)时判 now-终态时刻
  ≥ 窗口即回 idle——无人取快照时终态留内存无外部可见副作用
_runUpgrade: 置 running(同步先于任何 await，in-flight 门依赖) → installSillySpec
  → probeLocal 刷新 → 终态(记录展示窗起点)
```

## 注意事项
- 已知边界：安装失败（npm 不可达等）但旧版本仍在位时，探测返回旧版本 → 上报 from==to 的 success；版本徽标仍以真实探测值为准、下轮自动检查自愈。
- 官方源直查每次仲裁现执行不缓存（内网不可达机器每小时空探一次，runCmd 30s 超时封顶，成本被小时级频率接受）；失败仅 debug 留痕不刷屏。
- deferred 复查定时器迟到回调守卫：到点时状态已离开 deferred（新升级已开/终态）不动作。
- latest 失败不缓存、不做离线重试/退避——调用频率为小时级循环/手动触发，失败留给下轮自动检查或手动重试。
- daemon 接线三处见 daemon 卡：_sillyspecLoop 第四循环（auto 触发）、心跳/注册快照透传、WS SILLYSPEC_UPDATE（server_command 触发）；测试注入假 manager 避免真实 spawn。
- `runProgressJsonDefault`（默认 execFile 执行器，progress 采集 / runResolve /
  ghostCleanup 共用）env 显式传「`SILLYSPEC_SYNC_TIMEOUT_MS=20000` 缺省垫底 +
  process.env 覆盖」（ql-20260907-007，常量单一源在 spawn-env.ts）：daemon 自身
  跑的 sillyspec 命令（ghostCleanup 含平台同步收敛）同样获得熔断预算放宽，
  process.env 预设时原值优先。该函数已导出供测试真实 spawn 直测（`node -e`
  打印环境变量断言），属 harness 零 spawn 策略的例外块。
