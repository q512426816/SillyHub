---
author: qinyi
created_at: 2026-06-10T17:00:05
---

# 代码债务与风险 — multi-agent-platform

## 代码质量

### 🔴 高严重度

- **Agent service.py 过大**: `backend/app/modules/agent/service.py` 约 71KB，职责过重，包含 Agent Run 的全部业务逻辑。应拆分为多个服务类。
- **前端页面组件过大**: `frontend/src/app/(dashboard)/settings/page.tsx` 约 23KB、`runtimes/page.tsx` 约 14KB，单个文件承担过多 UI 逻辑，应提取子组件。
- **Claude Code Adapter 过大**: `backend/app/modules/agent/adapters/claude_code.py` 约 37KB，Agent 适配器包含大量协议解析逻辑。

### 🟡 中严重度

- **测试覆盖不均**: 后端覆盖率门槛仅 60%，前端组件测试几乎为空。Daemon 测试最好（17 个文件），但 agent/adapters 层只有 adapter_isolation 测试。
- **跳过的测试**: `backend/app/modules/agent/tests/test_run_input_service.py.skip` 存在被跳过的测试文件，需要修复或移除。
- **硬编码路径**: `deploy/docker-compose.yml` 中 `HOST_PATH_PREFIX` 默认值为 `C:/Users/qinyi/IdeaProjects`，需要用户手动修改。
- **mypy 严格度不足**: `strict=false`，且 disable 了 9 个 error_code，类型安全性偏弱。

### 🟢 低严重度

- **Ruff ignore 规则偏多**: 忽略了 14 条 lint 规则，部分合理（如 B008 FastAPI 模式），但应定期审视是否可以逐步收紧。
- **前端 node_modules 提交风险**: pnpm-lock.yaml 存在但 `node_modules` 在根目录下，确保 `.gitignore` 正确配置。

## 依赖风险

### 🔴 高严重度

- **Claude Code 版本锁定**: 后端 Dockerfile 硬编码 `claude-code@2.1.158` 和 `sillyspec@3.18.1`，升级需要重新构建镜像。版本不匹配可能导致协议变更失效。
- **Anthropic API 代理**: 默认使用 `open.bigmodel.cn/api/anthropic` 作为 API 代理，如果代理服务不稳定或变更，整个 Agent 功能受影响。

### 🟡 中严重度

- **uv.lock 与 pyproject.toml 同步**: 后端使用 `uv.lock` 但 Dockerfile 中使用 `uv pip install -e .` (无 lock)，注释说 "Lock-less install is acceptable for V1"，生产环境应改为 `uv sync --frozen`。
- **PostgreSQL 版本**: 使用 16-alpine，需关注主要版本升级的兼容性。
- **Redis 持久化**: AOF 模式已启用，但无备份策略，volume 丢失即数据丢失。

### 🟢 低严重度

- **Python 3.12**: 较新版本，部分第三方库兼容性需要关注。
- **Next.js 14**: App Router 仍在快速发展中，升级可能带来 breaking changes。

## 架构风险

### 🟡 中严重度

- **单 Agent Adapter**: 目前只有 `claude_code.py` 一个适配器，如果要支持其他 Agent (如 GPT Code Interpreter) 需要抽象更大的 Adapter 接口。
- **Daemon 多协议复杂度**: 5 种协议后端 (json_rpc, jsonl, ndjson, stream_json, text) 增加了维护负担，每个后端都需要独立测试和维护。
- **Host 路径映射**: 容器内外路径映射 (`HOST_PATH_PREFIX` / `CONTAINER_PATH_PREFIX`) 是潜在的故障点，尤其在跨平台场景。

### 🟢 低严重度

- **SillySpec 工作区数据**: spec 数据存储在 Docker volume 中，无导出/备份机制。
- **Bootstrap Admin**: 明文密码在环境变量中，虽然只在初始化时使用，但仍然不理想。

## 安全风险

### 🟡 中严重度

- **SECRET_KEY 默认值**: `.env.example` 中 SECRET_KEY 为 `change-me-to-a-random-48-char-string`，存在用户忘记修改的风险。
- **CORS 配置**: 开发环境允许 `localhost:3000`，生产部署时需要严格限制。
- **SCAN_DENIED_WRITE_PATHS**: Claude Code hook 依赖环境变量控制写入权限，如果变量未设置则不生效。

### 🟢 低严重度

- **JWT token 存储**: 前端将 access_token 存在 localStorage，存在 XSS 攻击风险。当前项目未上线，风险可控。
