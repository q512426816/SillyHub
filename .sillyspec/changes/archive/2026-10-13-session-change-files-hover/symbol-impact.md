# 符号影响面报告

> tasks.md 内容指纹（生成时）: 3960304deda0cd0a——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 后端新增符号，无既有签名级变更——service.py 新增 `ChangeService.list_changes_for_session(workspace_id, session_id)` 方法（新方法无既有调用点）；router.py 新增端点函数 + `_SESSION_CHANGES_MAX = 100` 模块常量（均为新增，零既有符号改动）。
- task-02: 前端组件 Props 接口扩展（可选参数，向后兼容）——Props 接口（frontend/src/components/change-file-tree.tsx:43）新增可选字段 `autoRefreshMs?: number`；受影响调用点：frontend/src/components/changes/detail/change-files-card.tsx:36（不传新 prop 行为不变，无需改动）、移动端消费方（同上零改动）——均在兼容范围内，无强制改动。
- task-03: 无签名级变更——frontend/src/lib/changes.ts 新增独立导出 `listSessionChanges` 函数与 `useSessionChanges` hook（新符号无既有调用点）；frontend/src/lib/query-keys.ts 新增键工厂 `sessionChanges`（新符号）；api-types.ts/openapi.json 为生成产物追加（不改既有类型）。
- task-04: 无签名级变更——新建组件文件（NEW frontend/src/components/daemon/session-change-files-hover.tsx，全新符号导出 SessionChangeFilesHover + splitByArchive 纯函数），不触碰任何既有符号。
- task-05: 无签名级变更——frontend/src/components/daemon/session-panel/session-panel-page.tsx 仅新增一处 JSX 挂载（消费 task-04 新组件），不改任何既有函数签名/Props。
