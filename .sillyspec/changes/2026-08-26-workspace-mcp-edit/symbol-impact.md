# 符号影响面报告

> tasks.md 内容指纹（生成时）: 3876b7a46f432269——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 新增符号（SkillsViewService.update_mcp_config 方法、router PUT 端点、McpServerEntryPut/McpConfigUpdateRequest pydantic 模型）——全部为新增非改签名；调用点=router 新端点调 service（同文件内闭合）；get_mcp_config 及既有 router 端点签名零变化。在任务范围内。
- task-02: 无签名级变更（纯新增测试文件 test_mcp_config_write.py，消费 task-01 新符号）。
- task-03: 签名级变更 1 处——get_daemon_mcp_config（daemon/router.py:4027）新增可选 query 参数 workspace_id: uuid.UUID | None = None（可选参数，既有调用零影响）；响应结构加可选 workspace 键（dict 直返，非 pydantic response_model 签名）。调用点=main.py 路由注册（自动装配无需改）+ test_mcp_config_endpoint.py（task allowed_paths 内）。在任务范围内。
- task-04: 无签名级变更（gen:types 生成产物 api-types.ts/openapi.json 整体再生成，非手改类型签名）。
- task-05: 新增符号（fetchMcpBundle 函数、McpBundle 接口导出）；既有 loadPlatformMcpConfigFromBackend/fetchPlatformMcpConfig/mergeMcpConfigs 签名零变化；消费方=task-07 cli.ts/daemon.ts（范围内）。在任务范围内。
- task-06: 核查型任务；若需补下发则为 build_claim_payload（lease/context.py）返回 dict 增键（返回结构加键非 Python 签名变更），消费方=daemon 侧 execPayload 解析（task-07 范围内消费）；无函数签名增删改。
- task-07: 无签名级变更——cli.ts mainAgentMcpConfigProvider 回调签名不变（D-007@v2 设计约束，仅闭包内部实现变更）；daemon.ts _startInteractiveSession 私有方法签名不变（内部加预取调用）；session-manager/driver 透传链零改动。
- task-08: 无签名级变更（纯测试）。
- task-09: 新增符号（updateWorkspaceMcpConfig fetch 函数 + useUpdateWorkspaceMcpConfig hook 导出）；既有 getWorkspaceMcpConfig/useWorkspaceMcpConfig 签名零变化；调用点=task-10 页面（范围内）。
- task-10: 模块内组件重构——page.tsx 默认导出组件 props（params.id）不变，FieldRow/formatValue 为模块内私有函数（无跨文件消费，grep 证实仅本文件使用）；既有 page.test.tsx 在 allowed_paths 内同步更新。
