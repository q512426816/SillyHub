---
author: qinyi
created_at: 2026-08-23 09:23:30
change: 2026-08-23-agent-file-upload-mcp
---

# 任务清单（Tasks）

> 骨架清单，plan 阶段展开细节并写回本文件。Wave/依赖/覆盖矩阵见 plan.md。

- [x] task-01: backend file 模块扩展——File 加 description 列 + FileUploadResp/FileMetaResp 扩字段（含 created_at）+ upload_file 增参 + alembic 迁移 (depends_on: —) [W1]
- [x] task-04: backend execution.py worker_tool_config 白名单模式追加 mcp__sillyhub-file + 测试 (depends_on: —) [W1]
- [x] task-02: backend file/service._can_access 扩 agent_session/agent_run 归属（D-004@v2 解析链 + NULL deny）+ 单测 (depends_on: task-01) [W2]
- [x] task-03: backend agent/file_artifacts.py 端点（POST multipart + GET 列表、双路径鉴权、AgentRunLog 行 + IntegrityError 重放防护、Redis publish 复用 submit_run_input 模式）+ agent/router.py 挂载 + 端点测试 (depends_on: task-01, task-02) [W3]
- [x] task-05: daemon mcp-server.ts MCP_TOOLSET 双模式 + upload_file/list_uploaded_files（路径校验）+ hub-client multipart 方法 + mcp-config buildFileMcpServerConfig + 单测（测试放 sillyhub-daemon/tests/） (depends_on: task-03) [W4]
- [x] task-08: frontend 聊天流 file 段——assembler 新段类型（classifySessionLog 传入 toolKind）+ file-message-card 组件 + 段视图渲染 + 测试 (depends_on: task-03) [W4]
- [x] task-09: frontend run 详情页「产出文件」区（GET /api/agent/file-artifacts?run_id=）+ 组件测试 (depends_on: task-03) [W4]
- [x] task-06: daemon 会话注入——cli.ts mainAgentMcpConfigProvider 并入 sillyhub-file + session-manager per-server env 扩展 + 单测（测试放 sillyhub-daemon/tests/） (depends_on: task-05) [W5]
- [x] task-07: daemon worker 注入——task-runner tmpdir 0600 临时 .mcp.json + stream-json buildArgs mcpConfigPath（仅 claude）+ spike-01（--mcp-config 共存 + ${VAR} 展开）+ 单测（测试放 sillyhub-daemon/tests/） (depends_on: task-04, task-05) [W5]
- [x] task-10: gen:types 三端同步 + 全量回归（pytest/vitest/lint）+ l10n 校验 (depends_on: task-01,02,03,04,05,06,07,08,09) [W6]
