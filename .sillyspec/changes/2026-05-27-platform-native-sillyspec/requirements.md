---
author: qinyi
created_at: 2026-05-27 10:13:27
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| 平台管理员 | 配置 Agent 类型、SillySpec profile 来源、全局同步策略和并发限制 |
| 项目维护者 | 创建 workspace、选择 spec strategy、确认阶段文档、触发同步 |
| Agent 执行者 | 按任务运行 Claude Code 等 Agent，查看输出、日志和 diff |
| 普通成员 | 查看项目、规范、任务、Agent run 状态和审计记录 |

## 功能需求

### FR-01: 普通项目可创建 Workspace

Given 用户输入一个存在的普通代码目录  
When 用户执行 workspace scan 并创建 workspace  
Then 平台创建 workspace，`status=active`，不因缺少 `.sillyspec` 阻断

Given 目标目录已存在 `.sillyspec`  
When 用户创建 workspace  
Then 平台展示导入、镜像、忽略仓库规范三种选择

### FR-02: 平台托管规范空间

Given workspace 创建成功  
When workspace 没有 repo-native `.sillyspec`  
Then 平台创建托管 spec root，并设置 `spec_strategy=platform-managed`

Given 用户选择 `repo-mirrored`  
When 用户触发同步  
Then 平台将托管规范空间和仓库 `.sillyspec` 做显式同步，并记录审计

### FR-03: Agent Spec Profile

Given 平台配置了 `C:\Users\qinyi\IdeaProjects\sillyspec` 作为 profile 来源  
When 平台加载 profile  
Then 平台生成版本化 `SpecProfileManifest`，包含阶段、文档、门禁和 Agent 上下文契约

Given SillySpec profile 发生升级  
When 平台检测到 manifest diff  
Then 平台生成兼容性报告，需项目维护者确认迁移

### FR-04: 规范冲突策略

Given 平台治理要求和 SillySpec 规范要求不一致  
When 策略层可以自动决策  
Then 平台按硬门禁合并、更严格校验优先、extension metadata 或 adapter transform 处理

Given 策略层无法自动决策  
When 用户推进阶段或触发 Agent  
Then 平台生成 conflict record，阻止自动执行，并要求人工审批

### FR-05: Claude Code Agent 接入

Given task 已从规范文档解析并确认  
When 用户触发 `claude_code` Agent run  
Then 平台获取 worktree lease，构造 `AgentSpecBundle`，写入 `CLAUDE.md`，并启动 Claude Code adapter

Given Agent 执行完成  
When 平台收到退出码和输出  
Then 平台保存 run 状态、redacted logs、审计记录，并更新任务执行历史

### FR-06: Agent 类型一致性

Given 前端创建 Agent run
When 用户选择 Claude Code
Then 请求 payload 使用 `agent_type=claude_code`

Given 后端收到未知 agent type
When adapter registry 没有对应实现
Then 返回明确错误和可用 agent type 列表

### FR-07: 规范文件独立存储

Given workspace 创建成功
When 平台创建托管 spec root
Then spec root 位于 `spec_data_root/{workspace_id}/`，为绝对路径，不与代码仓库混放

Given spec root 目录内
When Agent 或 CLI 生成规范文件
Then 目录结构遵循 SillySpec 标准（`.sillyspec/projects/`、`.sillyspec/docs/`、`.sillyspec/changes/` 等）

Given 已有的 component/scan_docs/change/task/parser
When 需要读取规范文件
Then 从 `spec_root` 读取，不再从 `workspace.root_path/.sillyspec` 读取

### FR-08: SillySpec CLI 作为 Agent 工具

Given AgentSpecBundle 构建
When 平台准备 Agent 执行上下文
Then `available_tools` 包含 `["sillyspec"]`，Agent prompt 指示使用 CLI 命令

Given 用户触发 spec-bootstrap
When Agent 在 spec_root 目录中执行
Then Agent 调用 `sillyspec init --dir <spec_root>` 初始化，再调用 `sillyspec run scan --dir <spec_root>` 扫描

Given 已有 `.sillyspec` 的项目
When Agent 导入规范
Then Agent 调用 `sillyspec run scan --dir <spec_root>` 从代码仓库导入并修正

### FR-09: SpecValidator 程序验证

Given 规范文件已生成（bootstrap 或 sync 后）
When 平台执行验证
Then `SpecValidator` 检查：YAML schema（每个 `projects/*.yaml` 必须有 `id`、`name`、`type`）、引用完整性（`relations.target` 存在）、目录结构（至少有 `projects/` 目录）

Given 验证通过
When 平台更新状态
Then `sync_status = "clean"`

Given 验证失败
When 平台处理结果
Then 写入 `SpecConflict` 记录，`sync_status = "dirty"`，阻止 Agent 执行直到冲突解决

## 非功能需求

- 兼容性：已有 repo-native `.sillyspec` 项目必须继续可用。
- 可回退：平台托管 spec root 不应覆盖仓库 `.sillyspec`，同步必须显式触发。
- 隔离性：规范文件必须与代码仓库完全分离，存储在独立的平台数据目录中。
- 可信性：规范文件验证必须由确定性程序逻辑完成，不能依赖 Agent 自评。
- 可测试：workspace、profile、policy、agent context、Claude adapter、SpecValidator 都需要模块级测试。
- 可审计：所有规范生成、同步、冲突解决、Agent run 必须写审计。
- 安全性：Agent 只能在 leased worktree 和 allowed paths 范围内运行。
- 可扩展：新增 Agent adapter 不应修改业务流程，只注册 adapter 和 profile rendering 能力。
