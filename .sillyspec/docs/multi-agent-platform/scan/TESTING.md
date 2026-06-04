---
author: qinyi
created_at: 2026-06-04T08:54+08:00
---

# 测试策略与覆盖情况

## 测试框架和工具

### 后端测试
- **测试框架**: pytest 8+ + pytest-asyncio 0.23+
- **覆盖率**: pytest-cov 5+
- **发现路径**: `tests/` 和 `app/` 目录（pyproject.toml 配置 testpaths）
- **异步模式**: asyncio_mode = "auto"
- **文件匹配**: `test_*.py`

### 前端测试
- **测试框架**: Vitest 2.0
- **组件测试**: @testing-library/react 16.0.0 + @testing-library/jest-dom 6.4.6
- **环境模拟**: jsdom 24.1.0
- **测试命令**: `npm run test` (vitest run)、`npm run test:watch` (vitest)

### 代码质量工具
- **后端**: Ruff 0.6+ (lint + format)、MyPy 1.11+ (类型检查)
- **前端**: ESLint 8.57.0、TypeScript 5.5.4 (`tsc --noEmit`)

## 测试覆盖情况

### 后端测试文件统计 (55+ 文件)

**tests/ 集成测试套件**:
- `test_health.py` - 健康检查端点测试
- `test_config.py` - 配置加载测试
- `modules/agent/` - 协调器、阶段分发、工作目录策略测试
- `modules/change/` - 自动分发、分发链、阶段配置测试
- `modules/workspace/` - 扫描生成、生成服务测试

**app/modules/ 单元测试套件**:
- `agent/tests/` - Agent 基类、路由、上下文构建、差值收集、Kill 适配器隔离、M2N agent run
- `change/tests/` - 分发、解析器、路由、转换响应
- `workspace/tests/` - 模型、解析器、关系路由/服务、扫描仪、拓扑、M2N change/task
- `change_writer/tests/` - Markdown 构建器、路由
- `git_gateway/tests/` - 危险操作、路由、服务
- `git_identity/tests/` - 加密、路由
- `tool_gateway/tests/` - 策略、路由、服务
- `workflow/tests/` - FSM、审计钩、路由、spec guardian
- 其他模块: archive, incident, knowledge, release, runtime, scan_docs, spec_profile, spec_workspace, task, worktree

### 前端测试文件

- `src/lib/__tests__/api.test.ts` - API 客户端测试

前端测试覆盖率相对较低，主要集中在工具函数和 API 层，组件测试待补充。

## 测试运行命令

### 后端
```bash
cd backend
uv run pytest                  # 运行全部测试
uv run pytest -ra              # 显示失败/跳过摘要
uv run pytest --cov            # 带覆盖率
uv run pytest app/modules/agent/tests/  # 运行指定模块测试
```

### 前端
```bash
cd frontend
pnpm test                      # 单次运行
pnpm test:watch                # 监听模式
```

### 一键命令（项目根目录）
```bash
make test                      # 后端 + 前端测试
make backend-test              # 仅后端
make frontend-test             # 仅前端
```

## 测试策略特点

1. **垂直切片测试**: 业务模块包含紧邻的 tests/ 目录，单元测试与代码同步维护
2. **异步优先**: pytest-asyncio 自动模式，支持 FastAPI 异步端点测试
3. **集成与单元分离**: `tests/` 用于跨模块集成测试，`app/modules/*/tests/` 用于单元测试
4. **CI 集成**: GitHub Actions 分别运行 backend-ci 和 frontend-ci 工作流
