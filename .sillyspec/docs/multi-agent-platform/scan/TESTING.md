---
author: qinyi
created_at: 2026-06-10T17:00:04
---

# 测试策略 — multi-agent-platform

## 后端测试

### 框架与工具
- **pytest** + **pytest-asyncio** (asyncio_mode=auto)
- **pytest-cov**: 覆盖率报告，门槛 60%
- **aiosqlite**: 测试用 SQLite 替代 PostgreSQL
- **conftest.py**: 全局 fixtures (async session, test client, mock settings)

### 测试结构

后端测试分布在两个位置：

1. **顶层集成测试** (`backend/tests/`)
   - `test_config.py` — 配置加载
   - `test_health.py` — 健康检查端点
   - `tests/modules/` — 按模块组织的集成测试
     - `test_coordinator.py`, `test_context_builder.py` — Agent 模块
     - `test_dispatch.py`, `test_dispatch_chain.py`, `test_stage_dispatch.py` — SillySpec 调度
     - `test_auto_dispatch.py` — 自动调度
     - `test_scan_generate.py`, `test_scan_generate_service.py` — 扫描生成
     - `test_router.py`, `test_router_transition.py` — 路由/状态转换
     - `test_archive_gate.py` — 归档门控
     - `test_work_dir_strategy.py` — 工作目录策略

2. **模块内单元测试** (`backend/app/modules/*/tests/`)
   - agent 模块: 12 个测试文件 (adapter isolation, context builder, kill, router, scan run reparse 等)
   - 模式: 与业务代码同目录，方便定位

### 运行命令
```bash
cd backend && uv run pytest -q --cov=app --cov-fail-under=60
```

### 测试覆盖范围
- Agent 适配器隔离测试
- Agent Run 生命周期
- Context Builder 构建逻辑
- Diff Collector 差异收集
- Post Scan Validator 验证
- SillySpec 调度链
- Worktree 租约
- 各模块路由端点

## 前端测试

### 框架与工具
- **Vitest** + **jsdom** 环境
- **@testing-library/react** + **@testing-library/jest-dom**
- **@playwright/test** — E2E 测试
- **puppeteer** — 浏览器自动化

### 测试结构
- `frontend/src/lib/__tests__/` — lib 层单元测试
  - `agent.test.ts` — Agent API 函数测试
  - `api.test.ts` — apiFetch 通用函数测试
  - `spec-workspaces.test.ts` — Spec 工作区测试
- `frontend/src/test/setup.ts` — 测试环境 setup

### 运行命令
```bash
cd frontend && pnpm test        # vitest run
cd frontend && pnpm test:watch  # vitest watch
```

## Daemon 测试

### 框架
- **pytest** (hatchling 构建)

### 测试结构
- `sillyhub-daemon/tests/` — 17 个测试文件
  - `test_agent_detector.py` — Agent 检测器
  - `test_backends_init.py` — Backend 注册表
  - `test_json_rpc.py` — JSON-RPC 协议 (最大测试文件 33KB)
  - `test_jsonl_backend.py`, `test_ndjson_backend.py` — 其他协议
  - `test_stream_json_backend.py`, `test_text_backend.py` — 更多协议
  - `test_daemon.py`, `test_daemon_multi_runtime.py` — Daemon 核心
  - `test_task_runner.py`, `test_task_runner_provider_dispatch.py` — 任务执行
  - `test_client.py` — Backend 客户端
  - `test_credential.py` — 凭证管理
  - `test_workspace.py` — 工作区管理
  - `test_cli.py` — CLI 命令
  - `test_version.py` — 版本检查

### 测试密度
Daemon 测试最为充分，17 个测试文件覆盖所有模块，是项目中测试覆盖最好的子项目。

## 测试缺口

- 前端组件测试不足：大部分页面组件缺少测试
- 前端 E2E 测试尚未建立（playwright/puppeteer 已安装但未发现测试文件）
- 后端部分模块（knowledge, runtime, git_gateway, tool_gateway）缺少模块内测试
- 后端 `test_run_input_service.py.skip` 存在被跳过的测试
