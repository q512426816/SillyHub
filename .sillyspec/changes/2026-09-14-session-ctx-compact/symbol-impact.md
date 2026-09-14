# 符号影响面报告

> tasks.md 内容指纹（生成时）: d09341da2491a59b——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含  的行**——骨架不能直接过门。

- task-01: 接口定义变更——ProviderCaps 加第 12 键 compact。受影响调用点：INTERACTIVE_PROVIDERS satisfies（同文件）/getProviderCaps 回退（同文件）/两份 @generated（同任务重生成）/守护断言四处（同任务 allowed_paths）/既有按键取值消费方（成员访问不受键数影响）。全在任务范围。
- task-02: 新增端点+service（NEW 文件零调用点）+schema DTO 新增；session_crud.py 加路由函数（文件内追加）；gen:types 产物刷新。无既有签名变更。
- task-03: InteractiveDriver 接口加可选方法 compact?()（可选追加，既有实现零影响）；session-manager facade 加 compact 委托+NEW 子模块；daemon.ts 加 registerRpcHandler（文件内追加）。无签名级破坏变更。
- task-04: PiRpcDriver 加可选 compact 实现（类内新增方法）；_sendCommand 既有签名零改动。无签名级变更。
- task-05: CodexAppServerDriver 加 compact 实现+handle 加 pending map 字段（内部状态）+response 分支按 id 分流（既有 fire-and-forget 路径行为保持——新增分支仅命中 pending id）。既有断言 toMatchObject 类不受影响。
- task-06: CtxUsageRingProps 加可选 props（可选追加）；session-panel-page 新增 mutation 与传参（文件内追加/调用点改两处）。无签名级变更。
- task-07: 文档+真机验证，无代码符号，无签名级变更。
- task-01: 接口定义变更——ProviderCaps 加第 12 键 compact。受影响调用点：INTERACTIVE_PROVIDERS satisfies（同文件）/getProviderCaps 回退（同文件）/两份 @generated（同任务重生成）/守护断言四处（同任务 allowed_paths）/既有按键取值消费方（成员访问不受键数影响）。全在任务范围。
- task-02: 新增端点+service（NEW 文件零调用点）+schema DTO 新增；session_crud.py 加路由函数（文件内追加）；gen:types 产物刷新。无既有签名变更。
- task-03: InteractiveDriver 接口加可选方法 compact?()（可选追加，既有实现零影响）；session-manager facade 加 compact 委托+NEW 子模块；daemon.ts 加 registerRpcHandler（文件内追加）。无签名级破坏变更。
- task-04: PiRpcDriver 加可选 compact 实现（类内新增方法）；_sendCommand 既有签名零改动。无签名级变更。
- task-05: CodexAppServerDriver 加 compact 实现+handle 加 pending map 字段（内部状态）+response 分支按 id 分流（既有 fire-and-forget 路径行为保持——新增分支仅命中 pending id）。既有断言 toMatchObject 类不受影响。
- task-06: CtxUsageRingProps 加可选 props（可选追加）；session-panel-page 新增 mutation 与传参（文件内追加/调用点改两处）。无签名级变更。
- task-07: 文档+真机验证，无代码符号，无签名级变更。
- task-01: 接口定义变更——ProviderCaps 加第 12 键 compact。受影响调用点：INTERACTIVE_PROVIDERS satisfies（同文件）/getProviderCaps 回退（同文件）/两份 @generated（同任务重生成）/守护断言四处（同任务 allowed_paths）/既有按键取值消费方（成员访问不受键数影响）。全在任务范围。
- task-02: 新增端点+service（NEW 文件零调用点）+schema DTO 新增；session_crud.py 加路由函数（文件内追加）；gen:types 产物刷新。无既有签名变更。
- task-03: InteractiveDriver 接口加可选方法 compact?()（可选追加，既有实现零影响）；session-manager facade 加 compact 委托+NEW 子模块；daemon.ts 加 registerRpcHandler（文件内追加）。无签名级破坏变更。
- task-04: PiRpcDriver 加可选 compact 实现（类内新增方法）；_sendCommand 既有签名零改动。无签名级变更。
- task-05: CodexAppServerDriver 加 compact 实现+handle 加 pending map 字段（内部状态）+response 分支按 id 分流（既有 fire-and-forget 路径行为保持——新增分支仅命中 pending id）。既有断言 toMatchObject 类不受影响。
- task-06: CtxUsageRingProps 加可选 props（可选追加）；session-panel-page 新增 mutation 与传参（文件内追加/调用点改两处）。无签名级变更。
- task-07: 文档+真机验证，无代码符号，无签名级变更。
- task-01: 接口定义变更——ProviderCaps 加第 12 键 compact。受影响调用点：INTERACTIVE_PROVIDERS satisfies（同文件）/getProviderCaps 回退（同文件）/两份 @generated（同任务重生成）/守护断言四处（同任务 allowed_paths）/既有按键取值消费方（成员访问不受键数影响）。全在任务范围。
- task-02: 新增端点+service（NEW 文件零调用点）+schema DTO 新增；session_crud.py 加路由函数（文件内追加）；gen:types 产物刷新。无既有签名变更。
- task-03: InteractiveDriver 接口加可选方法 compact?()（可选追加，既有实现零影响）；session-manager facade 加 compact 委托+NEW 子模块；daemon.ts 加 registerRpcHandler（文件内追加）。无签名级破坏变更。
- task-04: PiRpcDriver 加可选 compact 实现（类内新增方法）；_sendCommand 既有签名零改动。无签名级变更。
- task-05: CodexAppServerDriver 加 compact 实现+handle 加 pending map 字段（内部状态）+response 分支按 id 分流（既有 fire-and-forget 路径行为保持——新增分支仅命中 pending id）。既有断言 toMatchObject 类不受影响。
- task-06: CtxUsageRingProps 加可选 props（可选追加）；session-panel-page 新增 mutation 与传参（文件内追加/调用点改两处）。无签名级变更。
- task-07: 文档+真机验证，无代码符号，无签名级变更。
- task-01: 接口定义变更——ProviderCaps 加第 12 键 compact。受影响调用点：INTERACTIVE_PROVIDERS satisfies（同文件）/getProviderCaps 回退（同文件）/两份 @generated（同任务重生成）/守护断言四处（同任务 allowed_paths）/既有按键取值消费方（成员访问不受键数影响）。全在任务范围。
- task-02: 新增端点+service（NEW 文件零调用点）+schema DTO 新增；session_crud.py 加路由函数（文件内追加）；gen:types 产物刷新。无既有签名变更。
- task-03: InteractiveDriver 接口加可选方法 compact?()（可选追加，既有实现零影响）；session-manager facade 加 compact 委托+NEW 子模块；daemon.ts 加 registerRpcHandler（文件内追加）。无签名级破坏变更。
- task-04: PiRpcDriver 加可选 compact 实现（类内新增方法）；_sendCommand 既有签名零改动。无签名级变更。
- task-05: CodexAppServerDriver 加 compact 实现+handle 加 pending map 字段（内部状态）+response 分支按 id 分流（既有 fire-and-forget 路径行为保持——新增分支仅命中 pending id）。既有断言 toMatchObject 类不受影响。
- task-06: CtxUsageRingProps 加可选 props（可选追加）；session-panel-page 新增 mutation 与传参（文件内追加/调用点改两处）。无签名级变更。
- task-07: 文档+真机验证，无代码符号，无签名级变更。
- task-01: 接口定义变更——ProviderCaps 加第 12 键 compact。受影响调用点：INTERACTIVE_PROVIDERS satisfies（同文件）/getProviderCaps 回退（同文件）/两份 @generated（同任务重生成）/守护断言四处（同任务 allowed_paths）/既有按键取值消费方（成员访问不受键数影响）。全在任务范围。
- task-02: 新增端点+service（NEW 文件零调用点）+schema DTO 新增；session_crud.py 加路由函数（文件内追加）；gen:types 产物刷新。无既有签名变更。
- task-03: InteractiveDriver 接口加可选方法 compact?()（可选追加，既有实现零影响）；session-manager facade 加 compact 委托+NEW 子模块；daemon.ts 加 registerRpcHandler（文件内追加）。无签名级破坏变更。
- task-04: PiRpcDriver 加可选 compact 实现（类内新增方法）；_sendCommand 既有签名零改动。无签名级变更。
- task-05: CodexAppServerDriver 加 compact 实现+handle 加 pending map 字段（内部状态）+response 分支按 id 分流（既有 fire-and-forget 路径行为保持——新增分支仅命中 pending id）。既有断言 toMatchObject 类不受影响。
- task-06: CtxUsageRingProps 加可选 props（可选追加）；session-panel-page 新增 mutation 与传参（文件内追加/调用点改两处）。无签名级变更。
- task-07: 文档+真机验证，无代码符号，无签名级变更。
- task-01: 接口定义变更——ProviderCaps 加第 12 键 compact。受影响调用点：INTERACTIVE_PROVIDERS satisfies（同文件）/getProviderCaps 回退（同文件）/两份 @generated（同任务重生成）/守护断言四处（同任务 allowed_paths）/既有按键取值消费方（成员访问不受键数影响）。全在任务范围。
- task-02: 新增端点+service（NEW 文件零调用点）+schema DTO 新增；session_crud.py 加路由函数（文件内追加）；gen:types 产物刷新。无既有签名变更。
- task-03: InteractiveDriver 接口加可选方法 compact?()（可选追加，既有实现零影响）；session-manager facade 加 compact 委托+NEW 子模块；daemon.ts 加 registerRpcHandler（文件内追加）。无签名级破坏变更。
- task-04: PiRpcDriver 加可选 compact 实现（类内新增方法）；_sendCommand 既有签名零改动。无签名级变更。
- task-05: CodexAppServerDriver 加 compact 实现+handle 加 pending map 字段（内部状态）+response 分支按 id 分流（既有 fire-and-forget 路径行为保持——新增分支仅命中 pending id）。既有断言 toMatchObject 类不受影响。
- task-06: CtxUsageRingProps 加可选 props（可选追加）；session-panel-page 新增 mutation 与传参（文件内追加/调用点改两处）。无签名级变更。
- task-07: 文档+真机验证，无代码符号，无签名级变更。
