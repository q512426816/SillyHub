# 符号影响面报告

> tasks.md 内容指纹（生成时）: 0963b1b6277a2756——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 接口扩展（可选字段）——SessionTurnView（frontend/src/components/daemon/turn-timeline.tsx:238）新增可选 preview 字段；构造方 session-panel-page.tsx / turn-state.ts:137 upsertTurn / runtime-session-helpers.tsx:396 logsToTurns / session-panel-dialog 均按 TypeScript 结构类型缺省兼容，零调用点改动，在 task-01 allowed_paths（turn-timeline.tsx）内；NEW preview-merge.ts 为新导出无既有调用点。另：base 落后 origin/main 8 commit 经 git diff --stat 核验对 turn-timeline.tsx / session-panel-page.tsx 零 diff，无冲突面。
- task-02: 接口扩展（可选 prop）——TurnTimelineProps 加 expandPreview?、TurnRow props 加 per-row 基元；渲染消费方 3 处（session-panel-page.tsx:5119、session-panel-dialog.tsx、agent-replay-body.tsx）均不传新 prop 结构兼容零改动，在范围内（调用方改动本身属 task-03 的 session-panel-page.tsx）；ask-user-marker-card.test 等命中文件为类型/子组件 import 非渲染调用点。
- task-03: 无签名级变更——session-panel-page.tsx 新增模块内 handleExpandPreview 回调 + displayTurns useMemo 串联归并 + TurnTimeline 传 prop，不改任何既有函数签名/导出；enrichDisplayTurns 调用形态不变。
- task-04: 无签名级变更——仅新增/扩展测试文件（turn-preview-card.test.tsx），生产代码零改动。
