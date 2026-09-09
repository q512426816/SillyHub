# 符号影响面报告

> tasks.md 内容指纹（生成时）: 5aef09e81f8d7cee——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更——globals.css 纯新增 CSS 变量与既有 --shadow-primary 取值调整，无 JS 符号
- task-02: 无签名级变更——themes.ts 改 darkTheme.color.bg 一个字面量值，ThemeDef 接口不动
- task-03: 新增导出 ChatMessageAvatarProps/ChatMessageAvatar + useAvatarSrc 平移（新位置导出、旧位置改 re-export 不破坏既有 import）；受影响调用点：group-member-avatar.tsx 内部（任务范围内）
- task-04: 新增导出 RoundDividerStatus/RoundDividerProps/RoundDivider + chat/index.ts 桶导出；无既有签名变更
- task-05: 无签名级变更——turn-segment-views 类名/包裹结构调整，TextSegmentView 签名不动（memo 稳定性依赖不变）
- task-06: 无签名级变更——turn-timeline JSX 结构调整；TurnUiStatus 类型不动（RoundDividerStatus 与其六态字面量对齐）
- task-07: 无签名级变更——page-helpers PANEL_HEADER_CLS_* 常量值调整（常量名不变）；session-panel-page JSX 调整
- task-08: 无签名级变更——session-list-panel 行结构 JSX；PROVIDER_META 只读消费（runtimes.ts 不改）
- task-09: 无签名级变更——app-shell/top-bar 类名；layout.tsx 背景样式
- task-10: 无签名级变更——group-chat-panel 头像渲染点替换为 ChatMessageAvatar 消费；归并/分页逻辑零触碰
- task-11: 无签名级变更——session-input-bar 容器类名
- task-12: 无签名级变更——纯验证任务（测试/实拍）
