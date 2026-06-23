---
schema_version: 1
doc_type: module-card
module_id: spec_workspace
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:36
---
# spec_workspace

## 定位
连接 workspace 与 SillySpec 文件系统的桥梁。管理 workspace 与 spec 规范空间的 1:1 关联（spec_root 目录、同步策略、验证、bootstrap 初始化）。把工作区变成「可被 spec 工作流驱动的规范空间」：决定 spec 文件存哪、怎么同步、是否合法、如何用 agent 初始化。

产品视角：这是把「一个代码目录」变成「一个 spec 工作流实例」的转换器。用户扫描工作区后，本模块为其挂载 spec 空间，决定 spec 文件落在平台托管目录还是 repo 内；bootstrap 用 agent 智能填充默认 spec 文件，让空工作区快速具备规范骨架；validator 守住文档质量门禁。三种同步策略适配不同项目管理方式。

## 契约摘要
- 路由：`APIRouter prefix=/workspaces/{workspace_id} tag=spec-workspace`
  - `GET /spec-workspace` 取信息（`SpecWorkspaceRead`）、`GET /spec-workspace/bundle` 流式下载打包、`PATCH /spec-workspace` 更新配置
  - `POST /spec-workspace/import` 从 repo 导入、`POST /spec-workspace/sync` 触发同步、`POST /spec-workspace/bootstrap` 初始化（返回 dict 含 ok/run_id）
  - `GET /spec-conflicts` 列冲突（`SpecConflictListResponse`）、`POST /spec-conflicts/{id}/resolve` 解决
- 数据：`SpecWorkspace`（workspace_id 唯一索引 1:1、strategy / spec_root / sync_status / last_synced_at）
- 三种 strategy：`platform-managed`（spec 仅在 spec_root，默认）、`repo-mirrored`（spec_root 与 repo 双向同步）、`repo-native`（repo `.sillyspec` 为真源，spec_root 作缓存）
- sync_status 状态机：`clean` / `dirty` / `conflicted` 跟踪同步健康度
- 依赖：`core`、`models`、`workspace`、`spec_profile`（SpecConflict）、`agent`（bootstrap 调 ClaudeCodeAdapter）、`workflow`（AuditLog）
- 跨组件协作：scan_docs.reparse 读 spec_root、daemon 通过 spec bundle 获取规范、前端 spec-workspaces.ts 客户端

## 关键逻辑
bootstrap 初始化（`SpecBootstrapService.bootstrap`）：
```
ws = get_workspace(workspace_id); spec_ws = get_spec_workspace(workspace_id)
report = SpecValidator.validate(spec_root)   # 三级检查：目录结构/YAML schema/引用
if report.errors: 写 SpecConflict + sync_status=dirty; return
run = _execute_bootstrap_agent_run(ws, spec_ws, user)  # 调 agent 填默认文件
记录 AgentRun/AgentRunLog/AuditLog → 返回 {ok, run_id, ...}
```
- `import_from_repo` / `sync` 当前为 stub：只更新 sync_status=clean + last_synced_at，不做实际文件搬运
- `build_bundle` 用流式 generator（`_stream`）打包 spec 目录供下载，避免大目录占内存
- `preflight_workspace_code_root` 在 bootstrap 前预检代码根，`_run_preflight` 返回告警字符串
- `_execute_bootstrap_agent_run` 调 agent 填默认 spec 文件，全程记录 AgentRun/AgentRunLog
- `_publish_log_event` / `_publish_done_event` 通过事件流推送 bootstrap 进度给前端
- validator 三级检查：`_check_directory_structure` → `_check_yaml_schema` → `_check_references`

### Validator 校验细节
`SpecValidator.validate(spec_root)` 返回 `ValidationReport`：
- `ValidationIssue`（level/message/path）区分 error 与 warning
- `_check_directory_structure`：校验 docs/changes/ 等必需目录存在
- `_check_yaml_schema`：校验 frontmatter 必填字段、类型
- `_check_references`：校验文档间引用（change→task、module→component）可达
- errors 非空时 bootstrap 写 SpecConflict + sync_status=dirty，不阻断但记录

## 注意事项
- bootstrap 异步且调 agent，耗时长，前端走 SSE 看日志（复用 AgentLogViewer）
- `SpecValidator` 是纯同步文件系统检查，可脱离 DB 独立使用/测试
- import/sync 是 stub，真正双向同步逻辑待后续 wave，改动勿当已实现
- 冲突解决后不自动重验，需再次 bootstrap
- sync_status 状态机（clean/dirty/conflicted）跟踪同步健康度
- 验证失败不阻断流程，记录 SpecConflict + sync_status=dirty 允许后续手动解决
- bootstrap 的 AgentRun 失败时通过 `_write_run_log` 落盘日志便于排查
- bundle 下载是流式响应，前端需按 blob 处理
- workspace_id 与 SpecWorkspace 是 1:1，创建工作区时由 `_ensure_spec_workspace` 自动连带建
- `_ensure_spec_workspace_from_platform` 为平台托管工作区初始化默认 spec 空间
- `update_sync_status` 单独更新同步状态，供 import/sync/bootstrap 复用
- `apply_sync` 应用同步结果到 SpecWorkspace 行（stub 实现）
- `get_by_id` 按 spec_workspace_id 直查（区别于按 workspace_id 的 get）
- bootstrap 的 run_log 落盘路径由 `_write_run_log` 管理，便于失败排查
- bundle 流式响应需前端按 blob 接收，大目录不占服务端内存
- SpecValidator 的 ValidationReport.errors/warnings 区分严重度
- import_from_repo/sync 的 stub 实现只改状态不搬文件，勿当已实现
- strategy 决定 spec 文件物理位置与同步方向，创建后不宜频繁切换
- bootstrap 失败的 AgentRun 经 _write_run_log 落盘，便于排查
- spec-conflicts 端点读 SpecConflict 表（由 spec_profile 写入）
- _publish_log_event/_publish_done_event 推 bootstrap 进度给前端 SSE
- workspace 与 SpecWorkspace 1:1，由 _ensure_spec_workspace 连带建
- SpecValidator 可独立实例化，传入 spec_root 即用
- bootstrap 的 agent run 类型为 spec-bootstrap
- sync_status=conflicted 表示有未解决冲突

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
