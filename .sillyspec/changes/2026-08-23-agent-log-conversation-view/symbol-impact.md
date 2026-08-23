# 符号影响面报告

> tasks.md 内容指纹（生成时）: e289466b3d066f77——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。

- task-01: 无签名级变更——纯新增模块（src/agent-log/parse-zcode-model-io.ts 导出 parseZcodeModelIo 纯函数 + NormalizedLogMessage 类型），不触碰任何既有符号；调用点仅 task-02 新代码。
- task-02: 新增符号 HostFsHandler.readAgentLogMessages（第 10 方法，类内新增不改既有方法签名）+ daemon.ts _registerHostFsRpcHandler 内追加一条 ws.registerRpcHandler('host_fs.read_agent_log_messages') 注册（新增 case 不改既有九方法注册）。既有 readFile/assertWithinAllowedRoots/toRpcError 只读复用，签名零改动。受影响调用点：无既有调用点（backend task-03 是首个消费者）。
- task-03: 无签名级变更——router.py 新增 GET /agent-logs/{entry_id}/messages 端点函数 + schema.py 新增两个 Pydantic 模型（AgentLogMessagesResponse/AgentLogMessageItem）。**重构点**：从 read_agent_log_content 抽共享 helper（scope 校验/daemon 定位/错误映射），read_agent_log_content 函数签名不变、HTTP 行为零改动（既有测试 test_agent_log_content.py 作行为保持断言）。send_host_fs_rpc/_resolve_daemon_id_for_runtime/resolve_daemon_instance_for_workspace 只读复用。
- task-04: 无签名级变更——api-types.ts 为生成物（openapi-typescript 再生成，新增 schema 条目不改既有类型）；agent-logs.ts 新增导出 readAgentLogMessages 与 type AgentLogMessagesResponse（纯新增，readAgentLogContent/listAgentLogs 签名零改动）。
- task-05: agent-log-card.tsx 内部组件 AgentLogEntry 的「查看内容」分支重写（组件 props 接口不变——沿用既有 AgentLogEntry 入参）；新增内部子组件/映射函数为文件内私有符号。消费的 ToolCallPreview/ToolResultCard/CollapsibleSection/MarkdownText/ToolCallEntry 均只读复用（agent-log-viewer.tsx / tool-renderers.tsx / types.ts 签名零改动）。
- task-06: 无签名级变更——纯测试运行与实证留档（runtime-evidence.md 产物），不改任何源码符号。
