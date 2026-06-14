---
author: qinyi
created_at: 2026-06-13T23:54:04+0800
---

# Design — SillyHub Daemon Python → Node.js 重写

> 变更：`2026-06-13-daemon-nodejs-rewrite`
> 方案：**方案B（协议抽象 + Wave 增量交付）**
> 角色：资深系统架构师（决策附理由、列 trade-off，不确定即标注）

---

## 1. 背景

`sillyhub-daemon` 是 SillyHub 平台的本地守护进程：连接 backend（FastAPI）的 daemon 通道，接收 `task_available` 任务，在本地 workspace 内调用 12 种 agent CLI（claude / codex / copilot / gemini / cursor …）执行，流式回传执行消息，最后提交 git diff patch。

当前实现为 **Python 3.12**（源码 ~4059 行 + 测试 ~6660 行，17 个测试文件）。本 monorepo 的其它子项目均为 TS/JS（backend 用 Python 是唯一例外，daemon 是第二个 Python 项目）。重写为 Node.js 的动机：

- **栈统一**：除 backend 外，frontend / multi-agent-platform / 未来 tooling 均 TS。daemon 转向 Node 后，除核心 backend 外全栈统一，降低维护与招聘成本。
- **部署统一**：当前 Docker 镜像需为 daemon 单独装 Python 运行时；Node 化后可与 frontend 共用基础镜像，缩小镜像体积与构建链。
- **原生异步契合**：daemon 本质是 I/O 密集（WebSocket 长连 + 子进程流 + HTTP），Node 事件循环 + 流式 stdout 天然契合，比 asyncio 的 `create_subprocess_exec` + `async for line` 更直接。
- **依赖收敛**：原生 `fetch`、原生 WebSocket（Node 20）、原生 `node:test`，第三方依赖可压到极少（`ws` / `commander` 等）。

---

## 2. 设计目标

| 编号 | 目标 | 验证方式 |
|---|---|---|
| G-01 | **功能等价**：Node 版与 Python 版对外行为 1:1（agent 执行、消息流、diff 收集、lease 生命周期） | 1:1 迁移 Python 测试用例 + 真实 backend 冒烟 |
| G-02 | **契约不变**：与 `backend/app/modules/daemon/protocol.py` 的 WS 消息类型、REST 端点、lease 状态机逐字对齐 | 契约单测 + 冒烟走通一次完整 lease |
| G-03 | **协议可扩展**：新增一种 agent 协议只需新增一个 adapter，不动编排/通信层 | W1 之后用 mock adapter 验证扩展点 |
| G-04 | **增量可交付**：每 Wave 可独立编译/测试/冒烟，不依赖后续 Wave | 每 Wave `tsc + vitest` 双绿 |
| G-05 | **零/极少运行时依赖** | `package.json dependencies` 数量受控 |

---

## 3. 非目标（明确不做，防止 scope creep）

- **N-01**：不改 backend 端 `protocol.py` / daemon REST 端点。Node 版迁就 backend，反之不可。
- **N-02**：不在本次重写中新增功能（不增加新 provider、不改 credential 文件格式、不改 git mirror 策略）。
- **N-03**：不做 daemon 的高可用/集群/水平扩展（仍是单机守护进程，每 agent 一个 runtime_id）。
- **N-04**：不重写 backend（Python）。backend Python 化仅在 monorepo 长期规划中，与本变更无关。
- **N-05**：不引入 ORM/数据库（daemon 不直接碰 DB，credential.json/config.json 文件存储不变）。
- **N-06**：不做性能压测优化（等价即可，不追求超越 Python 版的吞吐）。

---

## 4. 拆分判断

为什么是**独立变更**而非批量/嵌入其它变更：

- 影响面是整个 `sillyhub-daemon` 子项目（16 模块全部重写），与任何在途变更无耦合。
- 需要独立的 Wave 增量交付与逐 Wave 验收，不适合塞进 quick 流程。
- 变更边界清晰（仅 `sillyhub-daemon/` 目录），不触碰 `backend/`、`frontend/`。

为什么是**方案B（协议抽象 + Wave 增量交付）**而非「大爆炸一次性替换」：

- Python 版已沉淀了正确的抽象骨架（`AgentBackend(ABC)` + `get_backend()` 工厂 + `PROTOCOL_PROVIDERS` 映射）。方案B 在迁移同时**深化**这层抽象，把「通用流程」与「协议差异」彻底分离，使重写不是逐行翻译而是结构升级。
- Wave 分解让风险（尤其 5 个协议解析器共占源码大头）被分摊到可独立验证的单元，避免「写完几千行才能跑」的高风险集成。

---

## 5. 总体方案（分 Wave 增量交付）

### 5.1 分层架构（Node 版）

```
┌─ CLI (commander) ──────────────── start / stop / status / logs
├─ Daemon 主类 ──────────────────── register→心跳循环→事件分发→5s 重连+HTTP 轮询兜底
├─ 通信层 ───────────────────────── HubClient(REST,fetch) + WsClient(ws, 心跳+重连)
├─ TaskRunner 编排 ──────────────── workspace→CLAUDE.md→credential(0600)→backend→diff→submit
├─ ★ ProtocolAdapter 抽象层 ─────── parse(line)→AgentEvent IR + onControl(stdin)
└─ 5 Adapter (12 provider) ──────── stream_json/json_rpc/jsonl/ndjson/text
```

**方案B 核心深化点**：Python 版的 `AgentBackend` 同时承担「执行子进程」和「解析输出」两职。Node 版拆开——子进程执行（spawn/stdin/env/diff）下沉到 `TaskRunner` 唯一一处；adapter 只保留纯解析职责 `parse(line)`，输出统一中间表示 `AgentEvent`。新增协议 = 新增一个 parse 实现，零侵入编排层。

### 5.2 Wave 路线图

| Wave | 内容 | 依赖 | 验收门槛 |
|---|---|---|---|
| **W0** | 项目骨架：`package.json`/`tsconfig`(strict)/目录/类型定义(AgentEvent·TaskResult·DaemonMessage·Lease payload)/`vitest` 脚手架 | — | `tsc` 通过 + 脚手架编译 |
| **W1** ★ | **协议抽象层**：`ProtocolAdapter` 接口 + 5 adapter + provider→protocol 映射 + `getBackend` 工厂 | W0 | 5 adapter 单测（复用 Python fixture）双绿 |
| **W2** | 基础设施：`config` / `credential`(0600+占位符) / `version` / `workspace`(git mirror) / `agent_detector`(12 provider) | W0 | 单测双绿 |
| **W3** | 通信层：`HubClient`(REST,fetch) + `WsClient`(ws, 5s 重连, HTTP 轮询兜底)，严格对齐 protocol.py | W2 | 契约 mock 测试 |
| **W4** | 编排层：`TaskRunner` 编排链 + `Daemon` 主类生命周期(task_available→claim→start→messages→complete) | W1+W3 | 端到端 mock 流程测试 |
| **W5** | CLI(commander) + 真实 backend 冒烟；冒烟通过后删除 Python 源码 `sillyhub_daemon/` | W4 | 真实一次 lease 全流程 |

依赖方向：`W0 → (W1 ‖ W2) → W3 → W4 → W5`。每 Wave 单测绿即推进。

---

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/package.json` | Node 工程元数据，依赖 `ws`/`commander`，devDep `typescript`/`vitest`/`@types/ws` |
| 新增 | `sillyhub-daemon/tsconfig.json` | strict 模式，target ES2022，module NodeNext |
| 新增 | `sillyhub-daemon/vitest.config.ts` | 测试配置，1:1 迁移 Python 测试 fixture 目录 |
| 新增 | `sillyhub-daemon/src/types.ts` | AgentEvent/TaskResult/DaemonMessage/Lease payload 类型 |
| 新增 | `sillyhub-daemon/src/protocol.ts` | WS 消息常量（对齐 backend protocol.py） |
| 新增 | `sillyhub-daemon/src/adapters/protocol-adapter.ts` | `ProtocolAdapter` 抽象接口 + AgentEvent IR 定义 |
| 新增 | `sillyhub-daemon/src/adapters/stream-json.ts` | 替代 `backends/stream_json.py`（claude/gemini/cursor） |
| 新增 | `sillyhub-daemon/src/adapters/json-rpc.ts` | 替代 `backends/json_rpc.py`（codex/hermes/kimi/kiro） |
| 新增 | `sillyhub-daemon/src/adapters/jsonl.ts` | 替代 `backends/jsonl.py`（copilot） |
| 新增 | `sillyhub-daemon/src/adapters/ndjson.ts` | 替代 `backends/ndjson.py`（opencode/openclaw/pi） |
| 新增 | `sillyhub-daemon/src/adapters/text.ts` | 替代 `backends/text.py`（antigravity） |
| 新增 | `sillyhub-daemon/src/adapters/index.ts` | `getBackend()` 工厂 + `PROTOCOL_PROVIDERS` 映射，替代 `backends/__init__.py` |
| 新增 | `sillyhub-daemon/src/config.ts` | 替代 `config.py`（DaemonConfig + config.json） |
| 新增 | `sillyhub-daemon/src/credential.ts` | 替代 `credential.py`（0600 + `{{USER_*}}` 渲染） |
| 新增 | `sillyhub-daemon/src/workspace.ts` | 替代 `workspace.py`（git mirror/pull/diff） |
| 新增 | `sillyhub-daemon/src/agent-detector.ts` | 替代 `agent_detector.py`（12 provider 探测） |
| 新增 | `sillyhub-daemon/src/version.ts` | 替代 `version.py`（semver 检查） |
| 新增 | `sillyhub-daemon/src/hub-client.ts` | 替代 `client.py`（REST lease 生命周期） |
| 新增 | `sillyhub-daemon/src/ws-client.ts` | WS 客户端（5s 重连 + HTTP 轮询兜底） |
| 新增 | `sillyhub-daemon/src/task-runner.ts` | 替代 `task_runner.py`（编排链 + 子进程执行） |
| 新增 | `sillyhub-daemon/src/daemon.ts` | 替代 `daemon.py`（Daemon 主类生命周期） |
| 新增 | `sillyhub-daemon/src/cli.ts` | 替代 `__main__.py`（commander: start/stop/status/logs） |
| 新增 | `sillyhub-daemon/tests/**/*.test.ts` | 1:1 迁移 17 个 Python 测试文件（~6660 行用例） |
| 删除 | `sillyhub-daemon/sillyhub_daemon/**` | Python 源码，W5 冒烟通过后删除 |
| 删除 | `sillyhub-daemon/pyproject.toml` | Python 构建配置，W5 后删除 |
| 修改 | `deploy/docker-compose*.yml`（如涉及 daemon 镜像） | 切换 daemon 运行时基础镜像（Python→Node），W5 处理 |
| 不变 | `backend/app/modules/daemon/**` | backend 对端协议、REST 端点**完全不动** |

---

## 7. 接口定义（代码类任务，必填）

### 7.1 统一中间表示 AgentEvent（IR）

```ts
// src/adapters/protocol-adapter.ts
export type AgentEventType =
  | 'text' | 'tool_use' | 'tool_result' | 'error' | 'complete';

export interface AgentEvent {
  type: AgentEventType;
  content: string;            // 文本/工具入参/工具结果/错误信息
  metadata?: Record<string, unknown>; // session_id / usage tokens / tool name 等
}
```

### 7.2 ProtocolAdapter 抽象接口（方案B 核心）

```ts
export interface ProtocolAdapter {
  /** provider 标识（claude/codex/copilot/...） */
  readonly provider: string;
  /**
   * 解析子进程 stdout 的一行，返回 0..N 个 AgentEvent（IR）。
   * 协议差异 100% 收敛于此方法。返回 null 表示该行不产生事件。
   */
  parse(line: string): AgentEvent[] | null;
  /**
   * 可选：对子进程 stdin 的 control_request 应答器
   *（如 stream_json 的工具批准）。默认 no-op。
   */
  onControl?(stdin: NodeJS.WritableStream): void;
}

/** 子进程执行结果（通用，由 TaskRunner 统一生成） */
export interface BackendExecResult {
  status: 'completed' | 'failed' | 'timeout';
  output: string;
  error?: string;
  sessionId?: string;
}
```

### 7.3 工厂与映射

```ts
// src/adapters/index.ts
export const PROTOCOL_PROVIDERS: Record<string, string[]> = {
  stream_json: ['claude', 'gemini', 'cursor'],
  json_rpc: ['codex', 'hermes', 'kimi', 'kiro'],
  jsonl: ['copilot'],
  ndjson: ['opencode', 'openclaw', 'pi'],
  text: ['antigravity'],
};

export function getBackend(provider: string): ProtocolAdapter { /* 懒加载 */ }
```

### 7.4 通信契约（逐字对齐 backend protocol.py）

```ts
// src/protocol.ts —— 与 backend/app/modules/daemon/protocol.py 同步
export const MSG = {
  // server → daemon
  TASK_AVAILABLE: 'daemon:task_available',
  HEARTBEAT: 'daemon:heartbeat',
  HEARTBEAT_ACK: 'daemon:heartbeat_ack',
  // daemon → server
  REGISTER: 'daemon:register',
  LEASE_CLAIM: 'daemon:lease_claim',
  LEASE_START: 'daemon:lease_start',
  LEASE_COMPLETE: 'daemon:lease_complete',
  LEASE_MESSAGES: 'daemon:lease_messages',
} as const;
```

### 7.5 lease 编排骨架（TaskRunner 核心）

```ts
// src/task-runner.ts
export class TaskRunner {
  async executeTask(leaseId: string, token: string, payload: LeaseCtx): Promise<TaskResult> {
    // 1. workspace 准备（git mirror + pull --ff-only）
    const workDir = await this.workspace.prepare(payload.workspaceName, payload.repoUrl, payload.branch);
    // 2. 写 CLAUDE.md
    await this.workspace.writeClaudeMd(workDir, payload.claudeMd);
    // 3. credential 渲染（0600 文件 → 环境变量）
    const env = { ...process.env, ...this.credential.buildEnv(payload.toolConfig) };
    // 4. 按 provider 取 adapter（方案B 抽象）
    const adapter = getBackend(payload.provider);
    // 5. 子进程执行（spawn + stdin 不关闭 + 逐行 parse → IR → submit_messages）
    const exec = await this.spawnAndStream(adapter, payload.cmd, workDir, env, payload, (ev) =>
      this.hubClient.submitMessages(leaseId, token, payload.agentRunId, [this.eventToMessage(ev)]));
    // 6. git diff 收集
    const diff = await this.workspace.collectDiff(workDir);
    // 7. 结果
    return { success: exec.status === 'completed', patch: diff.patch,
             filesChanged: diff.filesChanged, output: exec.output, error: exec.error };
  }
}
```

---

## 8. 数据模型

**无数据库表变更**（daemon 不直接操作 DB，N-05）。

涉及两份本地文件存储，**格式保持不变**（契约约束）：

- `~/.sillyhub/daemon/config.json`：`DaemonConfig`（server_url / token / runtime_id[]）。
- `~/.sillyhub/daemon/credentials.json`：`Record<string, string>`（GITHUB_TOKEN / OPENAI_API_KEY …），权限 `0600`。
- `~/.sillyhub/daemon/daemon.pid` / `daemon.log`：进程 PID 与日志，路径不变。

---

## 9. 兼容策略（brownfield，必填）

| 维度 | 策略 |
|---|---|
| **backend 对端** | 完全不变（N-01）。Node daemon 严格适配现有 WS 消息类型与 REST 端点，backend 无感知切换。 |
| **回退路径** | Python 版 `sillyhub_daemon/` 在 W0–W4 全程保留并可运行；**仅在 W5 真实冒烟通过后才删除**。任何 Wave 发现不可调和的契约偏差，可立即回退 Python 版，不影响线上。 |
| **不变项** | credential.json/config.json 格式、git mirror 工作区策略、`{{USER_*}}` 占位符语义、CLI 命令名(start/stop/status/logs)、lease 生命周期、12 provider 探测优先级（env→PATH）。 |
| **行为不变** | 未配置新 provider 时行为与 Python 版一致；WS 断线 5s 重连 + HTTP 轮询兜底策略保留。 |
| **未上线免责** | 本项目未正式上线（项目铁律 7），数据可清空，无需做版本迁移/双写/灰度。 |

---

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 5 种协议解析逻辑翻译偏差，导致事件流/usage 统计与 Python 版不一致 | **P0** | 1:1 迁移 Python 测试 fixture，W1 每个 adapter 必须吃下 Python 版的同款样本并产出等价 AgentEvent |
| R-02 | WS 消息类型/lease 状态机与 backend 对端漂移 | **P0** | `protocol.ts` 从 backend `protocol.py` 逐字拷贝常量；W3 契约单测断言全部消息类型字符串；W5 真实冒烟走通完整 lease |
| R-03 | stdin control_request 应答（stream_json 自动批准工具）丢失，导致子进程 hang | **P1** | `ProtocolAdapter.onControl` 显式建模；保留「stdin 不关闭」语义并加超时看门狗测试 |
| R-04 | 子进程流式 stdout 在 Node 下背压/编码处理与 Python `async for line` 不同（如不完整行、二进制） | **P1** | 用 `readline` / 手动 buffer 切行；单测覆盖跨行 JSON、空行、非 UTF-8 噪声 |
| R-05 | credential 文件 0600 权限在 Node 下设置方式不同（`fs.chmod`）且跨平台（Windows 无 0600） | **P2** | `fs.chmod(0o600)`，Windows 降级为「仅警告不报错」，单测验证 POSIX 权限位 |
| R-06 | git mirror 依赖系统 git，子进程错误处理差异 | **P2** | 复用 Python 版错误分支用例；Windows rmtree 兼容沿用现有策略 |
| R-07 | 重写期间 Python 版与 Node 版并存导致 Docker 构建/入口混乱 | **P2** | W5 前 Python 版不进新镜像；W5 切换入口并删除 Python 源码，单点切换 |
| R-08 | vitest 与 pytest 用例语义不对齐（异步/fixture 机制差异） | **P2** | 逐用例核对断言，fixture 文本样本共用，不追求测试代码行数 1:1，只求行为覆盖 1:1 |

---

## 11. 自审（AI 对自身设计的校验）

| 检查项 | 结果 | 说明 |
|---|---|---|
| **需求覆盖** | ✅ 通过 | 方案B 的两个要素（协议抽象、Wave 增量）均落地：§5.1 抽象深化、§5.2 六 Wave；12 provider / 5 协议 / lease 生命周期 / 0600 / git mirror 全覆盖 |
| **约束一致性** | ✅ 通过 | 与 scan 文档一致：`AgentBackend(ABC)`→`ProtocolAdapter`、`get_backend()` 工厂→`getBackend()`、`PROTOCOL_PROVIDERS` 映射保留、WS 5s 重连、protocol.py 双端同步、命名 PascalCase（TS class）/ 私有单下划线思路映射为 TS private |
| **真实性** | ✅ 通过 | 所有类名/方法名/路径/常量均来自真实代码（`sillyhub_daemon/`、`backend/app/modules/daemon/protocol.py`、scan ARCHITECTURE.md）；新增项已标注「替代 xxx.py」 |
| **YAGNI** | ✅ 通过 | 非目标 N-01~N-06 显式排除新功能/HA/DB/性能优化；依赖压到 `ws`+`commander`，无冗余框架 |
| **验收标准** | ✅ 通过 | 每 Wave 有明确门槛（tsc+vitest 双绿 / 契约单测 / 端到端 mock / 真实冒烟），G-01~G-05 可验证 |
| **非目标清晰** | ✅ 通过 | §3 六条非目标，边界明确 |
| **兼容策略** | ✅ 通过 | §9 给出对端不变、回退路径（Python 版保留至 W5）、不变项清单；项目未上线免责 |
| **风险识别** | ✅ 通过 | R-01~R-08 覆盖协议翻译/契约漂移/stdin hang/流背压/权限/跨平台/构建/测试对齐，P0 两项有强应对（fixture 复用 + 契约断言 + 真实冒烟） |

**自审结论**：8 项全部通过，无「⚠️ 自审存疑」项。设计具备进入规范文件生成（Step 11）的条件。
