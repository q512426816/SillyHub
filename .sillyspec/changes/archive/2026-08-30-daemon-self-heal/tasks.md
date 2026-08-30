---
author: qinyi
created_at: 2026-08-30 17:21:47
---

# 任务（Tasks）

> Wave 划分铁律：共享同一文件的任务分不同 Wave（preflight.ts: 01→02→03 串行、
> daemon.ts: 05→06→07 串行、preflight 两个测试文件 task-04 独占——preflight 侧
> 单测集中落 task-04，见 plan.md 依赖总览）。

## 任务清单

- [x] task-01: preflight.ts 新增校验器三件套（MIN_BUNDLE_BYTES/validateBundleContent/validateBundleOnDisk），仅实现
- [x] task-02: downloadAndReplace 写入校验前置 + .bak 备份轮换保留 3 份（mcp 伴生同款），仅实现 (depends_on: task-01)
- [x] task-03: respawnDaemonAndExit 拉起前最后防线校验（不过不退出；签名改 async Promise<void，plan 审查裁定方案 a）+ runPreflight 增可选 binDir 参数，仅实现 (depends_on: task-01)
- [x] task-04: preflight.test.ts + preflight-download-replace.test.ts 全套测试：集成用例 binDir 隔离 + validFakeBundle fixture 合法化（含 download-replace 旧 fixture）+ 校验器/备份/respawn 拦截新用例 + 真实 bin hash 不变回归 (depends_on: task-01,02,03)
- [x] task-05: _recoverSessionsOnBoot 参数化提取为 _recoverPersistedSessions(trigger)（boot 行为零变化）
- [x] task-06: 心跳恢复触发点（720s 守卫）+ 忙门控 pending 复查 + _isBusyForUpdate 扩展 + 401/403 补置 failSince + 单测（daemon-heartbeat-pending / integration/selfupdate-scenarios） (depends_on: task-05)
- [x] task-07: _tryUpdate stop 前 validateBundleOnDisk 主拦截（GAP-1 顺序钉扎，拦截释放所有权）+ 单测（daemon-selfupdate-orchestrator） (depends_on: task-01,06)
- [x] task-08: 整体回归（typecheck + 枚举 8 测试文件全绿 + 真实 bin hash 不变 + 范围核对） (depends_on: task-01,02,03,04,05,06,07)

## 验收锚点

- 成功标准见 proposal.md（7 条可验证项）。
- 生命周期契约表与文件变更清单见 design.md。
- Wave 分组与依赖见 plan.md。
