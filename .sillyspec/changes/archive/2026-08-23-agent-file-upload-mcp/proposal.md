---
author: qinyi
created_at: 2026-08-23 09:23:30
change: 2026-08-23-agent-file-upload-mcp
---

# 提案书（Proposal）

## 动机

会话/批任务中 agent 生成的文件（报告、图表、数据导出）只留在 daemon 所在机器的本地目录，用户在平台上看不到也拿不到。需要一条 agent→用户的文件通道：agent 调 MCP 工具主动上传，用户在聊天流/run 详情页查看与下载。

## 关键问题

1. **正向文件流缺失**：聊天流段类型只有 text/thinking/tool/subagent_stub/stderr，无文件段；agent 产物无任何下载入口（用户→agent 的附件方向已有 session_attachment，正向缺口）。
2. **worker 无 MCP 链路**：daemon 内置 MCP server 仅注入交互会话主 agent；mission worker 刻意排除（CC-12 防递归），task-runner 完全没有 MCP 注入管道——直接复用会撞既有决策。
3. **文件中心能力未被复用**：已有 MinIO 存储 + File 表多态归属 + 前端组件，仅服务 PPM 附件；新建一套存储既浪费又分裂。

## 变更范围

- daemon：mcp-server.ts 增 MCP_TOOLSET 双模式，新增 sillyhub-file server（upload_file/list_uploaded_files）；会话与 worker 两条注入链路（worker 走 tmpdir 临时 .mcp.json + --mcp-config，仅 claude 引擎）。
- backend：新增 /api/agent/file-artifacts 端点（multipart 上传 + 列表，写 AgentRunLog 日志行 + Redis publish 实时扇出）；File 表加 description 列；_can_access 扩 agent_session/agent_run 归属；execution.py worker 白名单放行。
- frontend：聊天流新增 file 段渲染文件卡片（图片缩略图）；run 详情页新增产出文件区。

## 不在范围内（显式清单）

- 不做 delete 工具（删除走文件中心既有软删，用户操作）
- 不做 codex 引擎注入（codex 不消费 mcpServers，维持现状）
- 不在公共 MCP server（mcp_gateway）加文件工具
- 不做超大文件流式/分片上传（沿用现有上限全量校验）
- 不改文件中心既有页面/接口行为，不做会话文件聚合列表页
- 不做 run 结束自动收集目录

## 成功标准（可验证）

- 交互会话中主 agent 调 upload_file 上传 cwd 内文件后，聊天流实时（SSE）出现文件卡片，图片内联缩略图，可下载；刷新后卡片仍在原位
- mission worker（claude 引擎）上传产物后，run 详情页「产出文件」区列出文件，日志流出现 FILE 记录行
- 路径逃逸（cwd 外路径/绝对路径/..）被拒绝并返回结构化错误；超限文件 413
- 能访问会话/run 所属 workspace 的成员（WORKSPACE_READ）可下载；无权用户 404
- 未注入场景（codex/cursor、未升级 daemon、MCP_TOOLSET 缺省）行为零变化；既有测试零回归
- pytest / vitest 新增测试全过；gen:types 三端同步提交
