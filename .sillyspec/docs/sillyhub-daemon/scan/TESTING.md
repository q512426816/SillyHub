---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# SillyHub Daemon -- 测试策略

## 测试框架

- **pytest** (版本 >=9.0) 作为测试运行器
- 测试文件位于 `tests/` 目录，命名规则 `test_<module>.py`
- 共 16 个测试文件覆盖所有核心模块

## 测试文件清单

| 测试文件 | 被测模块 | 覆盖范围 |
|----------|----------|----------|
| `test_cli.py` | `__main__.py` | Click CLI 子命令（start/stop/status/logs） |
| `test_client.py` | `client.py` | HubClient HTTP 方法 |
| `test_daemon.py` | `daemon.py` | Daemon 生命周期、WS 消息处理 |
| `test_daemon_multi_runtime.py` | `daemon.py` | 多 Agent 注册流程 |
| `test_task_runner.py` | `task_runner.py` | TaskRunner 核心执行流程 |
| `test_task_runner_provider_dispatch.py` | `task_runner.py` | Provider 分派到正确 backend |
| `test_agent_detector.py` | `agent_detector.py` | Agent 检测与版本解析 |
| `test_backends_init.py` | `backends/__init__.py` | ABC、工厂函数、协议映射 |
| `test_stream_json_backend.py` | `backends/stream_json.py` | stream-json 协议解析 |
| `test_json_rpc.py` | `backends/json_rpc.py` | JSON-RPC 协议解析 |
| `test_jsonl_backend.py` | `backends/jsonl.py` | JSONL 协议解析 |
| `test_ndjson_backend.py` | `backends/ndjson.py` | NDJSON 协议解析 |
| `test_text_backend.py` | `backends/text.py` | 纯文本协议解析 |
| `test_credential.py` | `credential.py` | 凭证 CRUD、占位符渲染 |
| `test_workspace.py` | `workspace.py` | workspace 准备、diff 收集 |
| `test_version.py` | `version.py` | semver 解析、最低版本检查 |

## 测试策略

### 单元测试
- 每个模块有独立测试文件
- Agent 检测测试：mock `shutil.which` 和 `asyncio.create_subprocess_exec`
- HTTP 客户端测试：mock httpx 响应
- Backend 测试：验证各协议的 parse_output 正确解析不同消息类型

### 集成测试
- `test_daemon_multi_runtime.py`：验证多 Agent 同时注册到服务器的完整流程
- `test_task_runner_provider_dispatch.py`：验证 provider 名称正确映射到对应 backend 类

### Mock 策略
- 外部 HTTP 调用：mock `httpx.AsyncClient` 响应
- 子进程调用：mock `asyncio.create_subprocess_exec` 返回预设输出
- 文件系统：使用 `tmp_path` fixture 创建临时目录
- 环境变量：使用 `monkeypatch` 设置/清理

### 测试覆盖重点
- 协议解析的正确性（各 backend 的 parse_output）
- 错误处理路径（超时、进程失败、网络错误）
- 凭证占位符渲染逻辑
- Agent 检测优先级（环境变量 > PATH）
- 版本比较逻辑（低于最低版本时产生警告）

## 运行测试

```bash
cd sillyhub-daemon
python -m pytest tests/ -v
```
