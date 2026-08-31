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

