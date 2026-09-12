# 符号影响面报告

> tasks.md 内容指纹（生成时）: 2e979aeff0ab8214——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: **签名级变更：有（可选参追加，零破坏）**。`readSessionDraft(sessionId)` / `writeSessionDraft(sessionId, draft)` / `sessionDraftLsKey(sessionId)`（turn-state.ts:306-328）各追加可选第三参 `preScope?: string | null`。受影响调用点全仓 4 处：session-panel-page.tsx:411/421（本任务改传 scope）、session-panel-dialog.tsx:271/279（本任务改传 scope）——全部在任务 allowed_paths 范围内；无其他调用方（grep 全仓核验）。
- task-02: **无签名级变更**。`handleHeightDragStart`（session-input-bar.tsx:503 / group-chat-panel.tsx:1688）参数类型 `React.MouseEvent` → `React.PointerEvent`（组件内部私有函数，无外部调用方）；JSX 事件绑定 onMouseDown→onPointerDown 同文件内完成。双击/钳制/持久化符号（`handleHeightReset`/`INPUT_HEIGHT_*`/`INPUT_HEIGHT_LS_KEY`）不动。
- task-03: **签名级变更：有（新增符号 + DTO 字段，纯增量）**。新增 `get_project_workspace_map(session, project_ids)`（crud.py，异步 helper，无既有调用方）；`GroupChatListItemRead`（router.py:62）追加字段 `visible_workspace_ids: list[uuid.UUID] = []`（带默认值，Pydantic 纯增量——既有构造点 `_to_list_item` 的 model_validate 不受影响，新字段缺省空）。受影响调用点：无破坏面（响应消费方 task-04 经 gen:types 拿新字段）。
- task-04: **无签名级变更**。`api-types.ts` 为 gen:types 生成物（GroupChatListItemRead 加可选字段 visible_workspace_ids?: string[]）；两处过滤 useMemo 内部逻辑替换（session-list-panel.tsx:964-970 / mobile-session-list.tsx:250-256），不改函数签名。
- task-05: **无签名级变更**（纯验证收口，无源码改动——allowed_paths 为被验证入口，只在测试失败时回溯上游任务修）。
