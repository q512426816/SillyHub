# 符号影响面报告

> tasks.md 内容指纹（生成时）: c4bfe4fa376a257b——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无对外签名级变更——extension_ui_request 分派器内部逻辑改造 + 新增私有 PendingDialog 挂起表与四方法归一化（均模块内私有）；PiStartOptions.sessionPermission? 字段新增归 task-02
- task-02: 接口定义变更——PiStartOptions 新增可选字段 sessionPermission?: CodexSessionPermissionHooks（可选向后兼容，缺省 undefined 零破坏）；受影响调用点=driver-factory.ts 构建 PiStartOptions 处（同任务范围内）与 pi-rpc-driver 构造消费（task-01 范围），无范围外调用点
- task-03: 无签名级变更——私有 denormalize 实现替换 task-01 的 cancelled 占位 + close/abortAll 兜底路径（driver 内部）
- task-04: 无签名级变更——仅测试文件（tests/interactive/pi-rpc-driver.test.ts）新增用例
- task-05: 无签名级变更——纯 spike 记录文档（NEW spike-cursor-marker.md），无代码
- task-06: 新增导出（新文件 NEW:askuser-marker.ts）——parseAskUserMarker 函数与 AskUserMarkerPayload 类型为新导出非既有签名修改，无既有调用点
- task-07: 组件新增（NEW:ask-user-marker-card.tsx）+ turn-timeline.tsx 内部 JSX 接入——不改既有组件 props/导出签名
- task-08: 无对外签名级变更——session-manager/turn-control 用户消息入队处内部前缀注入（私有常量）
- task-09: 无签名级变更（行为变更）——permission_service 影子分支放行 + answered_by 写入语义修正，函数签名不动；调用点=answer 端点链内部（同文件）
- task-10: 无签名级变更——ask-user-dialog-card.tsx 内部渲染增强（推荐条/关闭态），props 与提交协议不动
- task-11: 无签名级变更——group-chat-panel.tsx 内部聚合渲染 + 新测试文件
- task-12: DTO/接口定义变更——ProviderCaps 三端类型新增 dialog: 'native'|'marker'|'none' 键（providers.ts PROVIDER_CAPS / provider-caps.ts / provider_caps.py）；受影响调用点=test_provider_caps_alignment.py 解析器与键数断言（同任务 allowed_paths 内）+ session-panel-provider-caps.test.tsx（已列 related_tests 且在 allowed_paths）+ getProviderCaps 消费方（只读新键，缺省回退 'none' 不破坏）
- task-13: 无签名级变更——纯冒烟验收文档（NEW smoke-result.md）
