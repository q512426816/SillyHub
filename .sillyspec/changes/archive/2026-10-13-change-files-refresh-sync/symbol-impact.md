# 符号影响面报告

> tasks.md 内容指纹（生成时）: 0ea453055bb859b7——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 接口扩展——SillySpecCommandExecutor（daemon.ts:1554）新增可选成员 `runSyncChange(change:string, workspaceId?:string)`：纯新增（不改既有 runResolve/runGhostCleanup/runTombstoneCleanup 成员）；受影响调用点=executor 字段探测（daemon.ts:7828 起逐字段 typeof 检测，新增可选成员不破坏既有探测）；实现体落在 sillyspec-manager.ts 新方法（类实例方法新增，无既有调用点）；在任务范围内。
- task-02: 新增 RPC handler 注册 `sillyspec_sync_change`（daemon.ts `_registerHostFsRpcHandler` 同款 registerRpcHandler 调用新增）+ 模块级防抖 Map 新增：纯新增注册项与内存结构，不改既有 host_fs.* 十三方法与 SILLYSPEC_* 消息处理分支；受影响调用点=无（新 method 无既有消费方）；在任务范围内。
- task-03: 无签名级变更——纯新增测试文件（tests/sillyspec-sync-change-rpc.test.ts），不改任何既有导出符号。
- task-04: 新增私有函数 `_sync_change_via_daemon`（backend/app/modules/change/router.py 模块级）+ `list_change_files` handler 体前插一行调用（函数签名/响应模型 ChangeFileList 不变）；受影响调用点=list_change_files 唯一（router 装饰器挂载，FastAPI 路由签名不变）；service.list_files 及其它调用方零改动；在任务范围内。
- task-05: 无签名级变更——纯新增测试文件（test_files_refresh_sync.py）+ 既有 test_files_router.py 复跑（断言不受影响：响应模型未变）。
- task-06: 无签名级变更——收账任务，不改符号。
