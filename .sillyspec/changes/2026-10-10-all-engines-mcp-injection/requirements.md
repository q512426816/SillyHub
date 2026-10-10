---
author: qinyi
created_at: 2026-10-10T23:56:00
---
# 需求规格（Requirements）— 2026-10-10-all-engines-mcp-injection

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在 Web UI 创建 pi/codex/cursor 引擎的交互式会话，期望与 claude 会话同等使用平台 MCP（上传文件到平台、编排工具） |
| daemon（守护进程） | 会话创建链路的 MCP 注入执行方：谓词判定、三件套合并、per-session 配置落盘 |
| backend | 能力矩阵产物消费方（provider_caps.py），零端点/schema 改动 |
| frontend | 能力矩阵产物消费方（provider-caps.ts 生成产物），零手写 UI 改动 |

## 功能需求

### FR-01: 谓词能力化——caps.mcp=true 的引擎主控/普通会话注入平台 MCP，配置面与 claude 完全一致

覆盖决策：D-001@v1
承接: FR-mcp-config-004（扩展引擎维度：claude-only → caps.mcp=true 全引擎；三层合并/白名单/预取机制行为不变）

daemon 侧 isMainAgentSession 谓词（sillyhub-daemon/src/cli.ts:993-997）必须从 provider!=='claude' 硬编码改为经 getProviderCaps(provider).mcp 判定（安全封装见 sillyhub-daemon/src/interactive/providers.ts:452-459；禁止对 PROVIDER_CAPS 直接下标——未知 provider 得 undefined 链会 TypeError）；注入配置面（platform ∪ workspace 三件套 + 内置 sillyhub-daemon/sillyhub-file 双 server 三层合并、白名单、MCP_SESSION_ID env、mcpRefs 过滤）必须走既有引擎无关管道（sillyhub-daemon/src/interactive/session-manager/driver-factory.ts:104-176）零语义偏差。

#### 场景：pi 会话（caps 翻值后）注入

- Given providers.ts 中 pi 的 caps.mcp=true 且会话 provider=pi、stage 缺省、workspaceId 存在
- When daemon 创建该会话
- Then resolveMainAgentMcp 产出与同 workspace claude 会话相同的 mcpServers 表（含 MCP_SESSION_ID env），传递给 pi driver

#### 场景：caps=false 引擎维持现状

- Given 某引擎 caps.mcp=false（如 SPIKE 截断后的通道）
- When daemon 创建该引擎会话
- Then 不注入 MCP（行为与现状一致），无 warn 噪音

#### 场景：未知 provider 默认拒绝

- Given 会话 provider 不在 INTERACTIVE_PROVIDERS 注册表内
- When 谓词判定
- Then 按 getProviderCaps 默认拒绝对象处理（mcp=false，不注入、不抛错）

### FR-02: 分身会话维持 claude-only

覆盖决策：D-002@v1

isWorkerSession（sillyhub-daemon/src/cli.ts:1118-1120）必须保持不动：任意引擎下 stage=mission_worker 的分身不得进入主控注入；claude 分身的受限 worker 工具集注入行为必须保持不变（循既有决策 D-008@v1 与本变更 D-002）。

#### 场景：pi 分身不注入

- Given provider=pi 且 stage=mission_worker
- When 会话创建
- Then 主控与分身两条注入路径均不产出 MCP 配置

### FR-03: pi 通道——per-session MCP 配置落盘 + 1.0 兼容门控

覆盖决策：D-004@v1, D-005@v1

SPIKE-00（rpc 协议/ExtensionAPI/MCP 形态三项实测）通过后：MCP 配置必须按形态优先级（原生配置 > 官方 adapter > vendor 自写扩展，D-005）写入 per-session PI_CODING_AGENT_DIR 隔离目录（禁止写宿主全局 pi 配置）；per-server env（含 MCP_SESSION_ID）必须随配置透传；PiStartOptions（sillyhub-daemon/src/interactive/pi-rpc-driver.ts:412-445）必须真实消费 mcpServers。SPIKE-00 触发量化截断阈值（design Phase 0：rpc 全量重写/≥2 vendored 扩展重写/三形态全不可用任一）→ pi.mcp 必须维持 false + 适配留档（D-004 截断）。

#### 场景：配置落盘隔离

- Given pi 会话创建，resolveMainAgentMcp 产出 mcpServers
- When pi-settings writer 执行
- Then 配置与 env 仅写入该会话 PI_CODING_AGENT_DIR，宿主 ~/.pi 全局配置零变化；先读后写保留未知键

#### 场景：SPIKE-00 截断

- Given SPIKE-00 触发量化截断阈值之一
- When 本变更收口
- Then pi caps.mcp=false 维持，providers.ts 注释记录不兼容点与适配留档路径

### FR-04: codex 通道——config.toml 托管段 [mcp_servers.*] + app-server 生效门控

覆盖决策：D-006@v1

SPIKE-01 实测通过后：codex-settings.ts 托管段差量替换（sillyhub-daemon/src/codex-settings.ts:38-56 非托管行保留语义不变）必须扩展 [mcp_servers.<name>] 段（含序列化能力扩展：args 数组 + env 表/子表序列化、段头纳入托管识别）；配置仅落 per-session CODEX_HOME（禁止写宿主全局 ~/.codex）。SPIKE-01 不生效且实验位不通 → codex.mcp 必须维持 false 留档（D-006 截断）。

#### 场景：托管段写入与保留

- Given codex 会话创建，mcpServers 非空
- When writeCodexDir 执行
- Then config.toml 含 [mcp_servers.<server>] 段（command/args/env 完整），用户手写非托管行原样保留，重复执行幂等

### FR-05: cursor 通道——SPIKE-02 结论落地

覆盖决策：D-003@v1

SPIKE-02 实测 headless MCP 审批与配置落点隔离：可行 → cursor-driver.ts 必须消费 mcpServers（落点按实测结论，禁止写宿主全局 mcp.json 与污染 workspace 项目级 .cursor/mcp.json）；不可行 → caps 必须维持 false + 注释记录实测坑点与复评条件（D-003）。禁止无实测证据翻值。

#### 场景：不可行留档

- Given SPIKE-02 确认 headless 审批不可用
- When 收口
- Then providers.ts cursor 注释含实测证据、坑点、复评条件三要素

### FR-06: 宿主 pi 版本检测降级

覆盖决策：D-004@v1

pi caps 翻值后，daemon 必须在会话创建时检测宿主 pi 二进制版本（检测方式以 SPIKE-00 结论为准）：<1.0 则该会话必须不注入 MCP 并记 warn（日志含检测到的版本号），其余会话功能不受影响（机制支持与运行时门控两层分离，R-04）。

#### 场景：老版本宿主

- Given 宿主 pi 0.81.x、caps pi.mcp=true
- When pi 会话创建
- Then 不注入 MCP，warn 日志含检测到的版本号，会话正常可用

### FR-07: 能力矩阵三端同步

覆盖决策：D-007@v1

providers.ts 翻值后必须跑 sillyhub-daemon/scripts/gen-provider-caps.mjs：frontend/src/lib/provider-caps.ts 与 backend/app/modules/agent/provider_caps.py 产物必须自动更新；backend/app/modules/agent/tests/test_provider_caps_alignment.py 必须全绿。产物文件禁止手写。

#### 场景：翻值同步

- Given providers.ts pi.mcp 翻 true
- When pnpm gen:types（含 gen-provider-caps）
- Then 两产物中 pi.mcp=true，对齐守护测试全绿

### FR-08: 既有测试零回归

覆盖决策：D-001@v1

daemon 既有 MCP 契约测试（sillyhub-daemon/tests/mcp-server.test.ts、sillyhub-daemon/tests/mcp-config.test.ts）与 claude/pi/codex/cursor driver 既有测试必须全绿；禁止为通过测试修改既有断言。

#### 场景：回归

- Given 本变更全部代码改动
- When 跑 daemon pnpm test 相关文件 + backend agent 模块测试
- Then 全绿

### FR-09: 端到端验收——每翻值引擎实测上传

覆盖决策：D-001@v1, D-003@v1, D-004@v1, D-006@v1

每个翻值引擎（以 SPIKE 实测翻值结果为准，非四引擎无条件全集）在平台真实会话内：平台 MCP 工具必须可见、upload_file 必须实测上传文件成功（文件中心可见）。验收记录必须留档本变更目录 acceptance-e2e.md。

#### 场景：pi 端到端

- Given 宿主 pi 1.0+、caps pi.mcp=true
- When 平台创建 pi 会话并让 agent 调 upload_file
- Then 上传成功，backend 文件产物记录落库（POST /api/agent/file-artifacts 链路）

## 非功能需求

- 兼容性：未翻值引擎与 claude 链路行为与现状逐字节一致；宿主 pi<1.0 运行时降级（机制支持与实际版本两层门控）
- 可回退：任一通道回退 = PROVIDER_CAPS 对应引擎 mcp 键回 false + 重跑 gen-provider-caps 单点回退；MCP 配置为 per-session 目录成员随会话生命周期，无全局残留
- 可测试：谓词矩阵/写盘单测/对齐守护/既有契约回归四层覆盖；SPIKE 留档与端到端验收记录可审计
- 安全边界：MCP 配置禁止写宿主全局资产（~/.pi、~/.codex、~/.cursor）；per-server env 经配置条目 env 字段透传（不落进程环境）

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-08, FR-09 | 方案 A 主架构：谓词能力化 + driver 原生消费 |
| D-002@v1 | FR-02 | 分身 claude-only 循既有 D-008 |
| D-003@v1 | FR-05, FR-09 | cursor spike 驱动 + 禁止无证据翻值 |
| D-004@v1 | FR-03, FR-06, FR-09 | pi SPIKE-00 前置 + 量化截断 + 版本检测 |
| D-005@v1 | FR-03 | pi 形态优先级（原生>adapter>自写兜底） |
| D-006@v1 | FR-04, FR-09 | codex 托管段扩展 + SPIKE-01 门控 |
| D-007@v1 | FR-07 | frontend/backend 仅生成产物同步 |
| D-008@v1 | FR-01 | rejected：文件层透传方案的否决依据（driver-factory 层逻辑现成） |
| D-009@v1 | FR-09 | rejected：分引擎灰度的否决依据（spike 驱动已提供逐引擎降级） |
| D-010@v1 | FR-03 | rejected：路线 B（不升级 pi 基线自写桥接）的否决依据 |

无未覆盖决策，无剩余风险决策（三条 rejected 均有否决理由与复潮条件，见 decisions.md）。

## 测试绑定（每条 FR 至少一行）

FR-01: test/sillyhub-daemon/tests/mcp-config.test.ts「谓词注入矩阵——caps.mcp=true 引擎 × stage 注入」「caps=false 引擎不注入」「未知 provider 默认拒绝」
FR-02: test/sillyhub-daemon/tests/mcp-config.test.ts「分身 mission_worker 全引擎不进主控注入」
FR-03: test/NEW:sillyhub-daemon/tests/pi-settings-mcp.test.ts「配置落盘隔离」「未知键保留」「env 透传」
FR-04: test/NEW:sillyhub-daemon/tests/codex-settings-mcp.test.ts「[mcp_servers.*] 托管段写入」「非托管行保留」「幂等」「args 数组与 env 表序列化」
FR-05: test/sillyhub-daemon/tests/mcp-config.test.ts「cursor 按 caps 断言」+ providers.ts 注释留档（不可行分支）
FR-06: test/sillyhub-daemon/tests/pi-settings-mcp.test.ts「宿主版本不足降级不注入」
FR-07: test/backend/app/modules/agent/tests/test_provider_caps_alignment.py「全文件」
FR-08: test/sillyhub-daemon/tests/mcp-server.test.ts「既有契约回归」
FR-09: test/验收记录文件（.sillyspec/changes/2026-10-10-all-engines-mcp-injection/acceptance-e2e.md）「每翻值引擎 upload_file 实测」
