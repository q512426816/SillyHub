---
author: qinyi
created_at: 2026-08-25 21:52:10
change: 2026-08-25-workspace-git-log
---
# 符号影响面报告

> tasks.md 内容指纹（生成时）: c2e8c771a6d7f162——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更。host-fs-handler.ts 为纯新增四方法（git_log/git_refs/git_show/git_diff_file），不改 HostFsHandler 类构造与既有十方法签名；daemon.ts 仅追加四行平名 registerRpcHandler 注册（explorer 系同形态）。受影响调用点：无既有调用点（新方法零调用方，消费方 task-04 为新代码）。在任务范围内。
- task-02: 无签名级变更。backend/app/modules/git_log/ 全新模块（router/service/schema/__init__ 新文件，无既有符号）；main.py 仅追加一行 include_router（纯增量，不改 app 构造与其余挂载）；.sillyspec/local.yaml modules 块追加 git_log 条目（配置新增，无既有键改动）。在任务范围内。
- task-03: 无签名级变更。graph_layout.py 新文件纯函数 compute_lanes，零既有代码调用点。在任务范围内。
- task-04: 无签名级变更。完善 task-02 骨架内自有方法体（list_commits/get_detail/get_diff 签名在 task-02 已定，本 task 只填充实现）；router/schema 微调仅限本模块新文件。消费的 MemberBindingResolver.resolve_member_binding_or_none、resolve_root_path_for_daemon、probe_workspace_git_mode、ws_hub.send_rpc 均只读调用不改其签名。在任务范围内。
- task-05: DTO 变更（新增，无破坏）。api-types.ts 由 openapi-typescript 再生成——新增 GitLogCommitsResponse/GitLogCommitDetailResponse/GitLogDiffResponse 三 schema 与对应路径类型，既有类型零改动（后端既有模块 schema 未动，gen:types:check 守门）。openapi.json 同步再生成。调用点：新 lib/git-log.ts（新文件）。在任务范围内。注意：worktree 内跑 dump_openapi.py 会加载主仓 app.main（editable install 坑，backend.md 注意事项登记）——须 PYTHONPATH 指向 worktree/backend 或主仓合并后跑。
- task-06: 无签名级变更。workspace-tabs.tsx 的 TABS 数组追加一个对象字面量（key/label/path 三字段，不改 WorkspaceTab 类型定义与既有 14 项）；其余全为新文件（page/四组件/测试）。受影响调用点：WorkspaceTabs 渲染组件按数组 map 渲染，新增项自动出现，无签名耦合；既有 tab 相对顺序断言（explorer-page.test 等）不受影响（git-log 追加在末尾不改相对顺序）。在任务范围内。
- task-07: 无签名级变更（验收任务，不改任何源码；仅产出 verify-evidence-theme.md 留证文档）。在任务范围内。
