---
author: qinyi
created_at: 2026-08-26 23:36:20
change: 2026-08-26-workspace-git-status
---
# 符号影响面报告

> tasks.md 内容指纹（生成时）: 2d411d6811d1050e——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更。host-fs-handler.ts 纯新增 gitStatus 方法（不改 HostFsHandler 类构造与既有 17 方法签名）；daemon.ts 追加一行平名注册（对齐既有四 git 方法注册形态）。受影响调用点：无既有调用点（新方法零调用方，消费方 task-02 为新代码）。在任务范围内。
- task-02: 无签名级变更。git_log 模块四文件均为增量：router.py +1 端点函数、service.py +get_status 方法（复用 _resolve_binding/_fetch_workspace/_probe_git_mode/_send_git_rpc 四私有方法只读调用不改签名）、schema.py +新响应模型、test_router.py 追加用例。既有三端点与四私有方法零改动。在任务范围内。
- task-03: DTO 变更（新增，无破坏）。api-types.ts 由 openapi-typescript 再生成——新增 GitLogStatusResponse 族 schema 与 status 路径类型，既有类型零改动（gen:types:check 守门；openapi.json 由 verify 单独 git diff 核验，Plan Review I-4）。lib/git-log.ts 追加导出（fetchGitLogStatus/useGitLogStatus，不改既有 hooks 签名）。sessions-portal.tsx 在 PageHeader actions 槽条件渲染新组件（不改组件既有 props/逻辑，仅 workspace scope 分支）；git-log page.tsx 增状态条节点。两处既有测试文件 mock 层补 status fixture（Plan Review I-1，不改断言）。在任务范围内。
