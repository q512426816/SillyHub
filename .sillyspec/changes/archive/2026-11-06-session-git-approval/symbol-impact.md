# 符号影响面报告

> tasks.md 内容指纹（生成时）: 4169f72ae87037de——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。

- task-01: 无签名级变更——纯新增模块 git-command-guard.ts（新导出 GitCommandIntent/detectGitWriteIntent/resolveDefaultSelection），不触碰既有签名。
- task-02: 无签名级变更——纯新增模块 git-approval-collector.ts（新导出 collectGitApprovalPayload 与 porcelain/numstat 解析器），不触碰既有签名。
- task-03: 函数内新增分支——buildCanUseToolCallback（sillyhub-daemon/src/interactive/session-manager/permission.ts:352）函数体内、askUserOnly 判断（:457）之前插入 git 拦截分支；不改函数签名、不改既有 AskUserQuestion/ExitPlanMode/普通审批分支的行为签名。
- task-04: 函数内新增接线——driver-factory.ts 仅写校验分支（:370-381）为 _buildWriteOnlyCanUseToolCallback 补 git 审批路径（PermissionResolver 构造 + git 分支注入）；不改 buildInteractiveDriver 等既有函数签名。
- task-05: 无签名级变更——纯新增模块 git-executor.ts（新导出 executeGitApproval/GitExecResult）。
- task-06: 分发扩展——permission.ts 响应处理处对 dialog_kind='git_approval' 的 allow/deny 臂接管为 executor 调用/拒绝回喂（函数内分支级变更，无签名改动）。
- task-07: 无签名级变更——纯新增测试文件 git-command-guard.test.ts。
- task-08: 无签名级变更——纯新增测试文件 git-executor.test.ts（git-executor.ts 仅限缺陷修复级触碰）。
- task-09: 新增符号——backend/app/modules/daemon/session/service/git_diff.py 新导出 get_session_git_diff；session_crud.py 新增一个只读路由处理函数；无既有签名改动。
- task-10: 无签名级变更——生成物（api-types.ts ×2 + openapi.json）重生成，新增 schema 条目为增量追加。
- task-11: 无签名级变更——纯新增组件 git-approval-card.tsx（props-only 新导出）。
- task-12: 组件内分流扩展——pending-dialog-dock.tsx 渲染 map（:137-152）按 dialog_kind 分流渲染 GitApprovalCard；panel 双文件预期仅注释同步（batch3 核实 onPermissionRequest 对带 kind 请求无差别放行）；无 props 签名改动。
- task-13: 无签名级变更——纯新增测试文件 git-approval-card.test.tsx。
- task-14: 无签名级变更——只读联调验证（产物为变更目录内记录文件）。
- task-15: 无签名级变更——存量测试回归 + 原型两件提交（prototype-build.mjs VIEWS 数组已在 brainstorm 阶段登记，无再改签名）。
