---
author: qinyi
created_at: 2026-10-10 23:52:54
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-10-10-all-engines-mcp-injection

## 背景

平台会话的 MCP 注入（platform ∪ workspace 三件套 + 内置 `sillyhub-daemon` 编排 5 工具 + `sillyhub-file` 上传 2 工具）当前仅 claude 引擎可用：daemon 侧谓词写死 `provider !== 'claude' → false`（sillyhub-daemon/src/cli.ts:993-997），pi/codex/cursor 会话即使被预取了 MCP bundle（sillyhub-daemon/src/daemon.ts:9175-9228 `mcpStep` 引擎无关预取）也无人消费。历史原因：pi 接入时基线为 0.81.1（sillyhub-daemon/src/pi-settings.ts:7），当时 pi 官方明确"不做 MCP"，能力矩阵如实标记 pi.mcp=false（sillyhub-daemon/src/interactive/providers.ts:243-245）；codex driver 对 mcpServers 仅暂存不消费（sillyhub-daemon/src/interactive/providers.ts:226-228，注释"另立后续变更"）；cursor CLI 无 per-session MCP 通道（sillyhub-daemon/src/interactive/providers.ts:276-277）。

2026-10-01 pi 1.0 发布，官方反转加入 MCP 支持（adapter 扩展生态，配置读 `.mcp.json`），"pi 无原生 MCP"的前提失效。用户拍板：升级 pi 基线走原生 MCP（路线 A），且不止 pi——所有引擎一起打通，让 claude code 之外的引擎在平台会话里同样能上传文件到平台、使用编排工具。

## 设计目标

1. 平台交互式会话（普通/主控）在 claude / pi / codex / cursor 四引擎下均消费平台 MCP 注入——其中 cursor 通道以 SPIKE-02 实测结论为准、不可行时如实暂缺（见目标 4），其余引擎为无条件承诺；配置面与 claude 现状完全一致（三层合并 + 白名单 + `MCP_SESSION_ID` env 注入 + profile mcpRefs 过滤，零语义偏差）。
2. pi 通道：宿主 pi 二进制升级到 1.0+，MCP 配置经 per-session `PI_CODING_AGENT_DIR` 隔离落盘，vendored 扩展（ask-user/subagent）与既有 rpc 会话链路（resume/fork/事件流）在 1.0 下不回归。
3. codex 通道：MCP 配置写入 per-session `CODEX_HOME/config.toml` 托管段，app-server 协议模式下实测生效。
4. cursor 通道：SPIKE 实测决定翻值或如实暂缺，禁止无证据翻值。
5. 能力矩阵三端同步：daemon 单源翻值 → `gen-provider-caps.mjs` 产物刷新 → backend/frontend 对齐守护测试通过。
6. 端到端验收：每个翻值引擎在平台会话内实测 `upload_file` 上传文件成功 + 编排工具可见可调。

## 非目标

- 分身（mission_worker）会话的引擎放开——循既有决策 D-008@v1（.sillyspec/knowledge/decisions/sillyhub_daemon_mcp.md）维持 claude-only，另议另立变更。
- 非 MCP 的其他能力矩阵缺口补齐（codex multimodal/attachments、cursor multimodal 等）。
- daemon↔backend 协议、backend 端点/schema、frontend 手写 UI 的任何改动。
- MCP SDK 锁线变动（backend `mcp>=1.29,<2` 与 daemon `@modelcontextprotocol/sdk ^1.29.0` 联动条款维持，见 .sillyspec/knowledge/known-issues.md "mcp Python SDK 锁死 v1 线"）。
- 宿主机器 pi 二进制的自动安装/升级（daemon 只做版本检测 + 能力降级 + 部署指引）。

## 拆分判断

本变更为单一目标（全引擎 MCP 注入）下的三引擎并行通道 + 一个公共谓词层，文件集互不重叠（每引擎一个 driver + 一个 settings writer），适合单变更内按 Wave 编排（SPIKE 前置 → 公共谓词 → 各引擎通道 → 翻值同步 → 端到端验收），不走批量模式。SPIKE 截断预案（D-003/D-004/D-006）保证任一引擎失败不阻塞其余引擎收口。

## 总体方案

### Phase 0 — SPIKE（前置闸，全部实测留档到本变更目录 spike-*.md）

- **SPIKE-00（pi 1.0 兼容总探，P0）**：宿主安装 pi 1.0+ 后实测：① `--mode rpc` 事件流形状 / `--session-dir` / fork 与 vendored 基线协议兼容性（对照 sillyhub-daemon/src/interactive/pi-rpc-driver.ts:221 R-02 注释）；② vendored ask-user / subagent 扩展在 1.0 ExtensionAPI 下可装载（`--extension` 通道）；③ pi 1.0 MCP 消费形态实测——原生配置键 vs 官方 pi-mcp-adapter（读 `.mcp.json`）vs 均不可用，及配置文件定位与 `PI_CODING_AGENT_DIR` 目录重定向（sillyhub-daemon/src/pi-settings.ts:8-10）的相互作用。
- **SPIKE-01（codex app-server MCP 生效性，P0）**：per-session CODEX_HOME 的 config.toml 写入 `[mcp_servers.*]` 后，`codex app-server --listen stdio://` 协议模式下工具是否进入 thread 工具面（initialize params `capabilities.experimentalApi=true` 已放开的方法面上找 MCP 相关通知/工具列表）。
- **SPIKE-02（cursor headless MCP，P1）**：`-p --output-format stream-json --trust --force` 下 MCP 工具审批行为；配置落点调查（全局 `~/.cursor/mcp.json` 为宿主资产禁写；项目级 `.cursor/mcp.json` 落 workspace 污染宿主直用；查 cursor-agent per-process 配置参数/env 隔离）。

截断预案：SPIKE-00 三项中 rpc/extension 不兼容且适配量大 → pi 通道截断为 pi.mcp 维持 false + 适配留档（D-004）；SPIKE-01 不生效且实验位不通 → codex 通道截断暂缺（D-006）；SPIKE-02 确认不可用 → cursor 维持 false 如实记坑（D-003）。三引擎截断两两独立，不影响其余通道收口。"适配量大"量化阈值（Grill B-2 收窄）：出现以下任一即截断——① rpc 协议事件流形状需要 driver 全量重写（非增量适配）；② ≥2 个 vendored 扩展需重写；③ MCP 消费形态三档全部不可用。未触阈值的中等适配（如个别事件字段改名、单个扩展小改）在本变更内消化；spike-*.md 必须留档量化裁定理由。

### Phase 1 — 公共谓词能力化（daemon）

`sillyhub-daemon/src/cli.ts` `isMainAgentSession`（:993-997）从 `provider !== 'claude'` 硬编码改为经 `getProviderCaps(provider).mcp` 判定（安全封装见 sillyhub-daemon/src/interactive/providers.ts:452-459，未知 provider 返回默认拒绝对象——禁止对 PROVIDER_CAPS 直接下标，undefined 链会 TypeError 破坏"与现状逐字节一致"承诺）；caps 单源 PROVIDER_CAPS 表在 sillyhub-daemon/src/interactive/providers.ts:348-443（mcp 键语义即"driver 实际消费 mcpServers 并生效"，providers.ts:83）；stage 判定不变（`''`/`'orchestrator'` 注入）。分身谓词 `isWorkerSession`（cli.ts:1118-1120）维持 claude-only 不动（D-002）。下游 `resolveMainAgentMcp`（sillyhub-daemon/src/interactive/session-manager/driver-factory.ts:104-176）引擎无关管道零改动：三层合并、`MCP_SESSION_ID` 注入（driver-factory.ts:137-138）、mcpRefs 过滤、`buildDriverOptions` 写 `driverOpts.mcpServers`（:238-240）全部原样生效。

### Phase 2 — 各引擎 driver 消费通道（按 SPIKE 结论，可独立截断）

- **claude**：现状零改动（claude-sdk-driver.ts:492-493 透传 SDK options.mcpServers）。
- **pi**：按 SPIKE-00 形态优先级实现（D-005）：① 原生配置键 → `sillyhub-daemon/src/pi-settings.ts` settings.json 新增 mcpServers 写入（:210-216 先读后写+未知键保留模式已具备）；② 官方 adapter → vendor `pi-mcp-adapter` 至 sillyhub-daemon/vendor/pi-extensions/ 经现有 `--extension` 通道（pi-rpc-driver.ts:830-842）+ `.mcp.json` 落 per-session 目录；③ 兜底自写桥接扩展（仿 vendor/pi-extensions/ask-user/index.ts:41-54 registerTool 形态）。`PiStartOptions`（pi-rpc-driver.ts:412-445）起真实消费 `mcpServers` 字段；SPIKE-00 暴露的 rpc 协议差异在此一并适配。per-server env（含 `MCP_SESSION_ID`）随配置透传（项目约定：env 必须进 mcpServers 条目的 env 字段，.sillyspec/knowledge/conventions.md「MCP server 子进程不继承 claude.exe 完整环境」）。
- **codex**：`sillyhub-daemon/src/codex-settings.ts` 托管段差量替换机制（:38-56，非托管行保留）扩展 `[mcp_servers.<name>]` 段——**序列化器属能力扩展而非沿用**：现手写 TOML 序列化仅覆盖字符串标量（codex-settings.ts:53-55），需新增 args 字符串数组与 env 表/子表序列化，并把 `[mcp_servers.*]` 段头纳入托管段识别集合；`sillyhub-daemon/src/interactive/codex-app-server-driver.ts` start 链路（:820-878 ctx 组装）把 mcpServers 传给 settings writer（现状全文件零引用 mcpServers）。
- **cursor**：SPIKE-02 可行则 `sillyhub-daemon/src/interactive/cursor-driver.ts`（:95 现状显式忽略声明处）实现消费；不可行则维持忽略并更新注释为实测结论 + 复评条件。

### Phase 3 — 能力矩阵三端同步 + 回归

`sillyhub-daemon/src/interactive/providers.ts` PROVIDER_CAPS 按各通道实测结论翻值（注释同步改写为新证据引用）→ `sillyhub-daemon/scripts/gen-provider-caps.mjs` 重跑（自动更新 frontend/src/lib/provider-caps.ts + backend/app/modules/agent/provider_caps.py，脚本 :147-189 响亮失败守卫 + 幂等）→ `backend/app/modules/agent/tests/test_provider_caps_alignment.py` 三端对齐守护通过。daemon 侧既有 MCP 契约测试（tests/mcp-server.test.ts、tests/mcp-config.test.ts）与各 driver 既有测试全绿。

### Phase 4 — 端到端验收

每翻值引擎在平台真实会话内：① 会话中可见平台 MCP 工具；② `upload_file` 实测上传文件成功（文件中心可见）；③ 编排工具（派工/收口类）按 stage 语义可见。验收记录留档本变更目录。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/cli.ts | isMainAgentSession 谓词能力化：经 getProviderCaps(provider).mcp 查询（未知 provider 默认拒绝，禁直下标）替代 provider !== 'claude' 硬拒（D-001）；分身谓词不动（D-002） |
| 修改 | sillyhub-daemon/src/interactive/providers.ts | PROVIDER_CAPS 翻值（pi/codex/cursor 的 mcp 键按 SPIKE 实测）+ :226-245/:276 注释改写为新证据引用；daemon 装配处向谓词暴露 caps 查询 |
| 修改 | sillyhub-daemon/src/pi-settings.ts | 新增 per-session MCP 配置写入（形态按 SPIKE-00：settings.json mcpServers 键或 .mcp.json 落 PI_CODING_AGENT_DIR；含 per-server env 透传 MCP_SESSION_ID——producer=driver-factory resolveMainAgentMcp 产出 mcpServers → PiStartOptions 透传 → pi-settings writer 序列化落盘 → consumer=pi 1.0 引擎/adapter 读取发现工具） |
| 修改 | sillyhub-daemon/src/interactive/pi-rpc-driver.ts | PiStartOptions 消费 mcpServers 字段传入 settings writer / --extension 装载；SPIKE-00 暴露的 1.0 rpc 协议差异适配（事件流/fork/version 检测） |
| 修改 | sillyhub-daemon/src/codex-settings.ts | config.toml 托管段扩展 [mcp_servers.*] 差量替换（含序列化能力扩展：args 数组 + env 表/子表序列化、[mcp_servers.*] 段头纳入托管识别；producer=driver-factory mcpServers → codex driver start → writer TOML 落盘 CODEX_HOME → consumer=codex 引擎启动时加载） |
| 修改 | sillyhub-daemon/src/interactive/codex-app-server-driver.ts | start 链路消费 mcpServers 传给 codex-settings writer；SPIKE-01 结论落点（initialize capabilities 实验位或仅文件层） |
| 修改 | sillyhub-daemon/src/interactive/cursor-driver.ts | 视 SPIKE-02：实现 mcpServers 消费，或维持忽略+更新注释为实测结论与复评条件 |
| 新增 | NEW:sillyhub-daemon/vendor/pi-extensions/mcp-adapter/ | 视 SPIKE-00 形态②：vendor 官方 pi-mcp-adapter（含 README 刷新流程对齐 vendor/pi-extensions/README.md 惯例）；形态①③时本条取消 |
| 新增 | NEW:sillyhub-daemon/tests/pi-settings-mcp.test.ts | pi MCP 配置写盘单测（形态判定/env 透传/未知键保留/宿主全局零写入） |
| 新增 | NEW:sillyhub-daemon/tests/codex-settings-mcp.test.ts | codex [mcp_servers.*] 托管段单测（差量替换/非托管行保留/env 序列化/幂等） |
| 修改 | sillyhub-daemon/tests/mcp-config.test.ts | 谓词能力化后的注入矩阵回归（四引擎 × stage 组合断言） |
| 生成 | frontend/src/lib/provider-caps.ts | gen-provider-caps.mjs 重跑自动更新（禁手写） |
| 生成 | backend/app/modules/agent/provider_caps.py | 同上（get_provider_caps 默认拒绝语义不变） |
| 修改 | sillyhub-daemon/scripts/gen-provider-caps.mjs | 仅当 caps 键集/枚举域变化时调整解析器（预期不动，:147-189 守卫确保 4 引擎 × 16 键结构） |

注：SPIKE 截断的引擎，其对应清单条目在 plan 阶段收窄为"注释更新 + 测试断言维持 false"；PI 二进制版本检测若需新模块，落 sillyhub-daemon/src/interactive/pi-rpc-driver.ts 内（不新增文件）。

## 接口定义

本变更接口面：0 端点（无接口变更）。daemon↔backend 协议、REST/WS 契约、OpenAPI schema 零变化。daemon 内部 TS 签名扩展（非对外接口）：

```ts
// pi-settings.ts（形态①示例，最终以 SPIKE-00 为准）
export function writePiMcpConfig(dir: string, mcpServers: Record<string, McpServerConfigForDriver>): Promise<void>;
// 调用方归属（Grill B-5 落定）：对齐现有薄适配模式——pi 写盘链路经 providers.ts 聚合层装配（providers.ts:64/:70 懒调用纪律：
// 写盘器调用一律只出现在函数体内），不由 pi-rpc-driver 直调 pi-settings；装配点与 mcpServers 参数流转在 plan 阶段展开。

// codex-settings.ts：托管段扩展，签名维持 writeCodexDir(home, opts) 形态，opts 增加可选 mcpServers
// 各 driver start options：InteractiveDriverStartOptions.mcpServers（driver.ts:320）由"仅 claude 消费"变"caps.mcp=true 的 driver 均消费"，接口本身不变
```

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| 会话创建时 MCP 配置落盘（既有事件，注入面扩展） | daemon（SessionManager/driver start） | 各引擎引擎进程（pi/codex 子进程经 per-session 目录与环境读取） | sessionId, mcpServers(含 per-server env MCP_SESSION_ID) | 无新增状态迁移（session active 语义不变） |

本变更不新增、不修改任何 session/lease/agent_run 生命周期事件与状态迁移；既有 claim/heartbeat/turn result/session end 链路零改动。MCP server 子进程为引擎进程树成员，非 daemon 长驻任务（见风险登记 R-NF 留痕）。

## 数据模型

不涉及。无表结构/字段/migration 变更（backend 零改动，api-types 无需重新生成）。

## 兼容策略（brownfield 必填）

- **未翻值时行为不变**：谓词查 caps，mcp=false 的引擎不注入——与现状逐字节一致；claude 链路零改动。
- **宿主 pi < 1.0 降级**：daemon 版本检测（SPIKE-00 确定检测方式），不满足则该会话不注入 MCP + warn 日志，会话其余功能不受影响；caps 翻值描述的是"引擎机制支持"，运行时按宿主实际版本二次门控。
- **单点回退**：任一通道出问题，把 PROVIDER_CAPS 对应引擎 mcp 键回 false + 重跑 gen-provider-caps 即全局回退（产物自动同步，无其他残留状态——MCP 配置文件为 per-session 目录成员，会话结束随目录生命周期，不污染全局）。
- **不改变的 API/表结构**：backend 零端点零 schema；daemon↔backend WS/HTTP 协议零变化；frontend 手写代码零变化（仅生成产物）。
- **存量会话**：已运行会话不重注入（MCP 注入发生在会话创建链路，与 claude 现状时序一致）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | pi 1.0 rpc 协议/ExtensionAPI 大改，既有 pi 会话链路（resume/fork/ask-user/subagent）回归 | P0 | SPIKE-00 前置全项实测；不兼容且适配量大 → 截断 pi.mcp=false + 适配留档（D-004）；适配项若超出本变更 scope 则另立变更，本变更不携带 pi driver 重写 |
| R-02 | codex app-server 协议模式下 config.toml [mcp_servers.*] 不生效 | P1 | SPIKE-01 实测；评估 initialize capabilities 实验位；仍不通 → codex 通道截断暂缺（D-006） |
| R-03 | cursor headless MCP 工具审批挂起/无 per-session 配置落点 | P1 | SPIKE-02 实测；确认不可用 → 维持 false + providers.ts 记坑点与复评条件（上游修复后翻值）（D-003） |
| R-04 | 宿主机器 pi 二进制未升级到 1.0+ | P2 | daemon 版本检测 + 如实降级 + 部署指引留档；caps 翻值（机制支持）与运行时门控（宿主实际版本）两层分离 |
| R-05 | MCP 工具定义在非 claude 引擎上的上下文 token 膨胀 | P2 | 内置双 server 工具数有限（编排 5 + 上传 2）；workspace 层 MCP 资产由用户自管；pi 通道若走 pi-mcp-adapter 天然获得 token-efficient 代理模式 |
| R-06 | SPIKE 后文件变更清单与实际形态漂移（pi 形态①②③分叉） | P2 | plan 阶段以 SPIKE 留档为唯一依据收窄清单；execute 中形态变更必须回写 design decisions（新版本 D-005@v2） |
| R-NF | 非功能生命周期：无长驻进程/外部资源新增——MCP server 子进程由引擎进程树持有，stdio 管道随引擎进程退出自然关闭（引擎既有回收机制），daemon 侧无新增监听/后台任务 | P2 | 显式留痕：生命周期面不适用，无自灭机制新增需求 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 总体方案 Phase 1（谓词能力化）+ 文件变更清单 cli.ts 行 | 已覆盖 |
| D-002@v1 | 非目标第 1 条 + Phase 1 分身谓词不动 + 兼容策略 | 已覆盖 |
| D-003@v1 | Phase 0 SPIKE-02 + Phase 2 cursor 通道 + R-03 | 已覆盖 |
| D-004@v1 | Phase 0 SPIKE-00 + R-01 截断预案 | 已覆盖 |
| D-005@v1 | Phase 2 pi 通道形态优先级 + R-06 形态漂移约束 | 已覆盖 |
| D-006@v1 | Phase 0 SPIKE-01 + Phase 2 codex 通道 + R-02 | 已覆盖 |
| D-007@v1 | Phase 3 生成产物同步 + 文件清单 frontend/backend 生成行 + 原型跳过依据 | 已覆盖 |
| D-008@v1 | rejected：总体方案 Phase 1 未走文件层透传的依据（driver-factory 层逻辑现成） | 已覆盖 |
| D-009@v1 | rejected：拆分判断（spike 驱动提供逐引擎降级，无需预设灰度） | 已覆盖 |
| D-010@v1 | rejected：背景（路线 A 用户拍板）+ D-005 形态优先级首位"原生配置" | 已覆盖 |

组合推演（D-003/D-004/D-006 三截断裁定）：三引擎 spike 结果两两独立，caps 按引擎独立翻值，8 种组合（每引擎 true/false）下系统行为均为"mcp=true 引擎正常注入 + false 引擎维持现状"，无相互约束的死锁格；全败场景退化为现状（仅 claude 注入），可接受。无组合约束死锁。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪/自审）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@vN（D-001~D-010 全列，覆盖点逐条对应）
- [x] 涉及生命周期关键词（session/daemon）→ 已含「生命周期契约表」
- [x] UI 原型分级：跳过——纯 daemon/backend 逻辑 + 自动生成产物，零界面变化（D-007，frontend 无手写改动）
- [x] 组合裁定推演：三截断裁定独立，无死锁组合（决策追踪节显式留痕）
- [x] 非功能生命周期：R-NF 显式留痕
- [ ] ⚠️ 自审存疑：SPIKE 未跑，pi/codex/cursor 三通道最终形态存在分叉空间（R-06 已登记，plan 阶段以 spike 留档收窄清单——此为设计内已知不确定性，非缺口）
