# 符号影响面报告

> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

扫描基线：worktree 58d7ac46（baseline checkpoint for 2026-08-21-session-message-queue）。
核心事实（rg 全量扫描 `frontend/src`）：
- `frontend/src/hooks/` 目录不存在，task-01 将新建（无既有文件冲突）。
- `sessions/page.tsx:203-224` 的 `SessionPanelProps` / `SessionPanel` 是**页内局部声明、未导出**，
  `rg "from.*sessions/page"` 零命中——提取到共享组件不产生既有调用点破坏。
- `InteractiveSessionPanel`（`interactive-session-panel.tsx`）的**全部渲染调用点**：
  1. `runtime-session-dialog.tsx:338`（/runtimes 页经 `runtimes/page.tsx:1097 → RuntimeSessionDialog` 间接使用）
  2. `workspace-session-section.tsx:253`（工作区会话页）
  3. `change-session-section.tsx:212`（变更详情会话区）
  4. `runtime-session-helpers.tsx:117`（`InteractiveSessionChatSection` 包装，页面级已无活跃引用，仅注释提及）
  - 类型导出 `SessionTurnView` 被 `runtime-session-helpers.tsx:10` import。
  - 专属测试 3 套（`__tests__/interactive-session-panel{,-changeid,-offline}.test.tsx`） +
  `workspace-session-section.test.tsx` / `runtime-session-dialog.test.tsx` 的 vi.mock。
- /runtimes 页**不直接 import** interactive-session-panel，经 RuntimeSessionDialog 间接渲染。

逐 task 结论：

- task-01: 无签名级变更。纯新增 `frontend/src/hooks/use-message-queue.ts`（新文件、新目录，无既有符号消费方）。
- task-02: 无签名级变更。纯新增 `frontend/src/components/daemon/message-queue-bar.tsx`。
- task-03: 无签名级变更。`sessions/page.tsx` 是 Next 页面（default export 路由入口，无外部符号导入）；
  页内集成 useMessageQueue + MessageQueueBar 属实现内改动，不改任何导出签名。
- task-04: 无签名级变更。只读分析 + 写 `diff-analysis.md` 文档。
- task-05: 新增导出、无既有签名变更。把 `sessions/page.tsx` 页内局部 `SessionPanel`（未导出，
  零外部调用点）提取为 `components/daemon/session-panel.tsx` 并导出；`sessions/page.tsx` 改为 import
  （两文件均在 allowed_paths 内）。新组件只消费既有共享件（session-log-assembler / turn-timeline /
  session-input-bar / lib），不改它们的签名。
- task-06: 无签名级变更。`sessions/page.tsx` 页内替换为 `<SessionPanel>`，无导出签名改动。
- task-07: **对外签名零变更（含一处受控范围偏差）**。发现：design 文件清单的「删除
  interactive-session-panel.tsx」在本变更内不可行——剩余消费方 `workspace-session-section.tsx` /
  `change-session-section.tsx` / `runtime-session-dialog.tsx` / `runtime-session-helpers.tsx` 及其测试
  均不在任何 task 的 allowed_paths 内，强删即超范围破坏调用点。执行路线取 design.md D-005 统一策略
  第 3 步原文「保留原有 useAttach/useQuery 在弹窗父组件中，只替换面板内部渲染」：
  `interactive-session-panel.tsx` 内部实现替换为渲染共享 `SessionPanel mode="dialog"` 的适配层，
  **保持既有导出签名（InteractiveSessionPanel 组件 props + SessionTurnView 类型）不变**，
  4 个调用点与全部测试零改动、零破坏；文件保留不删（design「删除」行降级为后续独立变更收尾，
  偏差在本行与 task review 备案，verify 阶段复核）。`runtimes/page.tsx` 若经弹窗链已渲染新面板
  则无需改动（allowed_paths 是许可非义务）。
- task-08: 无签名级变更。纯新增测试文件 `hooks/__tests__/use-message-queue.test.ts`。
- task-09: 无签名级变更。纯新增测试文件 `components/daemon/__tests__/message-queue-bar.test.tsx`。
- task-10: 无签名级变更。运行全量 vitest 回归；如需修复本变更引入的失败，落点在对应 task 的
  allowed_paths 文件内，不触碰清单外调用点。
- task-11: 无签名级变更。lint + tsc 修复，同样限定在本变更涉及文件。

结论：除 task-07 的「删除降级为适配层保留」偏差（已按 design D-005 策略第 3 步原文闭环、
不触碰任何 allowed_paths 外文件）外，全部 task 无签名级变更、无范围外调用点。可以进入 Wave 执行。
