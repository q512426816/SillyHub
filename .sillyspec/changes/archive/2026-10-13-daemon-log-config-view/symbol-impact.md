# 符号影响面报告

> tasks.md 内容指纹（生成时）: d24d0ed6505cd4a8——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更——纯新增（sillyhub-daemon/src/diag-rpc.ts 新文件：readLogTail/getMaskedConfig/SENSITIVE_CONFIG_FIELDS 均新符号，无既有调用点）；daemon.ts 仅新增私有方法 _registerDiagRpcHandler 与注册调用，不改任何既有方法签名（就近 sillyhub-daemon/src/daemon.ts:6985 _registerHostFsRpcHandler 区域）。
- task-02: 新增对外签名（在任务范围内）：schema.py 新增 DaemonLogTailResponse/DaemonConfigResponse 两个 DTO（全新，无既有调用点）；machines.py 新增两个 GET 端点函数（全新路由，无既有调用点）；router/__init__.py 仅 _ENDPOINT_ORDER 列表追加两项（数据表非签名）。既有端点/函数签名零改动。
- task-03: 无签名级变更——machines.ts 新增两个导出函数（fetchMachineLogTail/fetchMachineConfig，全新无既有调用点）；machine-card.tsx 新增**可选** prop onOpenDiagnostic（optional，不改 MachineCardProps 既有必填面——既有 machine-card.test.tsx 的 typed defaultProps 不受影响）；page.tsx 新增顶层 state 与弹窗渲染（组件内部，非导出签名）；新组件 daemon-diagnostic-dialog.tsx 为新文件。
