# 符号影响面报告

> 主 agent 按 design v2 逐 task 填写（2026-08-22，worktree 模式）。

- task-01: **新增导出符号**——`SessionsPortal`（组件）+ `SessionsPortalProps`（接口，scope 可选判别联合）+ `WorkspaceScope`/`ChangeScope` 类型（若从 list-panel 导出则此处消费）。自 sessions/page.tsx 提取逻辑无签名级变更（页面默认导出结构不变）。
- task-02: 无签名级变更——两 page.tsx 改渲染门户（默认导出组件保留）；`?session=` 解析移入门户后页面无符号残留。
- task-03: **新增路由模块**——`app/(dashboard)/workspaces/[id]/changes/[cid]/sessions/page.tsx` 默认导出组件（新文件新符号，无既有符号变更）。
- task-04: **SessionListPanelProps 扩展**——新增可选 `scope?: WorkspaceScope | ChangeScope`（向后兼容，缺省零变化）；导出 WorkspaceScope/ChangeScope 类型（供门户消费）；组件内部 queryFn/过滤派生变化无签名影响。
- task-05: **NewSessionFormProps 扩展**——新增可选 `bindWorkspaceId?: string` 与 `bindChangeId?: string`（向后兼容）；导出面其余零变化。
- task-06: **ChangeSessionsCardProps 不变**——卡片内部形态改入口（内部符号面变化：新增预览子渲染，无导出签名变更）。
- task-07: **删除导出符号 2 组**——`WorkspaceSessionSection`（组件，workspace-session-section.tsx 整文件删）与 `ChangeSessionSection`（组件，change-session-section.tsx 整文件删）；grep 实测各仅 1 消费方且均在 task-02/06 改造后不再引用；两测试文件随删（测试符号非产品符号）。
- task-08: 无产品符号变更——纯测试新增/适配（sessions-portal.test 新建 + 三文件适配）。
- task-09: 无签名级变更——验证与部署任务（allowed_paths 为被验证入口非改动授权）。
