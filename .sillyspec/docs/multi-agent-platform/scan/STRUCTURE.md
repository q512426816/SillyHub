---
author: qinyi
created_at: 2026-06-04T08:55:00+08:00
---

# 项目结构

## 目录树

```
multi-agent-platform/
├── backend/                    # FastAPI 后端服务
│   ├── app/
│   │   ├── main.py            # 应用入口，Uvicorn 启动点
│   │   ├── core/              # 核心基础设施（配置、数据库、依赖注入）
│   │   ├── models/            # 共享数据模型（跨模块复用）
│   │   └── modules/           # 业务模块（22+ 个模块）
│   │       ├── agent/         # Agent 执行引擎
│   │       ├── workspace/     # 工作区管理
│   │       ├── change/        # 变更工作流
│   │       ├── task/          # 任务管理
│   │       ├── worktree/      # Git 工作树租约
│   │       ├── auth/          # 认证授权
│   │       ├── git_gateway/   # Git 操作网关
│   │       ├── git_identity/  # Git 身份管理
│   │       ├── change_writer/ # 代码写入器
│   │       ├── tool_gateway/  # 工具调用网关
│   │       ├── scan_docs/     # 文档扫描
│   │       ├── spec_workspace/# 规格工作区
│   │       ├── spec_profile/  # 规格档案
│   │       ├── workflow/      # 工作流引擎
│   │       ├── archive/       # 变更归档
│   │       ├── release/       # 发布管理
│   │       ├── incident/      # 事件管理
│   │       ├── knowledge/     # 知识库
│   │       ├── runtime/       # 运行时状态
│   │       ├── health/        # 健康检查
│   │       └── settings/      # 设置管理
│   ├── tests/                # 后端集成测试
│   ├── migrations/           # Alembic 数据库迁移
│   └── pyproject.toml        # Python 项目配置
│
├── frontend/                  # Next.js 14 前端应用
│   ├── src/
│   │   ├── app/              # App Router 页面
│   │   │   ├── (auth)/       # 认证路由组（登录页）
│   │   │   ├── (dashboard)/  # 仪表盘路由组
│   │   │   │   ├── workspaces/[id]/    # 工作区详情页
│   │   │   │   ├── settings/           # 设置页面
│   │   │   │   └── api/                # API 路由（代理后端）
│   │   │   └── globals.css   # 全局样式
│   │   ├── components/       # React 组件
│   │   │   ├── ui/           # shadcn/ui 基础组件
│   │   │   └── *.tsx         # 业务组件
│   │   ├── lib/              # 工具库和 API 客户端
│   │   │   ├── api.ts        # 核心 API 客户端
│   │   │   ├── agent.ts      # Agent API
│   │   │   ├── workspaces.ts # 工作区 API
│   │   │   ├── changes.ts    # 变更 API
│   │   │   ├── auth.ts       # 认证 API
│   │   │   └── agent-stream.ts # SSE 流处理
│   │   ├── stores/           # Zustand 全局状态
│   │   └── test/             # 前端测试
│   ├── package.json          # Node 依赖
│   └── next.config.js        # Next.js 配置
│
├── deploy/                    # Docker Compose 部署
│   └── docker-compose.yml    # 完整栈部署配置
│
├── .sillyspec/               # SillySpec 文档驱动开发
│   ├── docs/                 # 文档输出
│   ├── changes/              # 变更文档
│   ├── knowledge/            # 知识库
│   ├── quicklog/             # 快速日志
│   └── workflows/            # 工作流定义
│
├── docs/                     # 额外文档
├── spikes/                   # 技术验证原型
└── Makefile                  # 一键命令
```

## 模块说明

### 后端 (backend/)

**app/core/** - 核心基础设施
- config.py: 配置加载（环境变量、.env）
- database.py: SQLAlchemy 会话管理
- dependencies.py: FastAPI 依赖注入（认证、权限）

**app/modules/agent/** - Agent 执行引擎
- 协调器（AgentCoordinator）管理 Claude Code CLI 子进程
- 阶段分发器（StageDispatcher）路由到不同 SillySpec 阶段
- 工作目录策略（WorktreeStrategy）隔离执行环境

**app/modules/workspace/** - 工作区管理
- Workspace 模型：宿主机项目目录的抽象
- 扫描仪（WorkspaceScanner）：生成项目结构文档
- 拓扑服务（TopologyService）：分析模块依赖关系

**app/modules/change/** - 变更工作流
- Change 模型：工作流状态机（stage 字段）
- 分发器（ChangeDispatcher）：自动路由到各阶段
- 解析器（ChangeParser）：解析 proposal.md、plan.md

**app/modules/worktree/** - Git 工作树租约
- Worktree 模型：租约管理（acquire、release、heartbeat）
- 文件系统隔离：避免并发 Agent 写冲突

**app/modules/auth/** - 认证授权
- JWT 令牌：access token（15 分钟）+ refresh token（14 天）
- 密码哈希：bcrypt（12 轮）
- 权限模型：用户、角色、资源级权限

**app/modules/git_gateway/** - Git 操作网关
- 统一 Git 操作接口：commit、push、branch
- 危险操作保护：force push、reset 需要审批

**app/modules/git_identity/** - Git 身份管理
- 加密存储：用户名、密码、SSH 密钥
- 多提供商支持：GitHub、GitLab、自托管

**app/modules/change_writer/** - 代码写入器
- Agent 驱动的文件操作：Create、Edit、Delete
- 冲突检测：基于文件指纹

**app/modules/tool_gateway/** - 工具调用网关
- 工具策略：允许、拒绝、审计
- 调用日志：记录所有 Agent 工具使用

**app/modules/scan_docs/** - 文档扫描
- 生成 7 份扫描文档：ARCHITECTURE、STRUCTURE、CONVENTIONS、INTEGRATIONS、TESTING、CONCERNS、PROJECT
- 模块卡片（MODULE_CARDS）：每个模块的索引

**app/modules/spec_workspace/** - 规格工作区
- SpecWorkspace 模型：.sillyspec 目录管理
- 初始化模板：复制 SillySpec 脚手架

**app/modules/workflow/** - 工作流引擎
- FSM（有限状态机）：SpecGuardian 验证状态转换
- 审计钩（AuditHook）：记录所有状态变更

**app/modules/archive/** - 变更归档
- 模块影响分析：更新 _module-map.yaml

**app/modules/release/** - 发布管理
- 审批流程：发布前需要审批
- 版本打包：将已归档变更打包

**app/modules/incident/** - 事件管理
- 事件记录：生产问题追踪
- 事后复盘：关联到相关变更

**app/modules/knowledge/** - 知识库
- 模式沉淀：fix-pattern、design-decision、api-contract

**app/modules/runtime/** - 运行时状态
- AgentRun 模型：一次 CLI 执行的完整记录
- AgentRunLog 模型：日志流存储

**app/modules/health/** - 健康检查
- 数据库连接检查
- Redis 连接检查
- 提交 SHA 显示

### 前端 (frontend/)

**src/app/(dashboard)/workspaces/[id]/** - 工作区详情页
- agent/：Agent 运行和日志流
- changes/：变更列表和详情
- tasks/：任务管理
- runtime/：运行时状态
- scan-docs/：扫描文档预览
- components/：拓扑视图
- releases/：发布管理
- incidents/：事件管理
- knowledge/：知识库

**src/lib/api.ts** - 核心 API 客户端
- apiFetch<T>()：统一处理认证、错误、序列化
- 自动注入 access token（从 Zustand store）

**src/lib/agent-stream.ts** - SSE 流处理
- AgentOutputParser：解析流式日志
- 重连机制：断线自动重连

**src/stores/session.ts** - Zustand 全局状态
- access token、refresh token
- 用户信息、权限

**src/components/app-shell.tsx** - 应用壳层
- 侧边栏导航
- 顶部用户菜单
- 认证守卫

### 部署 (deploy/)

**docker-compose.yml** - 完整栈部署
- postgres:16-alpine - 主数据库
- redis:7-alpine - 缓存和 Pub/Sub
- backend - FastAPI 服务（端口 8000）
- frontend - Next.js 服务（端口 3000）
- 卷挂载：项目目录、worktree 数据、spec 数据
