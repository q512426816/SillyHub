---
author: qinyi
created_at: 2026-08-28 08:28:18
---

# preflight 变更索引

> 自动生成。正文历史已迁出，详见 preflight.md。

- ql-20260828-004-5798 | 自更新后自拉起（原"等外部 supervisor 重启"假设从未落地，更新完进程死掉）：runDaemonSelfUpdate 改返回 boolean（true=主 bundle 已替换需重启），退出逻辑移出；新增 respawnDaemonAndExit（detached spawn node 新 bundle + process.argv 原启动参数 + unref，成功后 500ms exit(0)，拉起失败记 error 不退出保活旧进程）；runPreflight 启动期路径据 true 直接自拉起；mcp-server.js best-effort 伴生替换（主 bundle URL 同目录推导，失败仅 warn）。

## 2026-08-30 — 剩余中置信缺陷修复批（quick ql-20260830-002-f0d2）
- R3 downloadAndReplace 失败路径清理 .tmp 残留（catch 内 best-effort unlink；导出供单测）。

## 2026-08-31 — 机器 sillyspec 版本显示与远程升级（2026-08-31-machine-sillyspec-version）
- runCmd / installSillySpec / isOutdated 加 export 供运行期 sillyspec-manager 复用（探测 spawn / npm 升级 / 版本比较基建唯一实现处；仅可见性变化，行为零变化——本变更铁律）。

- ql-20260907-001-5bff | sillyspec 探测/安装配合运行期版本门官方源仲裁（主改动在 sillyspec-manager，见其 changelog）：runSillySpecCheck 的 `npm view sillyspec version` 加 --prefer-online（跳本地 HTTP 缓存新鲜度检查，防启动期检查同样被镜像/缓存滞后误判）；installSillySpec 加可选 `{ registry?: string }` 参数（仲裁判定镜像滞后时传官方源直装，缺省零变化走机器默认源）；preflight.test 40 绿（命令子串匹配不受后缀影响，零用例改动）+ tsc 0
- ql-20260904-008-b58e | killTree（preflight.ts + host-fs-handler.ts 两处同步）：taskkill spawn 挂 'error' 监听器——spawn 异步 error 事件（taskkill 丢失/PATH 残缺等）无监听器会以 uncaughtException 崩 daemon，try/catch 只能捕同步异常；KT3 用例断言监听器存在且 emit('error') 不抛（runcmd-kill 3 + preflight 40 绿，tsc 0）
