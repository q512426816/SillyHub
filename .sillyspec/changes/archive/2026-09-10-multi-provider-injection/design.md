---
author: qinyi
created_at: 2026-09-10 22:32:03
scale: large
---

# 设计文档（Design）— 多供应商注入（codex 文件层 + pi 自定义端点文件层）

## 背景

平台 `llm_provider` 体系（用户级凭证/加密/set-default/WS 热切换）已完整，但 daemon 侧凭证注入只有 claude 实现（`credential-injector.ts:217` 注册表注释明确预留 codex/gemini/pi）。codex 会话的供应商来自宿主 `~/.codex/config.toml`（平台 `-c` 仅用于 feature 开关如 codex-app-server-driver.ts:727，非供应商），平台供应商切换对 codex 不生效；pi 经并行变更 `2026-09-10-review-dispatch-platform-fixes` 落了 env 层注入（官方端点+key），但其显式 punt 了自定义端点（"pi 不读 BASE_URL env，自定义端点走宿主 models.json"）。

本变更补齐：**codex 完整凭证注入 + pi 自定义端点文件层**。全部注入路径决策建立在 spike 实测事实上（`spike/spike-report.md`，24 条 mock 日志证据——brainstorm 阶段实机验证，非调研推断）。配套方案：`docs/proposal-config-management-capability-2026-09-10.md` §4（P0-B）。

## 设计目标

1. **codex 凭证注入闭环**：`CodexCredentialInjector` 缺位补齐——经会话隔离 `CODEX_HOME` 写 auth.json+config.toml（spike A2 闭环路径），供应商切换对 codex 会话生效（新会话必生效，D-009）
2. **pi 自定义端点文件层**：`PI_CODING_AGENT_DIR` 三文件（spike B1 闭环），补并行变更 punt 的自定义端点缺口；与既有 env 层分层不冲突（D-008）
3. **通道零新增**：openai_chat 形态经既有 litellm_proxy 满足 codex Responses-only 约束（D-006）；不新起协议转换
4. **热切换尽力语义**：复用 PROVIDER_CONFIG_CHANGED，daemon 重写隔离目录文件（D-009）

## 非目标

- **不做 env 路径 codex 注入**（spike A1：二进制无 OPENAI_BASE_URL，路不通）
- **不做 cursor**（spike C：私有 ConnectRPC 云协议无 BYO 面，D-007；结论已入档 spike 报告）
- **不重复 pi env 层/schema 放开/前端 pi 选项**（并行变更已做，D-008——本变更 execute 前置检查其已合并）
- **不做 codex 直连 anthropic 形态**（litellm 通道兜底覆盖全部 v1 场景，直连列 v2）
- **不改 lease 协议/ProviderConfig 形状/litm_provider 表结构**（既有中性设计直接消费；schema 仅词表增 codex）
- **不引入新 WS 消息类型**（复用既有推送）
- **不做 gemini**（注册表预留仍在，后续变更）

## 拆分判断

单一连贯变更不拆 MASTER：codex/pi 两个写盘器共享「隔离目录+保守合并+spawn 接线」同一套模式与测试框架，拆开会造成中间态（接线点写两遍）。Wave 按「写盘器 → 接线/热切换 → backend 词表/前端 → 收尾冒烟」切。

## 总体方案

```
ProviderConfig（lease 下发，协议零改动）
  ├─ 第 0 层 env 注入器（spawn-env 既有，零改动）：claude/pi(env 层) —— codex 不注册 env 注入器
  ├─ 配置写盘层（本变更新增，照 claude-settings.ts 模式）：
  │    codex-settings.ts → 会话隔离 CODEX_HOME/{auth.json, config.toml}
  │    pi-settings.ts    → 会话隔离 PI_CODING_AGENT_DIR/{auth.json, models.json, settings.json}（仅自定义端点形态写）
  └─ 通道：openai_chat → litellm_proxy（/v1/responses，D-006）；anthropic 直连 → 供应商原生端点
```

**Wave 划分**（plan 细化）：

- **W1 codex-settings.ts 写盘器 + 单测**：文件形状（spike A2 证据为 golden）、保守合并差量替换、缺省不写盘
- **W2 pi-settings.ts 写盘器 + 单测**：官方 auth 形状（spike B 修正：`{"<key>":{"type":"api_key","key":...}}`）、preserve unknown、仅 base_url 存在时写
- **W3 spawn 接线 + 热切换**：两写盘器挂 interactive（daemon.ts）与 batch（task-runner.ts）两接线点；PROVIDER_CONFIG_CHANGED 按 session_id 精准重写 per-session 目录（尽力）
- **W4 backend 词表 codex + 前端**：schema `Literal["claude","pi","codex"]`（pi 由并行变更合入后在其基础上增 codex）、表单 codex 选项、gen:types 联动
- **W5 真实 CLI 冒烟收尾**（integration-critical 预期）：mock 端点照 spike 手法，codex/pi 各一条端到端 + 文档

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:sillyhub-daemon/src/codex-settings.ts | CODEX_HOME 写盘器（auth.json+config.toml 保守合并；形状照 spike A2 证据） |
| 新增 | NEW:sillyhub-daemon/src/pi-settings.ts | PI_CODING_AGENT_DIR 三文件写盘器（官方 auth 形状；preserve unknown） |
| 修改 | sillyhub-daemon/src/daemon.ts | interactive 接线（claude-settings 消费点）+ PROVIDER_CONFIG_CHANGED 按会话精准重写钩子 + per-session 目录创建/清理接入 |
| 修改 | sillyhub-daemon/src/task-runner.ts | batch 接线（:526-533 STAGE_META env 追加点，codex/pi 任务同分派） |
| 修改 | sillyhub-daemon/src/credential-injector.ts | 注释更新（codex 走文件层不注册 env 注入器的说明）；不新增类 |
| 新增 | NEW:sillyhub-daemon/tests/codex-settings.test.ts | 文件形状 golden（spike 证据）/保守合并/缺省不写盘/TEMP 告警规避 |
| 新增 | NEW:sillyhub-daemon/tests/pi-settings.test.ts | 三文件形状/preserve unknown/仅自定义端点写/env 层共存 |
| 修改 | backend/app/modules/llm_provider/schema.py | agent_kind 词表增 codex（**仅 Create 一处**——worktree schema.py:19-20 实证 Update/FetchModelsRequest 无该字段，Grill B-4 修正；plan 前重核并行分支合并后形态） |
| 修改 | backend/app/modules/llm_provider/tests/（schema 相关测试文件） | codex 词表用例 + test_llm_provider_pi_kind.py:54-56 既有 codex 拒绝用例翻转为接受 |
| 修改 | backend/app/modules/llm_provider/service.py | Update 侧 pi×openai_chat 禁配取行后判（Plan 约束 2） |
| 修改 | frontend/src/components/llm-providers/（表单组件） | codex 选项 + pi 自定义端点字段（baseUrl/models，仅 pi 显示） |
| 修改 | frontend/src/lib/api-types.ts | pnpm gen:types 生成 |
| 修改 | backend/openapi.json | gen:types 联动 |
| 修改 | sillyhub-daemon/src/api-types.ts | daemon gen:types 联动（gen:types:check 零漂移） |
| 新增 | NEW:.sillyspec/docs/sillyhub-daemon/modules/（或既有模块卡更新） | 写盘器模块文档（收尾） |

## 接口定义

```typescript
// codex-settings.ts 核心（纯函数 + 显式路径入参，对齐 claude-settings.ts 风格）
export interface CodexHomeWriteInput {
  codexHome: string;            // per-session 目录（调用方 spawn 前创建，随会话清理）
  provider: ProviderConfig;     // lease 下发（含 api_format/litellm_base_url 既有字段）
  daemonApiKey: string | null;  // 进程级 _daemonApiKey 由调用方注入（纯函数承接，
                                 // Grill B-2：对齐 setDaemonApiKey 注释的进程级事实）
}
export function writeCodexHome(input: CodexHomeWriteInput): Promise<void>
  // async（对齐 claude-settings.ts 真实先例 async+best-effort）；codex 凭证属会话
  // 必需项，写失败策略：记 error 后跳过注入仍 spawn（子进程按宿主 ~/.codex 现状
  // 运行=行为等同未配置，log 可归因），不阻断会话创建（R-03 容错族）——W1 单测锁定
  // per-form 映射（Grill B-3 补全，唯一事实源）：
  //   anthropic 直连：auth key=provider.api_key；base_url=provider.base_url；
  //                  model=provider.default_fallback_model ?? provider.model（裸 id）
  //   openai_chat：  auth key=daemonApiKey（master key 不出 backend 铁律）；
  //                  base_url=provider.litellm_base_url（hub 代理）；
  //                  model=provider.litellm_model_name（usr-<uid>-<pid>，对齐
  //                  credential-injector.ts:158-163 先例）
  // auth.json: {"OPENAI_API_KEY": <上表 key>}
  // config.toml: [model_providers.sillyhub] name/base_url（上表）/wire_api="responses"
  //              （唯一值，spike：chat 已移除）+ 顶层 model（上表）/model_provider="sillyhub"；
  //              非托管段保留（差量替换，ai-toolbox managed-config 模式）
  // 写盘门槛（Grill B-1→B-8 两轮修正）：provider_config 存在即进入，per-form 必需
  // 字段校验内移——anthropic 形态要求 api_key/base_url 至少一项；openai_chat 形态
  // 要求 litellm_base_url/litellm_model_name 至少一项（该形态 payload 刻意不含
  // api_key（context.py:107-108 安全注释）也无 base_url 键——不得拿 anthropic
  // 分支的字段名当全形态判据）。必需字段缺失 → 记 warn 跳过写盘（可诊断不静默）。
  // 「未配置供应商」回归边界 = provider_config 整体 absent（lease 不带该键，
  // context.py:92-97 三对齐过滤，行为与现状逐字一致）

// pi-settings.ts 核心
export interface PiDirWriteInput {
  piDir: string;                // PI_CODING_AGENT_DIR 指向的会话隔离目录
  provider: ProviderConfig;
}
export function writePiDir(input: PiDirWriteInput): void
  // 仅 provider.base_url 非空（自定义端点形态）时写；官方端点形态不写（env 层负责，D-008 分层）。
  // pi × openai_chat 形态（Grill B-8 连带声明）：env 层（并行变更实现忽略 litellm
  // 字段）与文件层（无 base_url 不触发）皆不生效——本设计显式不支持该组合：
  // 后端 Create/Update 校验 agent_kind=pi 时 api_format 仅接受 anthropic（422，
  // 一行规则）；前端表单 pi 时禁选 openai_chat
  // auth.json: {"sillyhub": {"type": "api_key", "key": key}}（spike B 官方形状修正）
  // models.json: providers.sillyhub = {api: "openai-completions", baseUrl, models: [...]}
  // ——api 值以 spike b1-models.json:5 golden 为准（Grill B-6 两轮修正落盘）；
  //    preserve unknown 顶层与兄弟键
  // settings.json: defaultProvider="sillyhub"/defaultModel=裸 model id——preserve unknown
  // 分层共存语义（R-04 引用落位）：env 层同会话注入的 key 为无害冗余——spike
  // Pi-3 实证 pi 凭证优先级 auth.json > env（同键文件值压制 env 值）
```

spawn 接线（**两处**，Grill B-5 补全：interactive=daemon.ts:7920 一带（claude-settings 消费点）、batch=task-runner.ts:526-533（STAGE_META 追加 env 的现成模式处））：会话/任务创建前按 `provider.agent_kind` 分派——`codex` → writeCodexHome + env 注入 CODEX_HOME；`pi` 且 base_url 非空 → writePiDir + env 注入 PI_CODING_AGENT_DIR；**applyClaudeSettings 显式加 agent_kind="claude"（或缺省）守卫**（Grill P2：现状两接线点无守卫，非 claude kind 的 settings_config 白名单键会写穿 claude 目录并残留）；其余不动。热切换钩子：PROVIDER_CONFIG_CHANGED 处理器对活跃会话按同分派重写（尽力语义，D-009）。

## 生命周期契约表

涉及「lifecycle」关键词处仅为既有机制引用（PROVIDER_CONFIG_CHANGED 既有推送的消费扩展），无新状态迁移设计。豁免。

## 数据模型

无表结构变更。llm_provider schema 仅 `agent_kind` Literal 词表增 `"codex"`（pi 由并行变更增入，本变更不重复改）。

## 兼容策略（brownfield 必填）

- **未配置 codex 供应商**：provider_config 整体 absent → 不写盘不注入 env，行为与现状逐字一致（context.py:92-97 无 (user_id,"codex",is_default) 行即不带）
- **pi 官方端点供应商**：走并行变更 env 层，本变更文件层不触发（base_url 为空不写），零干扰
- **claude 路径零改动**：env 注入器/claude-settings.ts/spawn-env 第 0 层均不动（applyClaudeSettings 新增 kind 守卫属防御修正非行为变更——现状无跨 kind 配置在用）
- **pi × openai_chat 禁配**（B-8 连带）：两层皆不生效的组合显式拒绝（后端 422 一行规则 + 前端禁选），文档明示
- **execute 时序前置**（D-008）：review-dispatch-platform-fixes 合并 main 后才开工（其改 credential-injector.ts/schema/表单三处同文件）；未合并则先协助/等待
- **codex CLI 版本面**：spike 基线 0.147.0；wire_api 仅 responses 的约束写死在写盘器（升级 CLI 若恢复 chat 不自动启用——显式事实源注释）

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 并行变更未及时合并，本变更 execute 被阻 | P1 | D-008 时序前置检查；brainstorm/plan 可先行（不依赖其代码，仅 execute 依赖） |
| R-02 | litellm /v1/responses 与 codex 的实际兼容残差（spike 验的是 mock 直连） | P1 | W5 冒烟含 litellm_proxy 通道真请求（openai_chat 形态）；不通用文档标注降级路径（直连 anthropic v2） |
| R-03 | codex/pi CLI 升级改文件格式（0.147/0.81 基线漂移） | P2 | 写盘器形状以 spike 证据为 golden + 模块卡记录 CLI 版本基线；格式漂移由冒烟测试暴露 |
| R-04 | pi 文件层与 env 层叠加歧义（同会话两层都活跃） | P2 | 机制已定（接口定义段：auth.json > env 压制语义，spike Pi-3）；pi-settings.test 覆盖共存与单层两用例 |
| R-05 | 热切换"尽力"语义被误解为承诺 | P2 | 文档/前端提示明确"新会话必生效，活跃会话尽力"；不在 UI 用"已切换"确定性文案 |
| R-06 | CODEX_HOME 指向 TEMP 类目录被 codex 告警（spike 附注） | P2 | per-session 目录位于平台管理的会话配置根下（非 TEMP），单测断言路径不含 TEMP 且含 session_id 段 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001 范围（codex+pi 同批/cursor spike） | 非目标/背景 | 已覆盖 |
| D-002 spike 前置 | 背景/全文事实引用 | 已覆盖 |
| D-003 codex 三路实测 | 非目标（env 不做）/接口定义（wire_api=responses） | 已覆盖 |
| D-004 pi 注入面实测 | 接口定义（官方 auth 形状） | 已覆盖 |
| D-005 载体=隔离目录写文件 | 总体方案/文件清单 | 已覆盖 |
| D-006 litellm 满足 Responses | 总体方案通道段/R-02 | 已覆盖 |
| D-007 cursor 排除 | 非目标 | 已覆盖 |
| D-008 并行变更分层+时序 | 背景/兼容策略/R-01 | 已覆盖 |
| D-009 热切换尽力 | 设计目标 4/接口定义/R-05 | 已覆盖 |
| D-010 设计整体确认 | 本文档 | 已覆盖 |
| D-011 per-session 目录粒度 | 接口定义/总体方案/R-06 | 已覆盖 |
| D-012 写盘门槛（provider_config 存在+per-form 必需字段） | 接口定义注释/兼容策略 | 已覆盖 |

## Plan 阶段约束（Grill 三轮复审遗留，P2/P3 固化）

1. writePiDir 签名统一为 Promise<void>（三文件先读后写 IO 重于 codex，且与 writeCodexHome 对称）
2. pi × openai_chat 禁配的 Update 侧校验落点 = service 层（LlmProviderUpdate 无 agent_kind 字段，schema validator 判不了组合，service.update 取行后判——文件清单相应补 service.py）
3. 写失败"跳过注入"含 CODEX_HOME/PI_CODING_AGENT_DIR env 注入一并跳过（半写目录被 CLI 读到 ≠ 按宿主现状运行，失败语义唯一化）
4. 文件清单 schema/表单两行说明在 plan 拆任务时同步禁配规则文字

## 自审

- [x] 章节齐全（背景/目标/非目标/拆分/方案/清单/接口/生命周期豁免/数据模型/兼容/风险/追踪/自审）
- [x] frontmatter 齐全（author/created_at/scale=large）
- [x] 引用全部当前版本 D-001~D-012（追踪表全覆盖）
- [x] 生命周期关键词均为既有机制引用，豁免短语紧邻
- [x] UI 原型跳过（表单增项无新页面，D-010 用户未否决）
- [x] 无「⚠️ 自审存疑」——两处实现期再定细节（表单组件精确文件名按现有 llm-providers 目录惯例；daemon.ts 接线点精确行号）已在清单标注，属 plan 粒度
