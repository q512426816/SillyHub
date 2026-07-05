---
author: qinyi
created_at: 2026-07-02 10:46:07
change: 2026-07-02-change-detail-file-tree-editor
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| 业务用户 | 在变更详情页浏览变更目录文件、手动编辑文档并保存 |
| daemon（系统） | daemon-client 工作区下，轮询 outbox 队列、写回本机、回执 |
| 后端 | 文件树读写端点、path_source 分流、outbox 入队、per-change resync |

## 功能需求

### FR-01: 变更中心移除生命周期流程图
覆盖决策：—
Given 变更中心列表页
When 用户打开 `/workspaces/{id}/changes`
Then 不再渲染「变更生命周期」SectionCard（扫描→…→归档）；列表/分页/搜索/新建/重新扫描均正常

### FR-02: 变更详情移除文档完整性面板 + DOC_TABS 查看器
覆盖决策：D-008@v1
Given 变更详情页
When 用户打开 `/workspaces/{id}/changes/{cid}`
Then 不再渲染「变更文档完整性」section（828-914）与 DOC_TABS 只读查看器（916-993）；关联前端死代码（DOC_TABS/DOC_LABELS/REQUIRED_DOCS/OPTIONAL_DOCS/handleDocSelect/docContent 等）与后端 `get_document_content` + `GET /documents/{doc_type}` 一并删除

### FR-03: 文件树展示变更目录全部文件
覆盖决策：D-006@v1, D-007@v1
Given 变更详情页已加载
When 调用 `GET /changes/{cid}/files`
Then 返回该变更目录下递归全部文件清单 `[{path, name, size, last_modified_at, is_text}]`（path 相对变更目录，排除 `.` 开头隐藏文件）
Given daemon-client 工作区
Then 用 `SpecWorkspaceService.spec_root` 解析目录（非 root_path）
Given server-local 工作区
Then 用 `{root_path}/.sillyspec/changes/{key}/` 解析

### FR-04: 读取单文件内容
覆盖决策：D-004@v1
Given 文件树选中某文件
When 调用 `GET /changes/{cid}/files/content?path=<rel>`
Then 返回 `{path, content, exists}`，content ≤ 1MB 截断
Given path 含 `../` 或绝对路径或符号链接越界
Then 返回 4xx（路径穿越守卫）

### FR-05: 编辑保存（path_source 分流）
覆盖决策：D-001@v1, D-002@v1, D-004@v1, D-006@v1, D-007@v1
Given 用户编辑文本文件（is_text=true）
When 调用 `POST /changes/{cid}/files/content` body `{path, content}`
Then path resolve 后必须落在变更目录内（否则 4xx），content ≤ 1MB（否则 4xx）
Given server-local 工作区
Then `write_text` 到 `{root_path}/.sillyspec/changes/{key}/{path}`，触发 per-change resync，返回 `{status:"done"}`
Given daemon-client 工作区
Then 后端直写平台镜像 + 建/合并同 change_key+path 的 pending DaemonChangeWrite 行（kind="edit"，更新 content，不 await），触发 per-change resync，返回 `{status:"pending", task_id}`
Given 二进制文件（is_text=false）
Then 编辑禁用，仅只读

### FR-06: 离线续传
覆盖决策：D-001@v1, D-002@v1
Given daemon-client 工作区且 daemon 离线
When 用户保存
Then pending 行保持 pending（不翻 failed），daemon 重连后轮询 claim→写本机→complete
Given 同文件多次保存（daemon 仍离线）
Then 合并为单条 pending 行（更新 content，last-write-wins）

### FR-07: 保存后 per-change resync
覆盖决策：D-005@v1
Given 写回成功（server-local 写盘 / daemon-client 镜像直写）
When POST 返回前
Then 调用 `_resync_change_docs`：复用 `_parse_change` + `_sync_docs` 刷新 ChangeDocument 行 + 重提取 title；resync 失败 best-effort（log，不阻断返回）
Given daemon 回执 complete
Then daemon 自带 syncSpecTreeIfNeeded 回灌镜像（幂等），backend 不再动

### FR-08: 待写回状态查询
覆盖决策：D-001@v1
Given 文件树加载 / 保存后轮询
When 调用 `GET /changes/{cid}/files/pending`
Then 返回该变更 pending/claimed 的 DaemonChangeWrite 行 `[{path, status, created_at}]`（建议 kind="edit" 过滤）

### FR-09: 前端文件树 + 编辑器 + 状态机
覆盖决策：D-003@v1, D-007@v1
Given 变更详情页
When 渲染文件树
Then 左树（复用 scan-docs TreeView 范式）+ 右内容区双栏；文本文件→可编辑 textarea + 保存按钮 + 放弃修改；二进制→只读
Given 保存动作
Then 状态机流转 idle→saving→done|pending|failed；daemon-client 保存返 pending 后轮询 `/files/pending`（2s 间隔，页面不可见停）直到该 path 行消失（done）或翻 failed
Given 文件有待回写 pending 行
Then 文件树该文件显示「排队中」徽标；顶部展示 last_synced_at；daemon 离线时警告条（不硬阻编辑）

## 非功能需求

- 兼容性：未升级的旧 daemon 仍能消费 edit-kind 行（files 写回逻辑不变，kind 仅 backend 用）；旧 proxy_create_change 创建路径 kind 默认 create 行为不变。
- 可回退：migration 加列可 alembic downgrade；前端组件新增不破坏既有页面。
- 可测试：路径穿越/两分支/resync/状态机均有自动化测试；前端 jsdom 下 MarkdownText vi.mock。
- 安全：写/读 path 均 resolve 校验落变更目录内。
- 跨平台：Win/Linux/macOS 路径分隔兼容（用 pathlib / path.join）。
- 性能：轮询 2s + visibilitychange 停；per-change resync 非全量。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-05, FR-06, FR-08 | outbox 不 await + 离线续传 |
| D-002@v1 | FR-05, FR-06 | 同文件 pending 合并 |
| D-003@v1 | FR-09 | 读前展示 synced_at 不硬阻 |
| D-004@v1 | FR-04, FR-05 | 路径穿越守卫 |
| D-005@v1 | FR-07 | per-change resync |
| D-006@v1 | FR-03, FR-05 | path_source 分流 |
| D-007@v1 | FR-03, FR-05, FR-09 | 仅编辑现有文件 |
| D-008@v1 | FR-02 | 文件树替换 A+B |

无未覆盖的当前版本决策（D-001..D-008 全覆盖）。无 Unresolved Blocker。
