# 符号影响面报告

> tasks.md 内容指纹（生成时）: 4a6530079cfc52d1——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更——全部为新建文件（frontend/src/lib/attachment-refs.ts 新增 5 个纯函数导出与 AttRefTokenMap/InlineAttRefPart 类型），不改任何既有符号。
- task-02: 无签名级变更——全部为新建文件（InputRefOverlay / InlineAttRefText 两组件），不改任何既有符号。
- task-03: 接口增列（additive）——SessionInputBarProps 新增可选 prop `onAttTokenMapChange?: (next: AttRefTokenMap) => void`；受影响调用点：session-panel-page.tsx、session-panel-dialog.tsx（任务范围外，由 task-04 接线消费）；缺省不传行为不变（可选参数，无既有调用点强制改动）。
- task-04: 无签名级变更——page/dialog 组件内部新增 state 与对 substituteAttRefsForSend 的调用，对外 props/导出签名零变化。
- task-05: 无签名级变更——group-chat-panel 组件内部改动（chip 事件/state/镜像层挂载/handleSend 内置换），对外 props 签名零变化。
- task-06: 无签名级变更——turn-segment-views.tsx 与 group-chat-panel.tsx 渲染层内部接入 InlineAttRefText，对外签名零变化。
