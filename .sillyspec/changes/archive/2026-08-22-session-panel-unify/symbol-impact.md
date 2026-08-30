# 符号影响面报告

> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`），主 agent 按 design v2.1 §4/§6 逐 task 填写（2026-08-22）。

- task-01: **删除导出符号 2 个**——`InteractiveSessionPanel`（组件）与 `InteractiveSessionPanelProps`（接口）随 interactive-session-panel.tsx 整文件删除；连带消失的 re-export 面：`SessionProcessItem / SessionToolEvent / SessionTurnView / SessionUiStatus / TurnUiStatus` 5 个类型不再经本文件转发（定义仍在 turn-timeline.tsx 且已导出，4 个消费方 import 路径改指 turn-timeline，符号本体零变化）。消费方调用点：runtime-session-dialog.tsx:338 / runtime-session-helpers.tsx:117 / workspace-session-section.tsx:253 / change-session-section.tsx:212，均在本任务 allowed_paths 内改为 `<SessionPanel mode="dialog" sessionId={attachSessionId ?? null} …>`。`SessionPanelProps` 接口本体**无签名级变更**（mode/sessionId 必填语义原样，viewMode/onViewModeChange 保留定义不接线）。key 重挂载契约（4 处 key= 用法）不动。
- task-02: 无签名级变更——session-panel.tsx dialog 分支 JSX 基元替换（UiButton×4→antd Button、UiBadge×1→antd Tag）+ 删除模块内局部 import 别名 `Badge as UiBadge` / `Button as UiButton`（:59-60，非导出符号）。组件导出面（SessionPanel/SessionPanelProps）零变化。
- task-03: 无签名级变更——`TurnStatusBadge`（turn-timeline.tsx:930，模块内部函数非导出）仅内部渲染实现替换为 antd Badge status（语义映射 running/interrupting→processing、completed→success、failed/killed→error、pending→default），函数签名/入参/返回结构零变化，调用点（turn-timeline.tsx:477 本文件内）零改动；3 个测试文件的断言适配不改任何被测符号签名。
- task-04: 无签名级变更——session-input-bar.tsx 内部按钮基元替换（发送 :196 shadcn Button→antd type=primary、📎 :169→antd type=text），组件 props 导出面（SessionInputBarProps）零变化；chips 原生 button（:140）不动。
- task-05: 无产品符号变更——3 套测试文件 git mv 改名（interactive-session-panel{,-offline,-changeid}.test.tsx → session-panel-dialog{,-offline,-changeid}.test.tsx）+ 测试内 import/render 入口替换（InteractiveSessionPanel→SessionPanel mode="dialog"），测试套 describe/it 语义名保持；workspace-session-section.test.tsx:28 模块 mock 路径改指 session-panel（mock 符号面不变）。
- task-06: 无签名级变更——3 个文件（ask-user-dialog-card.tsx:15 / lib/daemon.ts:586 / session-log-sanitize.ts:4,12,22）仅注释文本校正，零 import/类型/代码行改动。
- task-07: 无签名级变更——纯验证任务（vitest/tsc/lint/双主题冒烟/5 面冒烟/守护 grep），不改任何源码。
- task-08: 无签名级变更——仅文档（team-unify task-11.md 锚点更新），不涉任何代码符号。
