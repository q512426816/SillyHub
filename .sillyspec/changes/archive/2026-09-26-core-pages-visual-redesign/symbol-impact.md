# 符号影响面报告

> tasks.md 内容指纹（生成时）: 1dfa964fab4f6e36——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更——themes.ts 仅新增 semantic soft 数据字段（ThemeColorDef 值扩展），不改 ThemeName 类型与既有字段
- task-02: 无签名级变更——纯新增组件（StateIcon/StateLabel/Counter/EmptyState 为新导出符号，无既有调用点）
- task-03: 无签名级变更——纯新增组件（PageHead/UnderlineNav/IssueRow/IssueRowHeader/StatGrid 为新导出符号）
- task-04: 无签名级变更——纯新增 Timeline/MetaPanel 系 + index.ts 桶导出
- task-05: 无签名级变更——changes/page.tsx 默认导出页面组件签名不变（内部结构重排）；被 /m 移动端引用的组件零改动
- task-06: 无签名级变更——[cid]/page.tsx 页面组件签名不变；detail/ 组件仅样式与内部 JSX 重排，props 接口不动
- task-07: 无签名级变更——workspaces/page.tsx 签名不变；workspace-card/drag-grid 内部重排，导出 props 不动
- task-08: 无签名级变更——[id]/page.tsx 签名不变；workspace/ 子组件展示层重排，props 不动（hero-header 退役属组件删除，其唯一消费点在本页内）
- task-09: 无签名级变更——红线约束：session-list-panel/sessions-portal 仅 render 与样式类，props/状态机/数据流不动
- task-10: 无签名级变更——红线约束：session-panel-page/pre-session-picker 仅 render 与样式类，props 不动
- task-11: 无签名级变更——portal-file-panels 仅样式类，数据流不动
- task-12: 无签名级变更——top-bar 仅 className token 替换，导出与 props 不动
- task-13: 无签名级变更——纯文档改写
