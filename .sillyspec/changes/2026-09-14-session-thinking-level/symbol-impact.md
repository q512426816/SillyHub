# 符号影响面报告

> tasks.md 内容指纹（生成时）: 31346f433df21f79——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含  的行**——骨架不能直接过门。

- task-01: 接口加键+codex thinking 翻值。受影响调用点全在任务范围（INTERACTIVE_PROVIDERS satisfies/回退/两 @generated/守护四处/picker 两 toEqual）；既有按键取值消费方成员访问不受影响。
- task-02: 新增纯函数模块零依赖零调用点。无签名级变更。
- task-03: InteractiveDriver 加两个可选方法+StartOptions 加可选字段（可选追加零破坏）；session-manager facade 两方法+NEW 子模块；daemon.ts 两 RPC handler+execPayload 归一化追加。无签名级破坏。
- task-04: 三 driver 各加两可选方法实现+启动设置（类内新增）；claude getThinkingLevels 签名带 model? 参数（新增可选参数零破坏）。无签名级变更。
- task-05: 新端点两+NEW 服务+全链形参追加（schema/create/placement/lease 均加可选参数透传——可选追加）；_ENDPOINT_ORDER 机械必改。无签名级破坏。
- task-06: sessions.ts 两 API 新增；session-config-bar 加档位下拉（组件内）；session-panel-page 加 preThinkingLevel 与切换控件。无签名级变更。
- task-07: 文档+真机验证。无代码符号无签名级变更。
- task-01: 接口加键+codex thinking 翻值。受影响调用点全在任务范围（INTERACTIVE_PROVIDERS satisfies/回退/两 @generated/守护四处/picker 两 toEqual）；既有按键取值消费方成员访问不受影响。
- task-02: 新增纯函数模块零依赖零调用点。无签名级变更。
- task-03: InteractiveDriver 加两个可选方法+StartOptions 加可选字段（可选追加零破坏）；session-manager facade 两方法+NEW 子模块；daemon.ts 两 RPC handler+execPayload 归一化追加。无签名级破坏。
- task-04: 三 driver 各加两可选方法实现+启动设置（类内新增）；claude getThinkingLevels 签名带 model? 参数（新增可选参数零破坏）。无签名级变更。
- task-05: 新端点两+NEW 服务+全链形参追加（schema/create/placement/lease 均加可选参数透传——可选追加）；_ENDPOINT_ORDER 机械必改。无签名级破坏。
- task-06: sessions.ts 两 API 新增；session-config-bar 加档位下拉（组件内）；session-panel-page 加 preThinkingLevel 与切换控件。无签名级变更。
- task-07: 文档+真机验证。无代码符号无签名级变更。
- task-01: 接口加键+codex thinking 翻值。受影响调用点全在任务范围（INTERACTIVE_PROVIDERS satisfies/回退/两 @generated/守护四处/picker 两 toEqual）；既有按键取值消费方成员访问不受影响。
- task-02: 新增纯函数模块零依赖零调用点。无签名级变更。
- task-03: InteractiveDriver 加两个可选方法+StartOptions 加可选字段（可选追加零破坏）；session-manager facade 两方法+NEW 子模块；daemon.ts 两 RPC handler+execPayload 归一化追加。无签名级破坏。
- task-04: 三 driver 各加两可选方法实现+启动设置（类内新增）；claude getThinkingLevels 签名带 model? 参数（新增可选参数零破坏）。无签名级变更。
- task-05: 新端点两+NEW 服务+全链形参追加（schema/create/placement/lease 均加可选参数透传——可选追加）；_ENDPOINT_ORDER 机械必改。无签名级破坏。
- task-06: sessions.ts 两 API 新增；session-config-bar 加档位下拉（组件内）；session-panel-page 加 preThinkingLevel 与切换控件。无签名级变更。
- task-07: 文档+真机验证。无代码符号无签名级变更。
- task-01: 接口加键+codex thinking 翻值。受影响调用点全在任务范围（INTERACTIVE_PROVIDERS satisfies/回退/两 @generated/守护四处/picker 两 toEqual）；既有按键取值消费方成员访问不受影响。
- task-02: 新增纯函数模块零依赖零调用点。无签名级变更。
- task-03: InteractiveDriver 加两个可选方法+StartOptions 加可选字段（可选追加零破坏）；session-manager facade 两方法+NEW 子模块；daemon.ts 两 RPC handler+execPayload 归一化追加。无签名级破坏。
- task-04: 三 driver 各加两可选方法实现+启动设置（类内新增）；claude getThinkingLevels 签名带 model? 参数（新增可选参数零破坏）。无签名级变更。
- task-05: 新端点两+NEW 服务+全链形参追加（schema/create/placement/lease 均加可选参数透传——可选追加）；_ENDPOINT_ORDER 机械必改。无签名级破坏。
- task-06: sessions.ts 两 API 新增；session-config-bar 加档位下拉（组件内）；session-panel-page 加 preThinkingLevel 与切换控件。无签名级变更。
- task-07: 文档+真机验证。无代码符号无签名级变更。
- task-01: 接口加键+codex thinking 翻值。受影响调用点全在任务范围（INTERACTIVE_PROVIDERS satisfies/回退/两 @generated/守护四处/picker 两 toEqual）；既有按键取值消费方成员访问不受影响。
- task-02: 新增纯函数模块零依赖零调用点。无签名级变更。
- task-03: InteractiveDriver 加两个可选方法+StartOptions 加可选字段（可选追加零破坏）；session-manager facade 两方法+NEW 子模块；daemon.ts 两 RPC handler+execPayload 归一化追加。无签名级破坏。
- task-04: 三 driver 各加两可选方法实现+启动设置（类内新增）；claude getThinkingLevels 签名带 model? 参数（新增可选参数零破坏）。无签名级变更。
- task-05: 新端点两+NEW 服务+全链形参追加（schema/create/placement/lease 均加可选参数透传——可选追加）；_ENDPOINT_ORDER 机械必改。无签名级破坏。
- task-06: sessions.ts 两 API 新增；session-config-bar 加档位下拉（组件内）；session-panel-page 加 preThinkingLevel 与切换控件。无签名级变更。
- task-07: 文档+真机验证。无代码符号无签名级变更。
- task-01: 接口加键+codex thinking 翻值。受影响调用点全在任务范围（INTERACTIVE_PROVIDERS satisfies/回退/两 @generated/守护四处/picker 两 toEqual）；既有按键取值消费方成员访问不受影响。
- task-02: 新增纯函数模块零依赖零调用点。无签名级变更。
- task-03: InteractiveDriver 加两个可选方法+StartOptions 加可选字段（可选追加零破坏）；session-manager facade 两方法+NEW 子模块；daemon.ts 两 RPC handler+execPayload 归一化追加。无签名级破坏。
- task-04: 三 driver 各加两可选方法实现+启动设置（类内新增）；claude getThinkingLevels 签名带 model? 参数（新增可选参数零破坏）。无签名级变更。
- task-05: 新端点两+NEW 服务+全链形参追加（schema/create/placement/lease 均加可选参数透传——可选追加）；_ENDPOINT_ORDER 机械必改。无签名级破坏。
- task-06: sessions.ts 两 API 新增；session-config-bar 加档位下拉（组件内）；session-panel-page 加 preThinkingLevel 与切换控件。无签名级变更。
- task-07: 文档+真机验证。无代码符号无签名级变更。
- task-01: 接口加键+codex thinking 翻值。受影响调用点全在任务范围（INTERACTIVE_PROVIDERS satisfies/回退/两 @generated/守护四处/picker 两 toEqual）；既有按键取值消费方成员访问不受影响。
- task-02: 新增纯函数模块零依赖零调用点。无签名级变更。
- task-03: InteractiveDriver 加两个可选方法+StartOptions 加可选字段（可选追加零破坏）；session-manager facade 两方法+NEW 子模块；daemon.ts 两 RPC handler+execPayload 归一化追加。无签名级破坏。
- task-04: 三 driver 各加两可选方法实现+启动设置（类内新增）；claude getThinkingLevels 签名带 model? 参数（新增可选参数零破坏）。无签名级变更。
- task-05: 新端点两+NEW 服务+全链形参追加（schema/create/placement/lease 均加可选参数透传——可选追加）；_ENDPOINT_ORDER 机械必改。无签名级破坏。
- task-06: sessions.ts 两 API 新增；session-config-bar 加档位下拉（组件内）；session-panel-page 加 preThinkingLevel 与切换控件。无签名级变更。
- task-07: 文档+真机验证。无代码符号无签名级变更。
