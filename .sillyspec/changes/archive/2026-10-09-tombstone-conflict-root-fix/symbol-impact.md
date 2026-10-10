# 符号影响面报告

> tasks.md 内容指纹（生成时）: f8d8cb397ea7e905——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。

- task-01: 签名级新增×3（均在任务范围内，无既有调用点受影响）：①MachineSillySpecTombstoneCleanupRequest 新 schema 类（新符号）；②ws_hub.send_sillyspec_tombstone_cleanup(instance_id, change, workspace_id) 新方法（对齐 send_sillyspec_resolve:428 形态，调用点=新端点）；③MachineSillySpecCommandResultRead.action Literal 联合类型扩展加 'tombstone_cleanup'（值域扩展——daemon 侧 heartbeat.py:108-110 显式不收紧 Literal，下游消费 matchesCommandResult 分支为 task-04 范围内新增，既有 resolve/ghost_cleanup 消费不受影响）。
- task-02: 无签名级变更（delete_change 内部追加下发段，方法签名/返回结构不动；消费 task-01 提供的 send_sillyspec_tombstone_cleanup，调用点在本任务范围内新增）。
- task-03: 签名级新增×2（均在任务范围内）：①SillySpecManager.runTombstoneCleanup(change, workspaceId): Promise<void> 新执行器方法（daemon.ts:1543 接口声明同步扩展，调用点=daemon.ts WS 分发新分支）；②daemon.ts 消息分发新增 daemon:sillyspec_tombstone_cleanup case（新分支，既有 resolve/ghost 分支不动）。
- task-04: 无签名级变更（组件内部渲染逻辑+useQuery 新挂载；新增 lib 函数 triggerMachineSillySpecTombstoneCleanup 为新符号非签名变更；matchesCommandResult 为模块私有函数内部分支扩展）。
- task-05: 无签名级变更（spec-sync.js 纯墓碑分支内部改记账目标文件名+记录结构字段；stage-machine.js _listPendingConflicts 内部 type 判定逻辑，方法签名/导出面不动；消费记录 JSON 的 machine-interface.js:854 只读 change/created_at 不受 type 值域扩展影响——daemon 摘要 conflictTypeMeta 对未知 type 有 default 中性展示分支）。
