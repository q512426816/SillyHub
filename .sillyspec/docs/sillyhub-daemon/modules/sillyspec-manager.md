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
- `SillySpecManager(deps: SillySpecManagerDeps)`——全依赖注入可测：`runCommand`（默认 preflight runCmd）/ `install`（默认 preflight installSillySpec）/ **`isBusy`（必填）**（生产接 daemon._isBusyForUpdate 三臂忙判定）/ `now`（假钟）/ `logger` / 三个间隔常量（latestCacheTtlMs / deferredRecheckMs / terminalWindowMs）。
- 对外 API：`probeLocal()`（`sillyspec --version`，失败缓存置 null=未安装语义）；`probeLatest()`（`npm view sillyspec version`，成功结果缓存 TTL 10 分钟，失败不缓存下次即重试）；`getSnapshot()`（纯同步零 spawn，返回 `{version, latest_version, update?}` 浅拷贝——update 键仅在存在且未过 10min 终态展示窗时携带）；`requestUpgrade(trigger)`（WS 指令 server_command / 自动 auto 统一入口，全路径 catch 收敛不 reject）；`checkAndUpgrade(trigger?)`（1h 循环入口：probeLatest+probeLocal → 未安装或 isOutdated 才 requestUpgrade，已最新 no-op，latest 不可达仅 warn）。
- 类型导出：`SillySpecUpdateTrigger`（'server_command'|'auto'）、`SillySpecUpdateStatus`（'running'|'deferred'|'success'|'failed'，idle 以快照 update 键缺席表达）、`SillySpecUpdateState`（state/trigger/from_version/to_version?/error?——heartbeat sillyspec_update 键的载荷形状，hub-client 复用）、`SillySpecSnapshot`。
- 常量导出：`SILLYSPEC_LATEST_CACHE_TTL_MS`（10min）/ `SILLYSPEC_DEFERRED_RECHECK_MS`（30s）/ `SILLYSPEC_TERMINAL_WINDOW_MS`（10min）。
- 升级成败判定：installSillySpec 保持 preflight 原样 void 返回，故以**安装后 probeLocal** 为准——探到版本即 success（to_version=探测值），探不到即 failed（error 截断 200 字符）。

## 关键逻辑
```text
状态机（内存态，daemon 重启即回 idle——重启后 preflight 启动检查已保证最新）:
  idle ──requestUpgrade(空闲)──▶ running ──成功──▶ success ─┐
    │ 机器忙(isBusy)                └─失败──▶ failed ──────┼─10min 展示窗─▶ idle
    ▼                                                  （惰性判定，非定时器）
  deferred ──每 30s 复查：转空闲 ▶ running；仍忙 ▶ 再推迟（定时器单实例不叠，unref）

in-flight 门: running/deferred 期间新 requestUpgrade 仅记日志去重（CLEANUP 惯例）；
  终态(success/failed)展示窗内新请求可再次进入升级
终态 10min 过期为惰性判定: getSnapshot 每次调用(生产=每拍心跳)时判 now-终态时刻
  ≥ 窗口即回 idle——无人取快照时终态留内存无外部可见副作用
_runUpgrade: 置 running(同步先于任何 await，in-flight 门依赖) → installSillySpec
  → probeLocal 刷新 → 终态(记录展示窗起点)
```

## 注意事项
- 已知边界：安装失败（npm 不可达等）但旧版本仍在位时，探测返回旧版本 → 上报 from==to 的 success；版本徽标仍以真实探测值为准、下轮自动检查自愈。
- deferred 复查定时器迟到回调守卫：到点时状态已离开 deferred（新升级已开/终态）不动作。
- latest 失败不缓存、不做离线重试/退避——调用频率为小时级循环/手动触发，失败留给下轮自动检查或手动重试。
- daemon 接线三处见 daemon 卡：_sillyspecLoop 第四循环（auto 触发）、心跳/注册快照透传、WS SILLYSPEC_UPDATE（server_command 触发）；测试注入假 manager 避免真实 spawn。
