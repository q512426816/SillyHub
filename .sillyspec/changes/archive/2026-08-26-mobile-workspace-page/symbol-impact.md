# 符号影响面报告

> tasks.md 内容指纹（生成时）: 285e1b4a3ed0a585——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更（m/layout.tsx 内部加 DRILL_ROUTES 分支与导出纯函数 isDrillRoute，新增导出不改既有符号）
- task-02: 无签名级变更（纯新增 layout.tsx/page.tsx）
- task-03: 无签名级变更（handleActivate 内部实现替换，函数签名与调用点不变）
- task-04: 无签名级变更（纯新增组件）
- task-05: 无签名级变更（PENDING_REVIEW_LABEL 仅加 export 关键字=可见性扩展，非签名增删改；既有引用点零影响）
- task-06: 无签名级变更（纯新增页面）
- task-07: 无签名级变更（task-06 页面内增量渲染分支）
- task-08: 无签名级变更（纯新增组件）
- task-09: 无签名级变更（纯新增页面）
- task-10: 无签名级变更（纯新增两条 redirect 薄壳页）
- task-11: 无签名级变更（纯新增组件）
- task-12: 无签名级变更（纯新增页面）
- task-13: 接口定义变更：PreSessionPickerProps 新增可选 prop variant?:"center"|"bottomSheet"（默认 "center"）。调用点 2 处均不传 variant 行为不变且无需改动——floating-session-host.tsx、sessions-portal.tsx（grep <PreSessionPicker 实证）。向后兼容，调用点修改不在任务范围也不需要
- task-14: 接口定义变更：SessionPanelProps 新增可选 prop variant?:"desktop"|"mobile"（默认 "desktop"）。调用点 5 处均不传 variant 行为不变且无需改动——runtime-session-helpers.tsx:120（mode="dialog"，dialog 分支不消费 variant）、floating-session-host.tsx:307/317、sessions-portal.tsx:482/491（grep <SessionPanel 实证）。向后兼容，调用点修改不在任务范围也不需要
- task-15: 无签名级变更（纯新增页面，消费 task-14 的新可选 prop）
- task-16: 无签名级变更（测试与文档收尾，不改源码签名）
