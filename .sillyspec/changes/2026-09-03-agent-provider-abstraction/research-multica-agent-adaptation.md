# 研究文档：multica 多 Agent CLI 适配架构调研（SillyHub 通用接入抽象的参照）

> 调研日期：2026-09-03。对象：本地 `C:\Users\qinyi\IdeaProjects\multica`（github.com/multica-ai/multica）。
> 用途：本变更（agent-provider-abstraction）的设计依据。结论已沉淀进 design.md 与 decisions.md，本文保留完整证据链。

## 1. 数量澄清

README 宣传 23 agent CLIs。实际：`agent.SupportedTypes` 白名单 24 个 provider 键，`qoder/qoderclicn` 共用同一 backend，`New()` 为 23 个实现；另有 `BuiltinRuntimes` 注册表的 `omp`（Oh-My-Pi，复用 pi 协议族）。daemon 实际探测注册的 provider 键共 25 个。

## 2. 六个核心设计决策（按重要性）

### 2.1 协议族 + 统一 Backend 接口（最关键）

23 个 agent 按输出协议归 5 族：

| 协议族 | 传输 | 成员 |
|---|---|---|
| stream-json | NDJSON（Claude 系） | claude / codebuddy / cursor / qwen |
| run --json | 单次 JSON | copilot / opencode / deveco / pi(omp) / openclaw |
| app-server | JSON-RPC 2.0 自有方法 | codex 独占 |
| ACP | JSON-RPC 2.0 over stdio | hermes / kimi / reasonix / kiro / qoder(+cn) / traecli / grok / qwenpaw / dim / mcode / zeroclaw（12 个共享 hermesClient） |
| 私有 stdio 帧 | 自定义 | dsh |

统一接口（`server/pkg/agent/agent.go`）：

```go
type Backend interface { Execute(ctx, prompt, opts) (*Session, error) }
type Session struct { Messages <-chan Message; Result <-chan Result }
// Message 7 型：text/thinking/tool-use/tool-result/status/error/log
// Result：status/output/error/duration/session_id/usage(按模型分桶)/resume_rejected
```

kimi.go 注释直说"复用 hermesClient ACP 传输层，只有二进制、env 和工具名提取不同"——**12 个 agent 吃一份 ACP 客户端实现是其滚雪球的根本**。

### 2.2 能力差异用"数据表 + 默认拒绝"表达，不用接口方法

`MinVersions` 表（仅 8 个 agent 有版本门槛）、`launchPrefixBlockedArgs` 表（协议关键 flag 防覆盖）、前端 `MCP_SUPPORTED_PROVIDERS` 集合（copilot/deveco/antigravity 不在列→隐藏 MCP tab）。新 agent 缺席任何表 = 静默降级，永不报错。

### 2.3 execenv 环境准备层与协议适配分离

`server/internal/daemon/execenv/`：每任务隔离的 CODEX_HOME/CURSOR_DATA_DIR/HERMES_HOME；系统提示投递矩阵（claude→CLAUDE.md，codebuddy→CODEBUDDY.md，qwen→QWEN.md，其余 21 个→AGENTS.md；不读上下文文件的 4 个 openclaw/kimi/traecli/qwenpaw→stdin 内联注入——哪些 CLI 真读文件是金丝雀实测的，版本号记录在 daemon.go:5715 注释）；写入用 marker block 包裹、字节级保留用户原文件、sidecar manifest 可回滚。

### 2.4 三档接入路径

| 档 | 场景 | 成本 |
|---|---|---|
| A. custom runtime profile | 已有族换 wrapper 命令（protocol_family + command_name + fixed_args） | 零代码；flag 黑名单 filterLaunchPrefix 自动剥离协议关键 flag |
| B. BuiltinRuntime 描述符 | 同协议族 fork（omp 之于 pi） | 一个描述符条目 |
| C. 新协议族 backend | 真正的新协议 | 一个实现 + 注册表各处（约 9 处；ACP 系则薄封装几百行） |

### 2.5 单一 spawn 构造点 + 进程组默认值

`launch.go` 的 `Command.exec()/execVia()` 是唯一进程构造点（有测试 TestOnlyLaunchGoSpawnsRuntimeProcesses 强制），默认进程组 + SIGKILL-cancel——Windows 孙子进程泄漏事故（GH #7522，取消后活 40 分钟）用架构解决。

### 2.6 探测/注册/降级独立收敛循环

可用性探测 2min 只增不减（防 PATH 瞬时变窄拆掉在干活的 runtime）；版本刷新 10min；降级需"确认性裁决"（确认过老/二次确认不可执行）+ claim barrier；启动 pin 的绝对路径失效时按裸命令名自愈重找（Homebrew Cask 场景有专门测试）。GUI daemon 不继承登录 shell PATH 的问题用"fork 登录 shell 解析 + 30min 缓存"解决。

## 3. SillyHub 现状对照（调研时点）

| 维度 | multica | SillyHub 现状 |
|---|---|---|
| 统一事件通道 | backend 内归一化 7 型 Message | ✗ 输出侧 driver 透传原始消息，归一化散落两处半（批量 adapter.parse / 交互式 backend _extract_sdk_messages / daemon stream_event 缓冲） |
| 协议族注册表 | 24 键白名单 | ✓/✗ 批量有（6协议×12provider，adapters/index.ts），交互式无（写死 'claude'\|'codex'，interactive/driver.ts） |
| 能力矩阵 | 声明式表+默认拒绝 | ✗ 散落硬编码（前端 session-panel 多处、backend daemon/session/service.py 多处） |
| 环境准备 | execenv 独立层 | ✗ 零散（claude-settings.ts / spawn-env.ts / skill-manager.ts，全 Anthropic 约定） |
| 进程管理 | 单一构造点+进程组 | ✗ SDK 内部 spawn 不可控 + task-runner 直接 spawn |
| 探测自愈 | 只增不减+确认降级+路径自愈 | ✓/✗ agent-detector 12 provider 表已有，自愈无 |
| 三档接入 | 配置/描述符/新实现 | ✗ 无 |

关键锚点（SillyHub 侧）：
- daemon `interactive/driver.ts`——输入侧 UserTurnInput 中性，**输出侧 onTurnMessage 透传 raw**（契约缺口精确位置）；
- `adapters/index.ts`——PROTOCOL_PROVIDERS 6 协议→12 provider 正反向映射 + getBackend 工厂（可复用的既有资产）；
- backend `run_sync/service.py:3446-3716` `_extract_sdk_messages`——Claude SDK 展平为 `[ASSISTANT]/[THINKING]/[TOOL_USE]/[TOOL_RESULT]` 文本协议落库（三端事实契约的制造点）；
- `agent_run_logs`（agent/model.py:465-583）——已有全部结构化列（tool_kind/parent 三列/segment_id/edit_patch/metadata_ JSON）。

## 4. 结构性差异（不可照抄的部分）

multica 是**任务制**（单次 Execute + resume），SillyHub 是**强交互会话制**（长驻会话、SSE 实时流、远程人审批卡、inject 追加输入）。因此：
- 不照抄其 Backend.Execute 单发接口，保留我方 InteractiveDriver 双向契约；
- 我方权限审批链（provider 无关 dialog_kind + 远程人审）是 multica（自动审批）没有的资产，保留；
- 我方 codex 交互式 driver（CodexAppServerDriver，1589 行）已实现，是第二个 provider 的现成素材。

## 5. 对本变更的直接映射

| multica 决策 | 本变更落点 |
|---|---|
| 统一事件通道 | P1 AgentEvent v2（design §5.1） |
| 协议族注册表 | P2 providers.ts（design §5.2；family 字段复用 adapters 既有 6 协议联合） |
| 能力表+默认拒绝 | P2 ProviderCaps（design §5.2） |
| execenv | 非目标，注册表预留 envKeys/contextFile 字段位 |
| 单一 spawn 构造点 | 非目标（与"不弃 SDK"决策联动，后续优化） |
| 探测自愈 | 非目标（agent-detector 已有表，自愈留后续） |
| 三档接入路径 | docs/agent-provider-onboarding.md（design §5.2） |

## 6. multica 新增一个 agent 的完整清单（路线 C，照抄备查）

1. `server/pkg/agent/<name>.go` 实现 Backend（ACP 系薄封装 hermesClient，参考 kimi.go：blocked args + stderr 嗅探 + 差异字段）；声明 `<name>BlockedArgs`
2. `agent.go`：New() 加 case、SupportedTypes 加键、launchHeaders 加映射；`launch.go:443` launchPrefixBlockedArgs 加映射
3. `agent_supported_types_test.go` 白名单测试同步
4. DB migration 放宽 runtime_profile.protocol_family CHECK 约束
5. `version.go` MinVersions（需要时）
6. `daemon/agents_probe.go` 加 probe 段（MULTICA_<ID>_PATH/_MODEL）
7. `daemon/execenv/runtime_config.go` runtimeConfigPath 加 case；需要则新增 execenv/<name>_*.go preparer
8. `daemon/runtime_mcp.go` 支持 MCP 则两处加 case
9. `agent/models.go` ListModels 加 case
10. 前端 RUNTIME_PROFILE_PROTOCOL_FAMILIES、MCP_SUPPORTED_PROVIDERS、display 元数据同步
