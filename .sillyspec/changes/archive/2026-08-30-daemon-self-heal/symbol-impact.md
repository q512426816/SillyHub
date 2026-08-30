# 符号影响面报告

> tasks.md 内容指纹（生成时）: 562bfaac611c3781——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: **新增导出签名**：`validateBundleContent(buf): {ok, buildId, size}`（同步纯函数）、`validateBundleOnDisk(binDir, logger, label?): Promise<boolean>`、`export const MIN_BUNDLE_BYTES = 65_536`。均为全新符号，无既有调用点；受影响调用方=task-02/03/07/04（同变更内消费，契约已入 TaskCard provides）。无既有签名修改。
- task-02: 无签名级变更。`downloadAndReplace` 签名不变（preflight.ts:434 既有 fileName/eventName 参数原样），仅函数体内插校验+备份；唯一直调测试 `tests/preflight-download-replace.test.ts:30-47` 行为断言受影响（fixture 13 字节将被拦）——已入 task-04 范围（plan 审查问题 1）。
- task-03: **签名级变更 ×2**：① `respawnDaemonAndExit(logger, binDir?, exitDelayMs?)` 返回 `void → Promise<void>`（plan 审查裁定方案 a）——调用点 3 处均 fire-and-forget 不取返回值（preflight.ts:110 runPreflight 内、daemon.ts:2145/2179 _tryUpdate 两分支），typecheck 兼容；既有同步断言用例 preflight.test.ts:512-575 需 await 微调（在 task-04 范围）。② `runPreflight(config, logger)` → `runPreflight(config, logger, binDir?)` 增可选第三参——生产唯一调用点 daemon.ts:1525 不传（行为不变），测试调用点 preflight.test.ts:602/617/650 改传临时目录（task-04 范围）。
- task-04: 无签名级变更（纯测试文件）。消费 task-01 三新符号 + task-02 行为契约（daemon_bundle_validation_failed/备份轮换）+ task-03 签名契约（async Promise\<void\>/binDir 第三参），fixture/断言适配均在本任务 allowed_paths 两文件内。
- task-05: **私有方法重命名+参数化**：`_recoverSessionsOnBoot()` → `_recoverPersistedSessions(trigger: 'boot' | 'heartbeat_recover')`。调用点唯一：daemon.ts:1583（start() 内，改传 'boot'）；grep 全仓无其他引用（tests/ 仅 integration/resilience-scenarios.test.ts 注释提及，注释不涉及签名）。行为零变化（日志增 trigger 字段）。
- task-06: 无签名级变更。新增私有成员/方法（`_recoverPendingAfterDegraded`、`_maybeRecoverAfterDegraded`、`_recoverInFlight`）与模块级常量 `RECOVER_AFTER_DEGRADED_MS`（新导出，供测试断言，先例 REGISTER_RETRY_BASE_MS）；`_isBusyForUpdate()` 签名不变仅扩返回判定（调用点 _tryUpdate，语义向后兼容：新增 true 臂）；`_heartbeatFailSince` 私有成员语义扩展（401/403 分支补置位）无外部可见性。
- task-07: 无签名级变更。`_tryUpdate` 内部插 stop 前校验分支（消费 task-01 的 validateBundleOnDisk）；不动既有方法签名与 WS 消息结构。
- task-08: 无签名级变更（零代码改动回归闸门）。
