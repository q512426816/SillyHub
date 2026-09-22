# 符号影响面报告

> tasks.md 内容指纹（生成时）: c07c8474daa8c1f1——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。

- task-01: DTO 新增（`SessionExportRequest`，纯新增不修改既有 schema 类）——无既有调用点受影响；新 DTO 消费方=task-03 端点 body 解析（任务范围内）。
- task-02: 新增模块函数 `export_sessions(svc, ...)` + 5 个私有 helper + `SessionExportResult` dataclass；`SessionService` 类新增方法（`session/service/__init__.py` 一行委托）——类新增方法不改既有方法签名，既有调用点（facade `get_agent_session_logs` 等）零影响；新方法消费方=task-03 facade（任务范围内）。
- task-03: 新增路由函数 `export_sessions`（router 层，与 service 函数同名不同模块，按 daemon 域惯例）+ `DaemonService.export_sessions` facade 新增方法 + `_ENDPOINT_ORDER` 列表插入一项——facade 新增不改既有签名；`_ENDPOINT_ORDER` 为 `router/__init__.py` 内部挂载顺序常量，调用点仅该文件自身的 setattr 挂载循环（任务范围内）；路由函数消费方=FastAPI 路由表 + 前端 task-05。
- task-04: 无签名级变更（纯新增测试文件，不改任何生产代码符号）。
- task-05: 新增前端函数 `exportSessions(sessionIds, tier)` + 本地类型 `SessionExportTier`——纯新增，无既有调用点；消费方=task-06（任务范围内）。
- task-06: `SessionListPanel`/`SessionRow` 组件 props 新增 `onExportSessions`（可选 prop，不传则不渲染入口，既有调用方零破坏）；`SessionsPortal` 内部接线新回调——props 新增属接口变更，受影响调用点=session-list-panel 的全部使用方（sessions-portal.tsx 接线在任务范围内；其余页面经 SessionsPortal 薄壳间接使用，不直接传该 prop，零影响）。
- task-07: 无签名级变更（纯测试追加，不改生产符号）。
- task-08: 无签名级变更（api-types.ts/openapi.json 为生成产物再生成；session-export.ts 可选切换生成类型，形状一致）。
