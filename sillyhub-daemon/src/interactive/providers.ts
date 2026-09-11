/**
 * interactive/providers.ts —— interactive provider 聚合契约（ProviderAdapter）
 * 与能力矩阵（ProviderCaps）daemon 单源。
 *
 * 出处：2026-09-03-agent-provider-abstraction task-02（caps 表基座）；
 * 2026-09-11-provider-adapter-registry task-01（ProviderDescriptor 原地扩展为
 * ProviderAdapter 聚合契约，D-003@v2——不另立契约文件）。
 *
 * 分层说明：本文件是 ProviderCaps 能力矩阵与 provider 聚合契约的**唯一维护源**
 * （daemon 单源）；backend `app/modules/agent/provider_caps.py` 与 frontend
 * `src/lib/provider-caps.ts` 为手工镜像，三端键集合与每个 provider 每键取值必须
 * 一致，一致性由 `backend/app/modules/agent/tests/test_provider_caps_alignment.py`
 * 以源文件读取方式守护（读表源比对，不复制值断言）；caps 三端同步生成归
 * task-04（gen-provider-caps.mjs），本 task 先落第 10 键 provider_switch 单源。
 *
 * 聚合契约（新引擎接入清单）：新引擎接入 = 在 INTERACTIVE_PROVIDERS 加**一份
 * 声明**——现有五要素（provider / family / displayName / createDriver / caps）加
 * 五新成员（envInjector 懒工厂 / fileSettings 写盘器 / perSessionDir /
 * smokeSuite / switchable），缺任一必填字段 `satisfies Record<string,
 * ProviderAdapter>` 即 TS2741 编译红。原先散落七八处的登记点（注入器 REGISTRY /
 * 文件层分派 / daemon 硬编码 kind 判断 / 前端切换白名单）由 task-02/03/04 改为
 * 从聚合表派生，本 task 落契约基座（派生前既有字面量与聚合表并存，值等价）。
 *
 * 取值约定：caps 描述 provider 当前真实能力（以本仓现状硬编码门控为准，
 * 不臆断），9 个 boolean 键缺省 false 默认拒绝（FR-06 / D-002@v1）；dialog
 * 为 string 枚举键（'native' / 'marker' / 'none'，2026-09-09-askuser-pi-cursor
 * task-12 / FR-06 加入——打破「8 键全 boolean」旧约定）；provider_switch 为
 * 第 10 键（本变更 task-01 加入，与 adapter.switchable 单源一致）；未知 provider
 * 查询返回默认拒绝对象（boolean 键全 false、dialog 取 'none'），不抛错。
 * 改取值先改本文件，再同步两端镜像。
 */

import type { ProtocolType } from '../adapters/index.js';
import type { CredentialInjector } from '../credential-injector.js';
import type { ProviderConfig } from '../types.js';
import type { InteractiveDriver } from './driver.js';
import { ClaudeSdkDriver } from './claude-sdk-driver.js';
import { CodexAppServerDriver } from './codex-app-server-driver.js';
import { CursorDriver } from './cursor-driver.js';
import { PiRpcDriver } from './pi-rpc-driver.js';
import { ClaudeCredentialInjector, PiCredentialInjector } from '../credential-injector.js';
import { isCodexFormSufficient, writeCodexHome } from '../codex-settings.js';
import { isPiFormSufficient, writePiDir } from '../pi-settings.js';

// ── import 环纪律（2026-09-11-provider-adapter-registry task-01）──────────────
//
// 本文件对 credential-injector.ts（注入器类值导入）、provider-file-settings.ts
//（isCodexFormSufficient / isPiFormSufficient / nonEmptyStr）、codex-settings.ts
//（writeCodexHome）、pi-settings.ts（writePiDir）的**调用**一律只出现在函数体内
//（envInjector 懒工厂体 / writer 的 write 与 skipsOfficialEndpoint 方法体）——
// 注入器构造与写盘都在函数体内延迟执行，模块初始化零跨表求值（ESM 零 TDZ）。
// task-02 REGISTRY / 文件层分派反向派生引本表后，两方向互引均须保持该纪律。
// isSufficient 为初始化期取函数绑定（非调用）——provider-file-settings.ts 不回引
// 本文件，当前无环；task-02 派生化后其函数声明提升亦环安全。CredentialInjector /
// ProviderConfig 为 type-only import（verbatimModuleSyntax），零运行时依赖。

/** provider 能力矩阵（10 键：9 个 boolean + dialog string 枚举，缺省默认拒绝）。 */
export interface ProviderCaps {
  /** 会话恢复（Claude SDK session_id / Codex threadId）。 */
  resume: boolean;
  /** MCP server 注入（driver 实际消费 mcpServers 配置并生效）。 */
  mcp: boolean;
  /** 多模态（会话附件：图片 / 文件注入）。 */
  multimodal: boolean;
  /** 思考流（thinking 事件缓冲与渲染）。 */
  thinking: boolean;
  /** 子代理（团队派工 / Task 分身链路）。 */
  subagent: boolean;
  /** 远程人审对话框（permission dialog / user dialog 桥）。 */
  permission_dialog: boolean;
  /**
   * 向用户提问的对话框通道形态（string 枚举；FR-06，
   * 2026-09-09-askuser-pi-cursor task-12 加入，打破「8 键全 boolean」旧约定）：
   * 'native' = 走平台 dialog 管道（permission_dialog 桥，pending 行 + 答题端点）；
   * 'marker' = 纯前端标记协议（消息尾部 askuser fenced 块，不经后端 dialog 管道）；
   * 'none' = 无通道（未知 provider 回退值）。
   */
  dialog: 'native' | 'marker' | 'none';
  /** Edit 工具 structuredPatch（差异渲染数据源）。 */
  edit_patch: boolean;
  /** 模型选择（创建会话时的模型覆盖生效）。 */
  model_select: boolean;
  /**
   * 会话级供应商切换支持（2026-09-11-provider-adapter-registry task-01 第 10 键）：
   * 与 INTERACTIVE_PROVIDERS 条目的 switchable 单源一致（由
   * provider-registry.test.ts 守护测试锁定同值）；取值依据 frontend
   * PROVIDER_SWITCH_ENGINES 现行白名单（claude / codex / pi）。
   */
  provider_switch: boolean;
}

/**
 * 各 provider 能力取值（单源；backend / frontend 手工镜像须同步）。
 *
 * 每项取值依据（2026-09-03 task-02 实读现状硬编码门控，行号为当时锚点）：
 *
 * claude（8 项全 true + dialog='native'）：
 * - resume：backend/app/modules/daemon/session/service.py:6335 reopen 门控
 *   `session.provider not in {"claude", "codex"}` 才拒——claude 在白名单；
 * - mcp：src/interactive/driver.ts:135-136 Claude driver 透传 SDK
 *   options.mcpServers（session-manager.ts:1704-1709 主 agent 注入链）；
 * - multimodal：frontend session-panel.tsx:5695 附件门控
 *   `provider !== "claude"` 才禁；backend daemon/session/service.py:1361 /
 *   2845 `!= "claude"` 才 raise AttachmentsUnsupported（「仅 Claude 支持多模态
 *   与文件注入」）；
 * - thinking：src/interactive/session-manager.ts:404-410 Claude SDK
 *   thinking_delta 缓冲 → [THINKING] flush 链；
 * - subagent：frontend session-panel.tsx:3237 / 3563 / 5707 团队派工门控
 *   `=== "claude"`（D-003 一期 Claude 专属；2956 / 5395 /team 拦截同款）；
 * - permission_dialog：src/interactive/session-manager.ts:1762-1775
 *   approvalReady 时注入 canUseTool + onUserDialog/supportedDialogKinds；
 * - dialog='native'：canUseTool / onUserDialog 双桥即平台 dialog 管道的
 *   原生消费方（permission_dialog 同锚，2026-09-09-askuser-pi-cursor task-12）；
 * - edit_patch：backend daemon/run_sync/service.py:1476-1478 / 3679
 *   structuredPatch 取自 Claude SDK tool_use_result 形状；
 * - model_select：src/interactive/driver.ts:122-123 model「模型覆盖」
 *   provider-neutral；src/interactive/claude-sdk-driver.ts:383-384
 *   `options.model = opts.model`。
 *
 * codex（3 项 true + dialog='native'）：
 * - resume：backend service.py:6335 白名单 `{"claude", "codex"}` 含 codex
 *   （driver.ts:120-121 Codex threadId resume）；
 * - permission_dialog：src/interactive/session-manager.ts:1776-1790 codex 分支
 *   注入 sessionPermission{requestPermission, requestUserDialog}（同 approvalReady
 *   块，Claude 用 canUseTool/onUserDialog、codex 用 hooks——两桥等价支持）；
 * - dialog='native'：sessionPermission 双桥即平台 dialog 管道的原生消费方
 *   （permission_dialog 同锚，2026-09-09-askuser-pi-cursor task-12）；
 * - model_select：src/interactive/codex-app-server-driver.ts:1058
 *   `if (ctx.model) params.model = ctx.model`（frontend session-panel.tsx:5913-5921
 *   模型输入框不按 provider 门控）。
 *
 * codex 其余 5 项 false：
 * - mcp：driver.ts:135-136 codex driver 对 mcpServers 仅暂存不消费
 *   （「codex app-server MCP 注入留后续任务」）；
 * - multimodal：session-panel.tsx:5695 codex 附件禁用；backend service.py:1361 /
 *   2845 codex 直接 raise；
 * - thinking：src/interactive/codex-app-server-driver.ts:34-36 flat message 契约
 *   仅 'text' | 'tool_use' | 'tool_result' | 'error'，无 thinking；
 * - subagent：session-panel.tsx:3237 / 3563 / 5707 团队派工仅 claude；
 * - edit_patch：run_sync/service.py:3679 structuredPatch 仅 Claude SDK 形状，
 *   codex flat message 契约无此字段。
 *
 * pi（2026-09-04-provider-pi-onboarding task-04 / design §5.3 能力矩阵，
 * 5 项 true 3 项 false + dialog='native'——三态结论「原生 / 暂缺」依据，
 * D-002@v1 桥接补齐+如实标记；permission_dialog / dialog 随
 * 2026-09-09-askuser-pi-cursor Wave A 翻值）：
 * - resume=true（原生）：rpc --session-id / switch_session / fork + 隔离
 *   session-dir（design §5.1 resume 链路）；
 * - mcp=false（暂缺）：pi 无原生 MCP（自家 extension 生态另轨），桥接留后续
 *   变更（design §3 非目标）；
 * - multimodal=true（原生）：rpc prompt images（ImageContent base64）；
 * - thinking=true（原生）：--thinking 七档 + set_thinking_level + thinking
 *   内容块；
 * - subagent=false（终值，task-06 实证）：pi subagent 是 examples/ 示例扩展
 *   （task-06 已 vendor 进 sillyhub-daemon/vendor/pi-extensions/subagent/ 并经
 *   driver --extension 装载——模型侧可用），但其子代理跑 `pi --mode json -p
 *   --no-session` 子进程、消息聚合进 tool result details（实测事件流样本：
 *   全流唯一 toolCallId=父 subagent 调用，子代理 4 条 messages 仅存在于
 *   tool_execution_end.result.details.results[0]），父事件流无 per-child
 *   归属（AgentEvent 的 parent_tool_use_id/subagent_type/depth 无从映射，
 *   聚合快照为 replace 语义、产出 per-child 流需跨行差分合成，超出无状态
 *   归一化「补映射」范畴）——团队派工 UI 依赖的归属链路不可落，如实 false
 *   （§6.2 纪律 / R-02 / D-002@v1；证据与复测步骤见 onboarding §5.3 PI 案例锚）；
 * - permission_dialog=true（2026-09-09-askuser-pi-cursor Wave A 翻真，原「暂缺：
 *   rpc 无审批命令，pi 权限门在 extension 层」）：extension_ui_request 的
 *   dialog 类四方法（select / confirm / input / editor）已桥接
 *   sessionPermission.requestUserDialog 上抛（pi-rpc-driver.ts 挂起表）；
 *   权限类请求零桥接、继续自动拒绝（FR-02 红线）；
 * - dialog='native'（随 Wave A，task-12 / FR-06）：pi 轮中提问走平台
 *   dialog 管道（dialog_kind='pi_extension_ui'，永久等待不超时）；
 * - edit_patch=false（暂缺）：pi edit 工具结果为 diff 文本无结构化 patch，
 *   前端 LCS 回退可用；
 * - model_select=true（原生）：set_model / cycle_model /
 *   get_available_models rpc 全套。
 *
 * cursor（2026-09-08-cursor-interactive-session task-05 / design「注册（providers.ts）」节；
 * 3 项 true 4 项 false + dialog='marker'——resume / thinking / model_select 已验证，
 * 其余键无通道或未验证，§6.2 先实现后翻 true）：
 * - resume=true（原生）：driver `--resume` 通道（D-001@v1）+ CLI 实测，Wave 0 验证 B
 *   （--resume 记忆连续性）已通过（spike-cursor-frames.md）；
 * - mcp=false（暂缺）：CLI 无 per-session `--mcp-config`（D-008@v1）；
 * - multimodal=false（暂缺）：附件 / blocks 无对应 CLI 通道；
 * - thinking=true（task-01 实测修正）：顶层 thinking 帧稳定存在且有 fixture 样本，
 *   归一化器已映射 delta→thinking 流式——不以过期任务卡 thinking=false 为准；
 * - subagent=false（暂缺）：团队派工无对应 CLI 通道；
 * - permission_dialog=false（暂缺）：审批桥无对应 CLI 通道（D-003@v2）；
 * - dialog='marker'（2026-09-09-askuser-pi-cursor task-12 初值，FR-06）：
 *   纯前端标记协议（Wave B askuser fenced 块 + task-08 prompt 注入），
 *   不经后端 dialog 管道——若 spike no-go，随 task-08 三端同步改 'none'；
 * - edit_patch=false（暂缺）：structuredPatch 无对应通道；
 * - model_select=true（原生）：driver `--model` 通道 + CLI 实测。
 *
 * provider_switch（第 10 键，2026-09-11-provider-adapter-registry task-01）：
 * 取值与 INTERACTIVE_PROVIDERS 条目 switchable 同值（守护测试锁定单源一致）；
 * 依据 frontend `src/lib/provider-caps.ts` PROVIDER_SWITCH_ENGINES 现行白名单
 *（claude / codex / pi=true，cursor=false——cursor 私有 ConnectRPC 云协议无
 * BYO 注入面，不支持会话级切换到外部供应商）。
 */
export const PROVIDER_CAPS: Record<string, ProviderCaps> = {
  claude: {
    resume: true,
    mcp: true,
    multimodal: true,
    thinking: true,
    subagent: true,
    permission_dialog: true,
    dialog: 'native',
    edit_patch: true,
    model_select: true,
    provider_switch: true,
  },
  codex: {
    resume: true,
    mcp: false,
    multimodal: false,
    thinking: false,
    subagent: false,
    permission_dialog: true,
    dialog: 'native',
    edit_patch: false,
    model_select: true,
    provider_switch: true,
  },
  // 取值依据见上方 docblock pi 段（design §5.3 能力矩阵；subagent 终值 false
  // ——task-06 实证聚合型无 per-child 归属，见 docblock 与 onboarding §5.3；
  // permission_dialog / dialog 随 2026-09-09-askuser-pi-cursor Wave A 翻值）。
  pi: {
    resume: true,
    mcp: false,
    multimodal: true,
    thinking: true,
    subagent: false,
    permission_dialog: true,
    dialog: 'native',
    edit_patch: false,
    model_select: true,
    provider_switch: true,
  },
  // 取值依据见上方 docblock cursor 段（design「注册（providers.ts）」节；
  // thinking=true 为 task-01 实测修正：顶层 thinking 帧稳定存在且有 fixture，
  // 归一化器已映射 delta→thinking；dialog='marker' 为 2026-09-09-askuser-pi-cursor
  // task-12 初值，spike no-go 则随 task-08 三端改 'none'）。
  cursor: {
    resume: true,
    mcp: false,
    multimodal: false,
    thinking: true,
    subagent: false,
    permission_dialog: false,
    dialog: 'marker',
    edit_patch: false,
    model_select: true,
    provider_switch: false,
  },
};

/**
 * 查询 provider 能力；未知 provider 返回默认拒绝对象，不抛错。
 *
 * 返回已知 provider 的表内对象（调用方只读，勿就地修改——表是模块级共享态）；
 * 未知 provider 每次返回新的默认拒绝字面量（boolean 键全 false、dialog 取
 * 'none'，R-09）。
 */
export function getProviderCaps(provider: string): ProviderCaps {
  const caps = PROVIDER_CAPS[provider];
  if (caps !== undefined) {
    return caps;
  }
  return {
    resume: false,
    mcp: false,
    multimodal: false,
    thinking: false,
    subagent: false,
    permission_dialog: false,
    dialog: 'none',
    edit_patch: false,
    model_select: false,
    provider_switch: false,
  };
}

// ── task-05（FR-05 / design §5.2）：provider 注册表 ───────────────────────────
//
// 分层：上方 PROVIDER_CAPS 是能力矩阵单源（task-02，内容不动）；本节在其上建
// interactive provider 注册表——新增 provider 只加 INTERACTIVE_PROVIDERS 条目，
// InteractiveProvider 联合自动扩展（keyof 推导），driver.ts / types.ts 不再
// 维护字面量联合。本文件由此成为 interactive provider 的唯一注册点
//（caps + family + driver 工厂，2026-09-11-provider-adapter-registry task-01
// 扩展为聚合契约：+ envInjector / fileSettings / perSessionDir / smokeSuite /
// switchable——新引擎接入清单一份声明，见 ProviderAdapter），与批量层
// adapters/index.ts 的 6 协议 × 12 provider 注册表同构：family 复用其
// ProtocolType 联合，取值须与 PROVIDER_TO_PROTOCOL 反查结果一致（守护测试断言）。

/**
 * createDriver 工厂入参（预留形态，本变更不消费）。
 *
 * 现状实读（cli.ts 装配处）：两 driver 均零参构造——`new ClaudeSdkDriver()` /
 * `new CodexAppServerDriver()`，不接收任何注入。工厂照搬该形态（不发明新
 * 注入形态）；deps 位仅作后续 provider profile / envKeys 注入的签名占位。
 */
export interface ProviderDriverDeps {
  /**
   * 预留：provider 环境键注入位（消费方为 descriptor.envKeys 声明的键集）。
   * TODO provider profile 未实现——本变更不实现注入逻辑（design §3 非目标）。
   */
  env?: Record<string, string>;
}

/** interactive provider 注册条目（design §5.2 ProviderDescriptor 契约）。 */
export interface ProviderDescriptor {
  /** detector key（与注册表键、driver 实例的 provider 字段一致）。 */
  provider: string;
  /**
   * 所属协议族（复用 adapters 的 6 协议联合；取值须与 PROVIDER_TO_PROTOCOL
   * 反查一致——interactive 与批量两层共享同一 provider→protocol 映射）。
   */
  family: ProtocolType;
  /** 展示名（对齐 frontend PROVIDER_META 的 label 约定：Claude Code / Codex）。 */
  displayName: string;
  /**
   * driver 工厂：与 cli.ts 现行装配完全等价的零参构造（不发明新注入形态）。
   * 每次调用返回新实例；cli.ts 现行为装配期单例注入，本工厂供注册表消费方
   *（task-05 起注册表就位，构造职责切换归后续任务）。
   */
  createDriver: (deps: ProviderDriverDeps) => InteractiveDriver;
  /** 能力矩阵（单源引用 PROVIDER_CAPS 同名条目，不复制值）。 */
  caps: ProviderCaps;
  /**
   * 预留：provider profile 环境键声明（如 ANTHROPIC_API_KEY）。
   * TODO provider profile 未实现——仅类型占位（design §3 非目标，留后续变更）。
   */
  envKeys?: Record<string, string>;
  /**
   * 预留：上下文文件约定（如 CLAUDE.md / AGENTS.md）。
   * TODO provider profile 未实现——仅类型占位（同上）。
   */
  contextFile?: string;
}

// ── 聚合契约（2026-09-11-provider-adapter-registry task-01 / FR-01）─────────────

/**
 * 文件层写盘器统一接口（design 接口定义段；Grill P1-1：抹平 writeCodexHome /
 * writePiDir 签名与 per-kind 五项差异——write / gate / envKey / dirName /
 * 官方端点 skip）。实现为 codex-settings / pi-settings 的薄适配（写盘器本体
 * 不动）；claude 的 settings.json 链路在 daemon.ts applyClaudeSettings，不落
 * 本接口（聚合表声明为显式 none+理由）。
 */
export interface ProviderFileSettingsWriter {
  /** per-session 目录段名（join(daemonStateDir(), dirName, sessionKey)）。 */
  dirName: 'codex' | 'pi';
  /** 注入 env 键名（CODEX_HOME / PI_CODING_AGENT_DIR）。 */
  envKey: string;
  /** 门槛判定（与写盘器同判据；provider 缺必需字段 → false，调用方 warn 跳过）。 */
  isSufficient: (provider: ProviderConfig) => boolean;
  /** 写盘（目录已建；入参归一：codex 消费 daemonApiKey、pi 不消费）。 */
  write: (input: {
    dir: string;
    provider: ProviderConfig;
    daemonApiKey: string | null;
  }) => Promise<void>;
  /** 官方端点形态跳过判定（pi：base_url 空 → true 静默跳过走 env 层；codex 恒 false）。 */
  skipsOfficialEndpoint: (provider: ProviderConfig) => boolean;
}

/**
 * interactive provider 聚合契约（design Wave 1 步 1 / 接口定义段；D-003@v2——
 * 原地扩展 ProviderDescriptor，不另立契约文件）。新引擎接入 = 聚合表一份声明，
 * 任一必填字段缺失由 `satisfies Record<string, ProviderAdapter>` 编译拦（TS2741）。
 */
export interface ProviderAdapter extends ProviderDescriptor {
  /**
   * env 层注入器懒工厂（函数形态 = import 环解法的一半：本文件与
   * credential-injector.ts 互相仅在函数体内访问）；或显式 none+理由
   *（codex：二进制无 env 注入面，凭证走文件层——spike A1；原 REGISTRY 注释
   *  升格为声明式元数据）。
   */
  envInjector: (() => CredentialInjector) | { kind: 'none'; reason: string };
  /** 文件层写盘器或显式 none+理由（claude：settings.json 链路在 daemon.ts）。 */
  fileSettings: ProviderFileSettingsWriter | { kind: 'none'; reason: string };
  /**
   * per-session 目录类型（目录清理 / 孤儿清扫 / restore 探测 / 热切换重写 /
   * reload 门控的统一数据源）；claude / cursor 无 per-session provider file
   * dirs → 显式 none（claude 会话目录走 CLAUDE_CONFIG_DIR 另一链路）。
   */
  perSessionDir: 'codex' | 'pi' | { kind: 'none' };
  /** 冒烟套件文件名（守护测试校验真实存在且覆盖全部支持格式，Wave 4 消费）。 */
  smokeSuite: string;
  /** 会话级供应商切换支持（与 caps.provider_switch 单源一致，测试锁定）。 */
  switchable: boolean;
}

/**
 * 取 provider 的 caps 表项（注册表初始化守卫）。
 *
 * 单源约束：注册表条目的 caps 引用 PROVIDER_CAPS 同名键（引用而非复制）。
 * 本守卫在模块加载时校验存在性——注册表加了键而 caps 表未同步（或拼写
 * 漂移）立即抛错，防止两表静默失同步（backend 对齐守护测试只比对 caps
 * 表键值，不覆盖注册表侧的引用关系）。
 */
function capsOf(provider: string): ProviderCaps {
  const caps = PROVIDER_CAPS[provider];
  if (caps === undefined) {
    throw new Error(
      `INTERACTIVE_PROVIDERS.${provider} 缺少 PROVIDER_CAPS 同名条目（caps 单源失同步）`,
    );
  }
  return caps;
}

/**
 * interactive provider 聚合注册表（design §5.2 + 2026-09-11-provider-adapter-
 * registry task-01 / D-003@v2；claude / codex / cursor / pi 四键——cursor 为
 * 2026-09-08-cursor-interactive-session task-05 接入）。
 *
 * `satisfies` 手法：不 widen 键类型，`keyof typeof INTERACTIVE_PROVIDERS`
 * 保持 'claude' | 'codex' | 'cursor' | 'pi' 字面量联合——InteractiveProvider 由此推导（单源）。
 * 新引擎接入 = 在此加一份 ProviderAdapter 声明（caps 同步进上方 PROVIDER_CAPS
 * + backend/frontend 两端镜像），缺任一必填字段 satisfies 即 TS2741 编译红；
 * 类型系统自动扩展，无需改 driver.ts / types.ts 的联合定义。全引擎覆盖由守护
 * 测试跨注册表对账（agent-detector 检测键 + backend agent_kind 词表，Wave 4）。
 */
export const INTERACTIVE_PROVIDERS = {
  claude: {
    provider: 'claude',
    family: 'stream_json',
    displayName: 'Claude Code',
    // 返回类型显式标注为契约接口：切断「注册表 → driver 类 → handle.provider:
    // InteractiveProvider → keyof 注册表」的类型推理环（否则 TS7022/TS2456）。
    createDriver: (): InteractiveDriver => new ClaudeSdkDriver(),
    caps: capsOf('claude'),
    // ── 聚合契约五成员（task-01；派生改造归 task-02，本表先声明数据源）──
    // env 层注入器懒工厂（构造在函数体内，模块初始化零执行——环纪律见文件头）。
    envInjector: () => new ClaudeCredentialInjector(),
    // claude 的 settings.json 链路在 daemon.ts applyClaudeSettings（另一链路，
    // 不属 per-session provider file dirs 写盘器范畴）。
    fileSettings: {
      kind: 'none',
      reason: 'claude settings.json 链路在 daemon.ts applyClaudeSettings',
    },
    // claude 会话目录走 CLAUDE_CONFIG_DIR 另一链路，无 per-session provider file dir。
    perSessionDir: { kind: 'none' },
    // env 层注入锚点（claude 无写盘器，冒烟取注入器套件）。
    smokeSuite: 'tests/credential-injector.test.ts',
    switchable: true,
  },
  codex: {
    provider: 'codex',
    family: 'json_rpc',
    displayName: 'Codex',
    createDriver: (): InteractiveDriver => new CodexAppServerDriver(),
    caps: capsOf('codex'),
    // ── 聚合契约五成员（task-01）──
    // codex 0.147 二进制无 env 注入面，凭证走文件层（spike A1）——原
    // credential-injector.ts REGISTRY 注释升格为声明式元数据（REGISTRY 派生化归 task-02）。
    envInjector: {
      kind: 'none',
      reason: 'codex 0.147 二进制无 env 注入面，凭证走文件层（spike A1）',
    },
    // 写盘器薄适配字面量：wrap writeCodexHome / isCodexFormSufficient（写盘器
    // 本体不动；write/skipsOfficialEndpoint 方法体内引用=惰性，isSufficient 取
    // 绑定——provider-file-settings.ts 不回引本文件，环纪律见文件头）。
    fileSettings: {
      dirName: 'codex',
      envKey: 'CODEX_HOME',
      isSufficient: isCodexFormSufficient,
      write: ({ dir, provider, daemonApiKey }) =>
        writeCodexHome({ codexHome: dir, provider, daemonApiKey }),
      skipsOfficialEndpoint: () => false,
    },
    perSessionDir: 'codex',
    smokeSuite: 'tests/provider-injection-smoke.integ.test.ts',
    switchable: true,
  },
  // cursor：family='stream_json' 与批量层 PROVIDER_TO_PROTOCOL 反查一致
  //（PROTOCOL_PROVIDERS.stream_json 含 cursor，守护测试断言）；displayName='Cursor'；
  // 返回类型显式标注 InteractiveDriver，切断「注册表 → driver 类 → handle.provider:
  // InteractiveProvider → keyof 注册表」类型推理环（同 claude 条目注释先例）。
  cursor: {
    provider: 'cursor',
    family: 'stream_json',
    displayName: 'Cursor',
    createDriver: (): InteractiveDriver => new CursorDriver(),
    caps: capsOf('cursor'),
    // ── 聚合契约五成员（task-01）──
    // cursor 私有 ConnectRPC 云协议无 BYO 注入面（spike C）——env / 文件层全 none。
    envInjector: {
      kind: 'none',
      reason: 'cursor 私有 ConnectRPC 云协议无 BYO 注入面（spike C）',
    },
    fileSettings: { kind: 'none', reason: '无注入面' },
    perSessionDir: { kind: 'none' },
    // driver 层锚点（cursor 无写盘器与 env 注入器，冒烟取 driver 套件）。
    smokeSuite: 'tests/interactive/cursor-driver.test.ts',
    switchable: false,
  },
  // pi：family='pi_json' 与批量层 PROVIDER_TO_PROTOCOL 反查一致（守护测试断言）；
  // displayName='PI'；driver 当前为 task-04 占位（零参构造可实例化，契约方法
  // NotImplemented），真实 rpc 实现归 task-02/06 替换 pi-rpc-driver.ts。
  pi: {
    provider: 'pi',
    family: 'pi_json',
    displayName: 'PI',
    createDriver: (): InteractiveDriver => new PiRpcDriver(),
    caps: capsOf('pi'),
    // ── 聚合契约五成员（task-01）──
    // env 层注入器懒工厂（构造在函数体内，模块初始化零执行——环纪律见文件头）。
    envInjector: () => new PiCredentialInjector(),
    // 写盘器薄适配字面量：wrap writePiDir / isPiFormSufficient；官方端点形态
    //（base_url 空）跳过写盘、静默走 env 层（pi-settings 同判据 nonEmptyStr）。
    fileSettings: {
      dirName: 'pi',
      envKey: 'PI_CODING_AGENT_DIR',
      isSufficient: isPiFormSufficient,
      write: ({ dir, provider }) => writePiDir({ piDir: dir, provider }),
      skipsOfficialEndpoint: (provider) =>
        typeof provider.base_url !== 'string' || provider.base_url.length === 0,
    },
    perSessionDir: 'pi',
    smokeSuite: 'tests/provider-injection-smoke.integ.test.ts',
    switchable: true,
  },
} satisfies Record<string, ProviderAdapter>;

/**
 * interactive provider 联合（FR-05：从注册表推导，单源）。
 *
 * driver.ts 原字面量联合 `'claude' | 'codex'` 已改为 re-export 本类型
 *（既有 `from './driver.js'` 导入路径零改动）；types.ts / session-manager.ts
 * 的 provider 字段引用本类型——新增 provider 时除注册表条目外无需再改任何
 * 联合定义。
 */
export type InteractiveProvider = keyof typeof INTERACTIVE_PROVIDERS;
