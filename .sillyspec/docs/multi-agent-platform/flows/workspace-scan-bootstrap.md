---
author: qinyi
created_at: 2026-06-24T01:50:01
source_commit: ba87eec
---

# workspace-scan-bootstrap

## 目标
导入/创建工作区并扫描项目，生成 SillySpec 文档架构（bootstrap）。

## 参与模块
- **backend/workspace**：`POST /workspaces/scan`（本地结构扫描）、`POST /workspaces/scan-generate`（派发 scan AgentRun）
- **backend/spec_workspace**：`/spec-workspace*` 初始化/恢复 `.sillyspec` 配置、bundle 生成
- **backend/scan_docs**：文档树读取端点
- **backend/agent**：scan-generate 创建 AgentRun（按 placement 派发）
- **sillyhub-daemon**：daemon-client 分支下接收 scan 任务并执行
- **frontend**：工作区创建/导入 UI、扫描进度展示、文档树渲染

## 流程摘要
```text
[frontend] 导入项目（root_path）
      │
      ▼
[backend/workspace] POST /workspaces/scan
      │ WorkspaceService.scan(root_path) 返回目录结构
      ▼
[backend/workspace] POST /workspaces/scan-generate  ← 分两条 placement
      ├─ server-local: _require_server_local_workspace_admin → scan_generate
      └─ daemon-client: scan_generate_daemon_client (绑定 daemon_runtime_id)
      │ 返回 {workspace_id, agent_run_id}
      ▼
[backend/agent] AgentRun 启动（见 agent-run-flow）
      ├─[runtime SSE] 进度推送到前端
      └─[sillyhub-daemon / server] claude-agent-sdk 执行扫描，产出文档树
      ▼
[backend/spec_workspace] 初始化 .sillyspec 配置
[frontend] 展示生成的文档树
```

## 失败回滚
| 失败点 | 处理 |
|--------|------|
| root_path 不存在/无权限 | 404/403，前端提示检查路径 |
| server-local 非 admin | `_require_server_local_workspace_admin` 拒绝 |
| AgentRun 启动失败 | scan-generate 返回错误，允许重试 |
| daemon 未绑定 | daemon-client 分支要求 daemon_runtime_id（validator 保证） |

## 关键术语
- **ScanResponse / ScanGenerateResponse**：scan 与 scan-generate 响应体（含 agent_run_id）
- **placement**：scan 执行位置（server-local vs daemon-client）
- **spec_workspace bundle**：`.sillyspec` 初始化所需的配置包
