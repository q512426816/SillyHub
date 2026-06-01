---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# 项目功能范围

## 项目定位

SillyHub 前端是一个 **SillySpec 原生的多 Agent 执行平台**，提供以下核心能力：

1. **Workspace 管理** — 管理代码仓库工作区，支持 SillySpec 规范扫描
2. **变更中心** — 变更的全生命周期管理（创建 → 执行 → 审批 → 归档）
3. **组件拓扑** — 项目组件关系可视化管理
4. **Agent 控制** — AI Agent 执行控制台，支持实时日志流
5. **审批流程** — 人工审批 Agent 操作请求
6. **审计追溯** — 全平台操作审计日志
7. **事件管理** — 线上事件 (Incident) 跟踪与复盘
8. **发布管理** — 变更发布流程
9. **知识库** — 运行时知识与快速日志
10. **扫描文档** — SillySpec 规范文档浏览
11. **运行时监控** — Agent 执行阶段进度实时追踪
12. **Git 身份管理** — 多 Git 身份配置与仓库访问权限控制

## 页面清单

### 公开页面

| 路由 | 页面 | 说明 |
|------|------|------|
| `/` | 首页 | 平台入口，展示健康状态，引导进入 Workspace |
| `/login` | 登录 | 邮箱密码登录 |

### 仪表盘页面 (需认证)

| 路由 | 页面 | 说明 |
|------|------|------|
| `/workspaces` | Workspace 列表 | 所有 Workspace 概览，支持扫描创建 |
| `/workspaces/[id]` | Workspace 详情 | 基本信息 + 组件/变更/运行时统计 + 规范管理 |
| `/workspaces/[id]/components` | 项目组件 | 子 Workspace (组件) 列表 |
| `/workspaces/[id]/components/topology` | 拓扑图 | 组件关系拓扑可视化 (@xyflow/react) |
| `/workspaces/[id]/changes` | 变更中心 | 活跃/归档变更列表 |
| `/workspaces/[id]/changes/[cid]` | 变更详情 | 单个变更详情 + 文档矩阵 + Agent 状态 |
| `/workspaces/[id]/changes/[cid]/tasks` | 任务列表 | 变更关联的任务看板 |
| `/workspaces/[id]/changes/[cid]/tasks/[tid]` | 任务详情 | 单个任务详情 |
| `/workspaces/[id]/create-change` | 创建变更 | 新建变更表单 |
| `/workspaces/[id]/scan-docs` | 扫描文档 | SillySpec 规范文档列表与查看 |
| `/workspaces/[id]/runtime` | 运行时 | 执行阶段进度 + 制品管理 |
| `/workspaces/[id]/knowledge` | 知识 & 日志 | 知识条目 + 快速日志 |
| `/workspaces/[id]/releases` | 发布 | 版本发布管理 |
| `/workspaces/[id]/agent` | Agent 控制台 | Agent 运行列表 + 实时日志 (SSE) |
| `/workspaces/[id]/approvals` | 审批中心 | 待审批请求 + 审批历史 |
| `/workspaces/[id]/audit` | 审计中心 | 操作审计日志查询 |
| `/workspaces/[id]/incidents` | 事件列表 | 事件管理 |
| `/workspaces/[id]/incidents/[iid]` | 事件详情 | 单个事件详情 + 复盘 (Postmortem) |
| `/settings` | 平台设置 | 全局设置管理 |
| `/settings/git-identities` | Git 身份 | Git 凭证配置与管理 |

## 核心用户流程

### 流程一：Workspace 创建与初始化

1. 进入 `/workspaces` 页面
2. 点击「添加 Workspace」打开 `WorkspaceScanDialog`
3. 输入仓库根路径 → 点击「扫描」
4. 查看扫描结果：目录结构、.sillyspec 检测、组件/变更数量
5. 选择规范策略 (platform-managed / repo-mirrored / repo-native)
6. 确认创建 → Workspace 入库
7. 进入 Workspace 详情页，执行 Bootstrap / Import / Sync 操作

### 流程二：变更全生命周期

1. 在变更中心或 Workspace 详情页点击「创建变更」
2. 填写标题、描述、范围 (full/quick)、关联组件
3. 创建后进入变更详情页
4. 可触发 Agent 执行变更（Agent 自动化处理）
5. 阶段流转：draft → scanning → planning → implementing → verifying → reviewing → approved → deployed
6. 提交反馈（A=Bug/B=设计错误/C=信息不足/D=衍生新 change）
7. 审批通过后执行归档门禁检查
8. 通过后归档变更，可选蒸馏知识

### 流程三：Agent 执行与监控

1. 在变更详情页查看 Agent 状态 (`getAgentStatus`)
2. 手动或自动触发 Agent Dispatch (`triggerDispatch`)
3. 进入 Agent 控制台 (`/agent`) 查看运行列表
4. 点击运行项查看日志，支持 SSE 实时流 (`streamAgentRunLogs`)
5. 查看 stdout/stderr/tool_call 三种日志通道

### 流程四：审批流程

1. Agent 执行高危操作时自动创建审批请求
2. 在审批中心 (`/approvals`) 查看待审批列表
3. 审批人查看 tool_name、branch、target、commit_message 等详情
4. 批准或驳回 → Agent 继续或终止

### 流程五：事件管理

1. 创建事件：填写标题、严重程度、影响组件
2. 状态流转：open → investigating → mitigated → resolved
3. 编写复盘 (Postmortem)：时间线、影响分析、根因、行动项、经验教训
4. 关联到特定发布版本

### 流程六：发布管理

1. 创建发布：选择版本号、目标环境、关联变更
2. 审批发布
3. 执行部署
4. 晋升 (promote)：staging → production
5. 必要时回滚 (rollback)

## 功能范围边界

### 已实现

- Workspace CRUD + 扫描 + 重解析
- 变更全生命周期 (含阶段流转、反馈、归档)
- 组件列表 + 拓扑图可视化
- Agent 执行控制 + SSE 实时日志
- 审批中心 (Agent 工具级审批)
- 审计日志查询
- 事件管理 + 复盘
- 发布管理 (创建/审批/部署/晋升/回滚)
- 知识库 + 快速日志
- 扫描文档浏览
- 运行时进度监控
- Git 身份管理
- 平台设置 + 用户管理
- 平台健康检查

### 尚未充分使用

- TanStack React Query：已安装但页面主要使用 useState + useEffect 模式
- Zod：已安装但未见表单校验使用
