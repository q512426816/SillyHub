# 符号影响面报告

> tasks.md 内容指纹（生成时）: 3746875da7e52395——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更——纯新增（2 条 MSG 常量 + 2 个 send 方法），无既有调用点受影响。
- task-02: 无签名级变更——新增 2 端点与请求模型，不改既有函数签名；_get_owned_instance/hub 均按既有签名调用。
- task-03: 签名级变更 1 处——runtime/service.py heartbeat_daemon 新增 sillyspec_command_result 参数（可选尾参）；调用点=router.py daemon_heartbeat 心跳透传处（model_dump → 实参），在 task-03 allowed_paths 内同步适配。DTO 级：daemon_instances 新列 + 机器视图嵌套读模型，对外消费方为前端 api-types（task-08 gen:types 再生成消化）。
- task-04: 无签名级变更——纯新增测试文件。
- task-05: 无签名级变更——_handleWsMessage 为 switch 新增 case 分支（方法签名不变）；protocol.ts 纯新增常量与类型。
- task-06: 签名级变更 1 处——hub-client.ts heartbeat() 新增可选尾参 sillyspecCommandResult（undefined 键不出现）；调用点=daemon.ts _sendHeartbeatOnce，同卡 allowed_paths 内适配。SillySpecManager 新方法为纯新增。config 新键不改签名。
- task-07: 无签名级变更——新增测试 + 三处既有测试断言适配（非源码签名变更）。
- task-08: 无签名级变更——lib/daemon.ts 纯新增函数；api-types.ts/openapi.json 为生成产物更新，消费方经 tsc 编译期消化（CLAUDE.md 规则 21：产物随变更提交）。
- task-09: 无签名级变更——新组件/hook 纯新增；两页面为 JSX 挂载不改既有导出签名，页面测试适配属断言级。
- task-10: 无签名级变更——组件文案改跳转，测试断言适配属断言级。
- task-11: 无签名级变更——纯文档。
