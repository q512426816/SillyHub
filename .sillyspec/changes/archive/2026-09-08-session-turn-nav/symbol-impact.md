# 符号影响面报告

> tasks.md 内容指纹（生成时）: f9a58bb226b11d5a——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 接口扩展（非破坏）——`TurnTimelineProps` 新增可选字段 `highlightTurnKey?: string | null`（turn-timeline.tsx:235），`TurnTimeline` 组件（:535）参数对象新增可选键；内部 memo 组件 `TurnRow` 非导出，仅文件内重渲染。受影响调用点：`session-panel-page.tsx`（<TurnTimeline> page 宿主，不传新 prop 零行为差异；highlightTurnKey 接线在 task-05 范围内）、`session-panel-dialog.tsx`（dialog 宿主独立消费，不传新 prop 零影响，dialog 不挂导航为 design §8 明示不改）、`group-chat-panel.tsx` 等其余 import 方均不消费该 props 新字段。全部调用点兼容可选字段，无需改动 → 在范围内（dialog/group-chat 明示不改动）
- task-02: 纯新增——新文件 `frontend/src/components/sessions/turn-catalog.tsx` 导出 `TurnCatalogEntry` 类型与 `TurnCatalog` 组件（当前全仓 0 调用点，接线在 task-05/06）；无既有符号变更 → 无签名级变更
- task-03: 无签名级变更——`session-panel-page.tsx` 内部新增 `catalogEntries` useMemo（消费既有 `runsMeta` state :261 与 `displayTurns` :1223，均为组件内部 state/useMemo 产物，不改任何导出/props/函数签名）
- task-04: 无签名级变更——`session-panel-page.tsx` 内部新增 `handleJumpToTurn` 回调、`jumpSuppressLoadEarlierRef`/`hasEarlierRef` ref 与既有触顶 scroll effect（:995-1021 内联 effect，非导出符号）联动；`page-helpers.tsx` 仅当触顶判定需参数化时补可选参数（现有导出常量 `LOAD_EARLIER_TRIGGER_PX` 与布局类常量签名不变，调用点全在 session-panel-page.tsx 内部）→ 在范围内
- task-05: 结构性 JSX 变更（非签名）——`sessionBody` 区外包 flex 行插入 `<TurnCatalog>`；受影响调用点：`__tests__/session-panel-variant.test.tsx` desktop 父链断言（:281-286，已在 task-05 allowed_paths 内有意更新）、mobile 分支断言（:321-324）不改动；`data-testid="turn-timeline-scroll"` 容器查询路径（task-04 跳转选择器依赖）保持不变 → 在范围内
- task-06: 无签名级变更——mobile ⋯ 菜单新增「轮次导航」项与 antd Drawer 挂载，均为 `SessionPanelPage` 内部渲染分支扩展；不改组件 props/导出，dialog 宿主与悬浮窗（desktop variant）渲染分支不触碰 → 无签名级变更
