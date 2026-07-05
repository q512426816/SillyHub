---
author: qinyi
created_at: 2026-06-09 22:55:00
---

# 设计文档：Daemon Agent 检测体系扩展

## 背景

当前 daemon 模块只硬编码检测 2 种 agent（claude-code、sillyspec），`provider` 字段固定为 `"claude-code"`。
参考 multica 项目（Go 实现），它支持 12 种 agent provider，每种有独立的二进制检测、版本校验、执行协议。

用户本地安装了多种 agent（codex、cursor 等），但当前 daemon 只能识别 claude-code，无法利用其他 agent。

## 设计目标

1. 支持 12 种 agent provider 的二进制检测（含环境变量覆盖）
2. 每种检测到的 agent 分别注册为独立 runtime
3. 按执行协议分类（NDJSON / JSON-RPC / 纯文本），TaskRunner 按 provider 类型分发执行
4. 前端 runtimes 页面展示 provider 类型和版本信息
5. 版本校验：对关键 agent 设最低版本要求

## 非目标

- 不做模型发现（multica 的 ListModels / thinking level）— V2 再说
- 不做 MCP 配置注入 — V2 再说
- 不做 login-shell fallback（Windows 不适用）— 用 `shutil.which` + 环境变量覆盖即可
- 不做 ACP 协议的完整实现（hermes/kimi/kiro 简化为 JSON-RPC 基础支持）

## 总体方案

参考 multica 的 `server/pkg/agent/agent.go` 工厂模式 + `server/internal/daemon/config.go` 探测逻辑，
在 Python 中实现等价架构。

### Phase 1：Agent 检测体系（sillyhub-daemon）

扩展 `AgentDetector`，支持 12 种 agent：

| Provider | 二进制名 | 环境变量覆盖 | 执行协议 |
|----------|---------|------------|---------|
| claude | `claude` | `SILLYHUB_CLAUDE_PATH` | NDJSON stream-json |
| codex | `codex` | `SILLYHUB_CODEX_PATH` | JSON-RPC 2.0 (stdio) |
| copilot | `copilot` | `SILLYHUB_COPILOT_PATH` | JSONL 点分事件 |
| opencode | `opencode` | `SILLYHUB_OPENCODE_PATH` | 流式 JSON 行 |
| openclaw | `openclaw` | `SILLYHUB_OPENCLAW_PATH` | NDJSON |
| hermes | `hermes` | `SILLYHUB_HERMES_PATH` | JSON-RPC 2.0 (ACP) |
| gemini | `gemini` | `SILLYHUB_GEMINI_PATH` | NDJSON stream-json |
| pi | `pi` | `SILLYHUB_PI_PATH` | NDJSON |
| cursor | `cursor-agent` | `SILLYHUB_CURSOR_PATH` | NDJSON stream-json |
| kimi | `kimi` | `SILLYHUB_KIMI_PATH` | JSON-RPC 2.0 (ACP) |
| kiro | `kiro-cli` | `SILLYHUB_KIRO_PATH` | JSON-RPC 2.0 (ACP) |
| antigravity | `agy` | `SILLYHUB_ANTIGRAVITY_PATH` | 纯文本 stdout |

**版本最低要求**：

| Provider | 最低版本 |
|----------|---------|
| claude | 2.0.0 |
| codex | 0.100.0 |
| copilot | 1.0.0 |
| 其他 | 无要求 |

### Phase 2：Daemon 注册改造（sillyhub-daemon）

当前 daemon.py 硬编码 `provider="claude-code"` 注册一个 runtime。
改为：遍历检测到的 agent 列表，**每个 agent 分别注册一个 runtime**，上报各自的 provider、版本、capabilities。

### Phase 3：执行协议层（sillyhub-daemon）

抽象 `AgentBackend` 接口，按协议类型实现：
- `StreamJsonBackend`：claude, gemini, cursor（`--output-format stream-json`）
- `JsonRpcBackend`：codex, hermes, kimi, kiro（stdio JSON-RPC 2.0）
- `JsonlBackend`：copilot（JSONL 点分事件名）
- `NdjsonBackend`：opencode, openclaw, pi（NDJSON 行）
- `TextBackend`：antigravity（纯文本 stdout）

### Phase 4：后端 Schema + 前端展示

后端 `daemon_runtimes` 表已有 `provider` 字段，无需迁移。
前端 runtimes 页面增加 provider 图标/标签展示。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 修改 | `sillyhub-daemon/sillyhub_daemon/agent_detector.py` | 扩展为 12 种 agent 检测，支持环境变量覆盖 |
| 修改 | `sillyhub-daemon/sillyhub_daemon/daemon.py` | 多 runtime 注册循环 |
| 新增 | `sillyhub-daemon/sillyhub_daemon/backends/__init__.py` | AgentBackend 抽象接口 |
| 新增 | `sillyhub-daemon/sillyhub_daemon/backends/stream_json.py` | claude/gemini/cursor NDJSON 协议 |
| 新增 | `sillyhub-daemon/sillyhub_daemon/backends/json_rpc.py` | codex/hermes/kimi/kiro JSON-RPC 协议 |
| 新增 | `sillyhub-daemon/sillyhub_daemon/backends/jsonl.py` | copilot JSONL 协议 |
| 新增 | `sillyhub-daemon/sillyhub_daemon/backends/ndjson.py` | opencode/openclaw/pi NDJSON 协议 |
| 新增 | `sillyhub-daemon/sillyhub_daemon/backends/text.py` | antigravity 纯文本协议 |
| 新增 | `sillyhub-daemon/sillyhub_daemon/version.py` | semver 解析 + 最低版本校验 |
| 修改 | `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 按 provider 类型选择 backend 执行 |
| 修改 | `sillyhub-daemon/sillyhub_daemon/client.py` | 支持 runtime_id 参数注册 |
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | 增加 provider 标签展示 |
| 修改 | `frontend/src/lib/daemon.ts` | 增加 provider 相关类型 |

## 接口定义

### AgentBackend（Python 抽象基类）

```python
class AgentBackend(ABC):
    provider: str

    @abstractmethod
    async def execute(self, cmd_path: str, task_prompt: str, work_dir: str, env: dict) -> TaskResult:
        """Execute agent CLI and return structured result."""

    @abstractmethod
    async def parse_output(self, line: str) -> AgentEvent | None:
        """Parse a single output line into a structured event."""
```

### AgentDetector 新接口

```python
AGENT_DEFS: dict[str, AgentDef] = {
    "claude":       AgentDef(bin="claude",       env_path="SILLYHUB_CLAUDE_PATH",       version_pattern=r"Claude Code (\d+\.\d+\.\d+)", protocol="stream_json"),
    "codex":        AgentDef(bin="codex",        env_path="SILLYHUB_CODEX_PATH",        version_pattern=r"(\d+\.\d+\.\d+)",              protocol="json_rpc"),
    "copilot":      AgentDef(bin="copilot",      env_path="SILLYHUB_COPILOT_PATH",      version_pattern=r"(\d+\.\d+\.\d+)",              protocol="jsonl"),
    "opencode":     AgentDef(bin="opencode",     env_path="SILLYHUB_OPENCODE_PATH",     version_pattern=r"(\d+\.\d+\.\d+)",              protocol="ndjson"),
    "openclaw":     AgentDef(bin="openclaw",     env_path="SILLYHUB_OPENCLAW_PATH",     version_pattern=r"(\d+\.\d+\.\d+)",              protocol="ndjson"),
    "hermes":       AgentDef(bin="hermes",       env_path="SILLYHUB_HERMES_PATH",       version_pattern=r"(\d+\.\d+\.\d+)",              protocol="json_rpc"),
    "gemini":       AgentDef(bin="gemini",       env_path="SILLYHUB_GEMINI_PATH",       version_pattern=r"(\d+\.\d+\.\d+)",              protocol="stream_json"),
    "pi":           AgentDef(bin="pi",           env_path="SILLYHUB_PI_PATH",           version_pattern=r"(\d+\.\d+\.\d+)",              protocol="ndjson"),
    "cursor":       AgentDef(bin="cursor-agent", env_path="SILLYHUB_CURSOR_PATH",       version_pattern=r"(\d+\.\d+\.\d+)",              protocol="stream_json"),
    "kimi":         AgentDef(bin="kimi",         env_path="SILLYHUB_KIMI_PATH",         version_pattern=r"(\d+\.\d+\.\d+)",              protocol="json_rpc"),
    "kiro":         AgentDef(bin="kiro-cli",     env_path="SILLYHUB_KIRO_PATH",         version_pattern=r"(\d+\.\d+\.\d+)",              protocol="json_rpc"),
    "antigravity":  AgentDef(bin="agy",          env_path="SILLYHUB_ANTIGRAVITY_PATH",  version_pattern=r"(\d+\.\d+\.\d+)",              protocol="text"),
}

@dataclass
class AgentDef:
    bin: str
    env_path: str
    version_pattern: str
    protocol: str
    min_version: str | None = None

@dataclass
class DetectedAgent:
    name: str
    bin_path: str
    version: str | None
    protocol: str
    available: bool
```

### 版本校验

```python
MIN_VERSIONS: dict[str, str] = {
    "claude": "2.0.0",
    "codex": "0.100.0",
    "copilot": "1.0.0",
}

def check_min_version(provider: str, version: str) -> str | None:
    """Return error message if version below minimum, else None."""
```

## 数据模型

无数据库迁移。`daemon_runtimes` 表已有 `provider` 字段（VARCHAR），直接存储 provider 名称。
`capabilities` JSON 字段已有，扩展 `agents` 数组内容即可。

## 兼容策略

- 未安装新 agent 时行为不变（只检测到已有的 claude）
- 向后兼容：旧 daemon 注册仍按 `provider="claude-code"`，新 daemon 按 provider 名注册
- 前端不依赖 provider 的具体值，用 Badge 展示任意字符串
- 后端 API 无变更

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|------|------|------|---------|
| R-01 | 各 agent CLI 输出格式不稳定 | P1 | 版本校验 + 每种协议有 fallback 解析 |
| R-02 | agent 数量多时注册请求量大 | P2 | 合并为单次批量注册 API（V2） |
| R-03 | Windows 下某些 agent 二进制名不同 | P1 | 环境变量覆盖机制兜底 |

## 自审

- [x] 需求覆盖：12 种 provider 检测、多 runtime 注册、执行协议分类、前端展示
- [x] 约束一致性：遵循现有 daemon 模块架构，Python asyncio 风格
- [x] 真实性：所有文件路径和类型来自真实代码
- [x] YAGNI：不做模型发现、MCP 注入、login-shell fallback
- [x] 兼容策略：无数据库迁移，旧 daemon 仍可注册
- [x] 风险识别：已识别 3 项风险及对策
