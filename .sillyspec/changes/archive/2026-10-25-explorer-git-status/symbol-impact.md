# 符号影响面报告

> tasks.md 内容指纹（生成时）: bc7cf4b9b29ba136——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 新增符号级方法 HostFsHandler.gitDirtyFiles/gitWorktreeDiff（纯新增，无既有签名改动）；daemon.ts 新增两平名 RPC handler 注册（纯新增）。既有五 git 方法（gitLog/gitRefs/gitShow/gitDiffFile/gitStatus）签名与行为零改动。受影响调用点：仅新增（backend task-02 未来消费），在任务范围内。
- task-02: 新增 DTO GitDirtyFilesResponse/GitDirtyFileItem/GitIgnoredItem/GitWorktreeDiffResponse（schema.py 纯新增）；GitLogService 新增方法 get_dirty_files/get_worktree_diff（纯新增方法签名）；router.py 新增两 GET 端点函数（纯新增）。既有四端点、_resolve_binding/_probe_git_mode/_send_git_rpc/_map_remote_error 签名零改动（仅被新方法调用）。无既有签名级变更。
- task-03: 无签名级变更——纯生成产物再生成（backend/openapi.json + frontend/src/lib/api-types.ts + sillyhub-daemon/src/api-types.ts 三份产物文件级替换，无手写符号改动）。
- task-04: frontend/src/lib/git-log.ts 纯追加导出 fetchDirtyFiles/fetchWorktreeDiff/gitLogQueryKeys.dirtyFiles/.worktreeDiff/useGitLogDirtyFiles/useGitLogWorktreeDiff（既有 fetch/queryKey/hook 签名零改动）；file-tree.tsx 仅将私有 buildFileTree 加 export 关键字（签名不变，可见性扩展）；新组件 WorktreeChangesCard（新文件）。受影响调用点：file-tree.tsx 内部自用不受影响，在任务范围内。
- task-05: file-tree.tsx 仅将私有 DiffBody 加 export（签名不变，可见性扩展）；新组件 WorktreeDiffModal（新文件，复用已导出 parseUnifiedDiff 与 DiffBody）。无既有签名级变更。
- task-06: git-log/page.tsx 仅新增挂载与弹窗 state（WorktreeChangesCard/WorktreeDiffModal 接线），既有取数/过滤/分页函数签名零改动。无签名级变更。
- task-07: file-explorer.tsx 渲染层改动——renderTitle 由模块级纯函数固化为组件内订阅状态映射（或 treeData useMemo 依赖重建），title 属性对外契约不变；onSelect 点击行为零改动（D-005）；explorer 四端点与 lib/explorer.ts 取数零改动（D-008）。受影响调用点：仅 file-explorer.tsx 内部渲染路径，在任务范围内。
