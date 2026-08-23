---
author: qinyi
created_at: 2026-08-23 09:50:30
---

# 模块影响分析（Module Impact）— Agent 文件上传 MCP

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend/modules-file | 修改（中） | model.py 加 description 列 + alembic 迁移；schema.py FileUploadResp/FileMetaResp 扩 description（FileMetaResp 另补 created_at）；service.py upload_file 增参 + _can_access 扩 agent_session/agent_run 两归属分支（解析链 + NULL deny）；新增/更新测试（test_file_api.py 观察、test_file_agent_owner.py 新建） |
| backend/modules-agent | 修改（中） | 新增 file_artifacts.py（POST/GET /api/agent/file-artifacts、AgentRunLog 日志行、Redis publish）；router.py:905 并列挂载；execution.py worker_tool_config 白名单两分支追加 mcp__sillyhub-file；新增 test_file_artifacts.py / test_worker_tool_config.py |
| sillyhub-daemon（mcp 层） | 修改（中） | mcp-server.ts MCP_TOOLSET 双模式 + sillyhub-file 2 工具（路径校验）；hub-client.ts multipart 方法；mcp-config.ts buildFileMcpServerConfig；cli.ts mainAgentMcpConfigProvider 并入；session-manager.ts per-server env 扩展；task-runner.ts worker 注入（tmpdir 0600 tmpfile）；adapters/stream-json.ts buildArgs mcpConfigPath；测试放 tests/（3 个新文件 + 2 个既有文件改动） |
| frontend/components-daemon | 修改（中） | session-log-assembler.ts 新 file 段类型（classifySessionLog 入口重构传 toolKind）；新增 file-message-card.tsx；turn-segment-views.tsx 渲染接线 |
| frontend/app-changes-pages + lib | 修改（轻） | changes/[cid]/tasks/[tid]/page.tsx 智能体运行详情区新增「产出文件」区 + run-file-artifacts 组件；lib/agent.ts 新增 listAgentFileArtifacts；api-types.ts 随 gen:types 生成更新 |
| backend/openapi.json | 生成（轻） | gen:types 产物（新端点 schema） |
| deploy/ci | 无影响 | 部署与 CI 配置零变更（daemon 同二进制双模式，无新进程/端口） |

## 未匹配文件

无（design §6 全部 28 个路径落入上述模块或为生成产物）。

## 更新结果（verify/收尾阶段回填）

| 目标 | 操作 | 状态 |
|------|------|------|
| docs/backend/modules（file 模块文档） | 待更新：description 列/DTO 字段/_can_access 新分支 | pending |
| docs/backend/modules（agent 模块文档） | 待更新：file_artifacts 端点/worker 白名单 | pending |
| docs/sillyhub-daemon 模块文档 | 待更新：MCP_TOOLSET 双模式/两条注入链/tmpfile 卫生 | pending |
| docs/frontend/modules（components-daemon） | 待更新：file 段与 FileMessageCard | pending |
| 各 _module-map.yaml | 预计无变化（未增删模块，新文件归既有模块） | pending |
