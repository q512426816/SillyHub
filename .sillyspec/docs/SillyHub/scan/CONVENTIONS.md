---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# CONVENTIONS.md — SillyHub 项目级编码规范和约定

## 分支策略

- **main**：主分支，始终保持可部署状态
- **feature/***：功能分支，从 main 创建，PR 合入
- 代码修改通过 **worktree 隔离**进行，不依赖传统分支隔离
- GitGateway 白名单拒绝 `--force` 推送到 main/master

## Commit 规范

### 格式

```
<type>(<scope>): <description>
```

### Type 列表

| 类型 | 用途 |
|------|------|
| feat | 新功能 |
| fix | Bug 修复 |
| refactor | 重构（不改变行为） |
| docs | 文档变更 |
| test | 测试相关 |
| chore | 构建/工具/配置 |
| perf | 性能优化 |
| ci | CI/CD 相关 |

### Scope

- 后端：模块名（auth、workspace、git_gateway、agent 等）
- 前端：frontend 或具体页面名
- 顶层：deploy、ci、sillyspec

### 示例

```
feat(git_gateway): add retry policy with exponential backoff
fix(workspace): resolve path rewriting on Windows
docs(readme): update local development setup
refactor: ruff lint 合规 + ScanDocs 单组件解析/软删除 + 测试适配 auto-reparse
```

## PR 规范

### 描述模板

```markdown
## 变更内容
- [x] 做了什么

## 关联
- SillySpec 变更包：`.sillyspec/changes/<key>/`

## 测试
- [x] `make backend-test` 通过
- [x] `make frontend-test` 通过

## 验证步骤
1. 具体可执行的验证步骤
```

- 至少一人 Review
- CI 全绿
- 数据库迁移必须人工审查

## 代码风格

### 通用（.editorconfig）

- UTF-8 编码
- LF 换行
- 末尾空行
- 去除尾部空格（Markdown 除外）
- 默认 2 空格缩进
- Python 4 空格缩进
- Makefile tab 缩进

### 后端（Python）

- **格式化**：Ruff（`ruff format .` + `ruff check .`）
- **类型检查**：mypy（`uv run mypy app`）
- **线宽**：100 字符（pyproject.toml `line-length = 100`）
- **命名**：snake_case（函数/变量）、PascalCase（类）
- **异步**：所有 DB/IO 操作使用 async/await
- **错误处理**：通过 `app.core.errors` 统一异常体系（AppError 基类）
- **日志**：structlog 结构化日志
- **导入排序**：Ruff isort（I 规则）

#### Ruff 规则

启用的规则集：E, F, I, B, UP, N, SIM, RUF, BLE

主要忽略项（pyproject.toml）：
- E501（行长度由 formatter 强制）
- N818（异常命名不强制 Error 后缀）
- RUF001/002/003（中文字符）
- BLE001（bare Exception 捕获）
- UP037（ruff vs mypy forward-ref 冲突）

#### mypy 配置

- Python 版本：3.12
- strict = false（渐进式类型化）
- warn_unused_ignores = true
- pydantic.mypy 插件启用
- ignore_missing_imports = true
- 部分错误码禁用（attr-defined, union-attr 等）

### 前端（TypeScript）

- **格式化**：ESLint（`pnpm lint`）
- **类型检查**：TypeScript 严格模式（`pnpm typecheck`）
- **目标**：ES2022
- **模块**：esnext + bundler resolution
- **严格模式**：strict = true, noUncheckedIndexedAccess = true
- **组件**：函数组件 + hooks
- **样式**：Tailwind CSS 工具类 + cn()（clsx + tailwind-merge）
- **API 调用**：统一走 `src/lib/api.ts`
- **路径别名**：`@/*` → `./src/*`

## 文档规范

### SillySpec 变更包

每个变更包包含以下文档：

1. **MASTER.md** — 变更总览 + 进度追踪
2. **proposal.md** — 提案（为什么做）
3. **requirements.md** — 需求 + 验收标准
4. **design.md** — 架构/数据模型/API 设计
5. **plan.md** — 任务分解/排期（Wave 分组）
6. **tasks/** — 单个任务文件
7. **verify-result.md** — 验证结果

### Task 文档模板

1. 目标（5 行内 + "不在范围"）
2. 输入（文件路径）
3. 产出（文件/API/DB/命令）
4. 验收（可点击验证）
5. 风险（具体对策）
6. DoD（checkbox）

### 扫描文档

`docs/{component}/scan/` 下 7 个固定文件：
- ARCHITECTURE.md — 架构
- PROJECT.md — 项目概述
- STRUCTURE.md — 目录结构
- CONVENTIONS.md — 编码规范
- INTEGRATIONS.md — 外部集成
- TESTING.md — 测试策略
- CONCERNS.md — 风险和关注

### 模块文档

`docs/{component}/modules/` 下每个模块一个 `.md`，结构：
职责 → 设计 → 接口 → 数据流 → 决策 → 依赖 → 注意 → 变更索引

## SillySpec 工作流规范

### 变更阶段

```
propose → clarify → brainstorm → plan → review
→ execute → verify → approve → archive → close
```

### 开发流程（硬性规则）

1. 禁止无文档改代码，禁止先写代码再补文档
2. 新功能 / 大改动走完整流程：`sillyspec run brainstorm` → plan → execute → verify
3. 小修复 / 小调整：`sillyspec run quick`
4. 修改代码前，说明依据的文档路径
5. 实现完成后，对照文档验收

### 执行顺序

```
文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收
```

### Agent 使用

- 仅在 worktree 隔离环境中执行
- subprocess 启动，不直接暴露终端
- ContextBuilder 注入 SillySpec 知识
- 日志实时回传（SSE）

### Git 操作

- 必须通过 GitGatewayService
- 白名单审计 + 输出脱敏
- 禁止 --force/--hard/clean
- main/master 禁止直接 push

## 环境变量管理

- `.env` 统一 gitignored
- `deploy/.env.example` 为唯一模板
- 敏感变量不在代码中硬编码
- Docker 通过 `env_file` + `environment` 注入
- 必须设置的环境变量：SECRET_KEY, SILLYSPEC_MASTER_KEY
- LLM 配置：ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, CLAUDE_CODE_MODEL

## 包管理约定

### 后端

- 包管理器：uv
- 依赖声明：pyproject.toml
- 锁文件：uv.lock
- 安装命令：`uv sync --all-extras`
- 运行命令：`uv run <command>`

### 前端

- 包管理器：pnpm 9.6.0
- 依赖声明：package.json
- 锁文件：pnpm-lock.yaml
- Node 版本要求：>= 20.0.0
- 安装命令：`pnpm install --frozen-lockfile`

## 前后端 API 约定

- API 路径前缀：`/api/*`
- 认证方式：JWT Bearer token
- 请求 ID：`x-request-id` header（自动生成或透传）
- CORS：通过 `CORS_ALLOWED_ORIGINS` 配置
- 错误响应：统一 JSON 格式（code + message + detail）
- 健康检查：`GET /api/health`
- API 文档：`/api/docs`（Swagger UI）、`/api/redoc`（ReDoc）
