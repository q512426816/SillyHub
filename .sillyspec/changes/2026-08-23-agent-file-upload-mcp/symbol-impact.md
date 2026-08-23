---
author: qinyi
created_at: 2026-08-23 10:02:15
change: 2026-08-23-agent-file-upload-mcp
---

# 符号影响面报告（Symbol Impact）— Agent 文件上传 MCP

> execute 前缀步硬门产物。逐 task 列签名级变更（构造参数/接口/DTO/方法签名增删改）+ 受影响调用点 + 是否在任务范围；无签名级变更的显式写明。

| task | 签名级变更 | 受影响调用点 | 是否在范围内 |
|---|---|---|---|
| task-01 | `FileService.upload_file` 增 keyword-only 可选参数 `description: str \| None = None`（向后兼容）；`File` ORM 加 `description` 列（模型级，配 alembic 迁移）；`FileUploadResp` 加 description 字段、`FileMetaResp` 加 description+created_at 字段（响应 DTO 扩展，from_attributes 映射，加字段零破坏） | upload_file 既有调用点：file/router.py `upload_file` handler（同步透传 description，同 task 改）；FileUploadResp 构造处（service.py 内部，同 task） | 是（file 三件套+迁移+router 均在 allowed_paths） |
| task-02 | 无签名级变更（`_can_access` 为内部方法，参数 user/row 不变；仅增分支行为） | 无（调用点 get_meta/get_stream/batch_meta 均在本模块内，行为扩展非签名变更） | — |
| task-03 | 无既有签名级变更（新 router 文件纯新增 API 面；agent/router.py 仅追加 include） | 无既有调用点受影响 | — |
| task-04 | 无签名级变更（`worker_tool_config` 签名与返回结构不变，仅 allowed_tools 列表值追加 `mcp__sillyhub-file`） | 值消费方：dispatch/lease payload 组装与 daemon 侧 tool_config 解析（零感知透传，本变更目的） | 是（值变更即目的，消费方无需改） |
| task-05 | `readEnv()` 返回结构扩展（+toolset/runId/allowedRoot 三字段，McpServerEnv 接口扩展，消费点 runMcpServer 内部）；新增导出 `FILE_MCP_SERVER_NAME`；hub-client 新增方法 `uploadFileArtifact`/`listFileArtifacts`（纯新增）；mcp-config 新增导出 `buildFileMcpServerConfig`（纯新增） | readEnv 消费点：mcp-server.ts 内部 runMcpServer + 既有单测断言（同 task 补）；新导出无既有消费方 | 是（三源文件均在 allowed_paths） |
| task-06 | 无签名级变更：`mainAgentMcpConfigProvider` 签名不变仅返回表新增 sillyhub-file 条目；per-server env 注入经**调用两次** `injectMcpSessionId(config, sessionId, serverName)`（该函数已带 serverName 可选参）实现双条目，不改 mcp-config.ts 签名 | cli.ts provider 内部；session-manager `_resolveMainAgentMcp` 注入处（同 task）；既有「其它 server 不注入」断言测试（related_tests 已列） | 是（若实现中发现必须改 injectMcpSessionId 签名则停下反馈，mcp-config.ts 归 task-05） |
| task-07 | `stream-json.ts buildArgs` opts 接口增可选字段 `mcpConfigPath?: string`（可选字段零破坏，cursor 分支忽略） | buildArgs 调用点：task-runner.ts:716（同 task 传新参）；既有 buildArgs 测试（tests/stream-json.test.ts 同 task 增用例） | 是 |
| task-08 | `TurnSegment` 联合类型新增 `{ kind:'file' }` 成员（类型扩展零破坏）；`classifySessionLog` 增可选参数 toolKind（签名扩展，默认值保旧调用兼容）；新增导出组件 `FileMessageCard` | classifySessionLog 调用点：assembler 内部 :609/:906 两处（同 task）；turn-segment-views 渲染接线（同 task）；assembler 既有测试（同 task 增用例） | 是 |
| task-09 | 无既有签名级变更（新组件 run-file-artifacts + lib/agent.ts 新增函数 listAgentFileArtifacts，纯新增） | 无既有调用点受影响 | — |
| task-10 | 无签名级变更（api-types.ts/openapi.json 为生成物刷新；下游消费零手改） | gen:types:check 漂移门禁（本 task 验证项） | — |

## 汇总

签名级变更集中在 4 个 task：task-01（service 参数+DTO 字段+ORM 列，全部向后兼容）、task-05（readEnv 返回扩展+纯新增导出/方法）、task-07（buildArgs opts 可选字段）、task-08（classifySessionLog 可选参数+TurnSegment 新成员）。全部变更均为**加法且带缺省值**，既有调用点零破坏；受影响调用点均在各自 task allowed_paths 内，无跨 task 未覆盖调用点。
