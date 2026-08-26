# 符号影响面报告

> 逐 task 符号级变更结论（骨架由 CLI 代生成，主代理填写）。

- task-01: 新增符号（SkillsViewService.create_skill/delete_skill/read_file/write_file/delete_file + 安全 helper + pydantic SkillCreateRequest/SkillFileWriteRequest + AppError 子类族）——全部新增非改签名；既有 list_skills/get_mcp_config/update_mcp_config 零改动；调用点=task-02 router（闭合）。
- task-02: 新增 5 端点函数（router 装配）——既有端点（含 GET skills :366 与 MCP PUT）零改动；调用点=main.py 路由注册自动装配。
- task-03: 无签名级变更（纯测试）。
- task-04: 无签名级变更（gen:types 生成产物整体再生成）。
- task-05: 新增符号（5 fetch + 5 hooks 导出）+ queryKeys 追加 workspaceSkillFile 键——既有 getWorkspaceSkills/useWorkspaceSkills/workspaceSkillsView 键零改动；调用点=task-06 页面（闭合）。
- task-06: 模块内重构——skills page.tsx 默认导出 props（params.id）不变；既有 useWorkspaceSkills 消费不变（页面内部扩展）；page.test.tsx 同步更新（allowed_paths 内）。
