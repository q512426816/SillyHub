# 符号影响面报告

> tasks.md 内容指纹（生成时）: 54d989d02ca6f384——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: DTO 变更：AgentSessionRead 新增可空字段 `owner_name: str | None`（新增可选字段，向后兼容）；Query 参数 limit 校验上限 le=100→500（签名形参默认约束变化，参数本身不变）。受影响调用点：前端 api-types.ts 经 gen:types 再生成（task-02 范围内）；pytest 边界用例（task-01 范围内）。均在任务范围内。
- task-02: 类型定义变更：api-types.ts 为 OpenAPI 生成物，owner_name 字段随生成器进入；消费点 SessionListPanel 条目 chips（task-05 范围内）。无手写签名变更；生成+校验均在本任务范围。
- task-03: 接口变更：SessionPanel props `sessionId` 放宽 `string → string | null`（page 分支）+ 新增可选 prop `preContext?: SessionPreContext` + 新增回调 `onPreSessionCreated?`。受影响调用点：sessions-portal.tsx（task-06 接线，已声明）；dialog 适配层传参类型不受影响（仍传 string）；SessionPanelPage 内部窄化（本任务改）。均在任务范围内。
- task-04: 新增组件 pre-session-picker（新文件新接口，无既有调用点）；消费点 sessions-portal（task-06 范围内）。无既有签名变更。
- task-05: 接口变更：SessionListPanel props 变化（新增 onNewInGroup 回调 + 受控展开 prop；内部筛选 state 重组）+ listAgentSessions limit 参数收口（daemon.ts 签名参数透传，既有可选参数无破坏）。受影响调用点：sessions-portal.tsx（task-06 范围内）；session-list-panel.test 改写（本任务）。均在任务范围内。
- task-06: 导出位置变更：resolveDefaultMachineId + NEW_SESSION_MACHINE_LS_KEY 从 new-session-form.tsx 迁至 sessions-portal.tsx（导出语义不变，import 路径变更）；SessionsPortal 内部状态机新增 preContext。受影响调用点：原 import 方 new-session-form.test（task-07 迁移，已声明）。均在任务范围内。
- task-07: 接口删除：new-session-form.tsx（NewSessionForm/NewSessionFormValues/NEW_SESSION_MACHINE_LS_KEY/resolveDefaultMachineId 导出）与 workspace-session-picker.tsx 全量删除。受影响调用点：sessions-portal.tsx（task-06 已移除引用）、app 页面测试 page.test.tsx（本任务迁移）、new-session-form.test/workspace-session-picker.test（本任务删除/迁移）。均在任务范围内。
- task-08: 无签名级变更（回归/部署/实证/文档同步，零代码签名改动）。
