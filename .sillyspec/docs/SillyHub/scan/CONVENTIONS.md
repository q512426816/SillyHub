---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# 项目规范

> 最后更新：2026-05-31
> 范围：SillyHub monorepo 顶层开发规范

## 1. 分支策略

- **main**：主分支，始终保持可部署状态
- **feature/***：功能分支，从 main 创建，PR 合入
- 代码修改通过 **worktree 隔离**进行，不依赖传统分支隔离
- GitGateway 白名单拒绝 `--force` 推送到 main/master

## 2. Commit 规范

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

### Scope

- 后端：模块名（auth、workspace、git_gateway）
- 前端：frontend 或具体页面名
- 顶层：deploy、ci、sillyspec

### 示例

```
feat(git_gateway): add retry policy with exponential backoff
fix(workspace): resolve path rewriting on Windows
docs(readme): update local development setup
```

## 3. PR 规范

### 描述模板

```markdown
## 变更内容
- [x] 做了什么

## 关联
- SillySpec 变更包：`.sillyspec/changes/change/<key>/`

## 测试
- [x] `make backend-test` 通过
- [x] `make frontend-test` 通过

## 验证步骤
1. 具体可执行的验证步骤
```

- 至少一人 Review
- CI 全绿
- 数据库迁移必须人工审查

## 4. 代码风格

### 通用

- `.editorconfig`：UTF-8、LF、末尾换行
- 默认 2 空格，Python 4 空格，Makefile tab

### 后端 (Python)

- **格式化**：Ruff（`ruff format .` + `ruff check .`）
- **类型检查**：mypy（`uv run mypy app`）
- **线宽**：88 字符
- **命名**：snake_case（函数/变量）、PascalCase（类）
- **异步**：所有 DB/IO 操作使用 async/await
- **错误处理**：通过 `app.core.errors` 统一异常体系

### 前端 (TypeScript)

- **格式化**：ESLint + Prettier（`pnpm lint`）
- **类型检查**：`pnpm typecheck`（严格模式）
- **组件**：函数组件 + hooks
- **样式**：Tailwind CSS 工具类
- **API 调用**：统一走 `src/lib/api.ts`

## 5. 文档规范

### SillySpec 变更包（6 节模板）

1. MASTER.md — 变更总览 + 进度
2. proposal.md — 提案
3. requirements.md — 需求 + 验收标准
4. design.md — 架构/数据模型/API
5. plan.md — 任务分解/排期
6. tasks.md — 任务总表
7. verification.md — 验证检查表

### Task 文档（6 节模板）

1. 目标（≤ 5 行 + "不在范围"）
2. 输入（文件路径）
3. 产出（文件/API/DB/命令）
4. 验收（可点击验证）
5. 风险（具体对策）
6. DoD（checkbox）

### 扫描文档

`docs/{component}/scan/` 下 7 个固定文件：ARCHITECTURE / PROJECT / STRUCTURE / CONVENTIONS / INTEGRATIONS / TESTING / CONCERNS

### 模块文档

`docs/{component}/modules/` 下每个模块一个 `.md`：职责 → 设计 → 接口 → 数据流 → 决策 → 依赖 → 注意 → 变更索引

## 6. SillySpec 工作流规范

### 变更阶段

```
propose → clarify → brainstorm → plan → review
→ execute → verify → approve → archive → close
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

## 7. 环境变量管理

- `.env` 统一 gitignored
- `deploy/.env.example` 为唯一模板
- 敏感变量不在代码中硬编码
- Docker 通过 `env_file` + `environment` 注入
