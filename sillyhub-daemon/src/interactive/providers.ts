/**
 * interactive/providers.ts —— interactive provider 能力矩阵（ProviderCaps）。
 *
 * 出处：2026-09-03-agent-provider-abstraction task-02（design §5.2）。
 *
 * 分层说明：本文件是 ProviderCaps 能力矩阵的**唯一维护源**（daemon 单源）；
 * backend `app/modules/agent/provider_caps.py` 与 frontend `src/lib/provider-caps.ts`
 * 为手工镜像，三端键集合与每个 provider 每键取值必须一致，一致性由
 * `backend/app/modules/agent/tests/test_provider_caps_alignment.py` 以源文件
 * 读取方式守护（读表源比对，不复制值断言）。task-05 再在本文件扩展
 * ProviderDescriptor / INTERACTIVE_PROVIDERS 注册表（createDriver / family /
 * displayName 等），本 task 只落 caps 表基座。
 *
 * 取值约定：caps 描述 provider 当前真实能力（以本仓现状硬编码门控为准，
 * 不臆断），缺省 false 默认拒绝（FR-06 / D-002@v1）；未知 provider 查询
 * 返回全 false 对象，不抛错。改取值先改本文件，再同步两端镜像。
 */

import type { ProtocolType } from '../adapters/index.js';
import type { InteractiveDriver } from './driver.js';
import { ClaudeSdkDriver } from './claude-sdk-driver.js';
import { CodexAppServerDriver } from './codex-app-server-driver.js';

/** provider 能力矩阵（8 键全 boolean，缺省 false 默认拒绝）。 */
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
  /** Edit 工具 structuredPatch（差异渲染数据源）。 */
  edit_patch: boolean;
  /** 模型选择（创建会话时的模型覆盖生效）。 */
  model_select: boolean;
}

/**
 * 各 provider 能力取值（单源；backend / frontend 手工镜像须同步）。
 *
 * 每项取值依据（2026-09-03 task-02 实读现状硬编码门控，行号为当时锚点）：
 *
 * claude（8 项全 true）：
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
 * - edit_patch：backend daemon/run_sync/service.py:1476-1478 / 3679
 *   structuredPatch 取自 Claude SDK tool_use_result 形状；
 * - model_select：src/interactive/driver.ts:122-123 model「模型覆盖」
 *   provider-neutral；src/interactive/claude-sdk-driver.ts:383-384
 *   `options.model = opts.model`。
 *
 * codex（3 项 true）：
 * - resume：backend service.py:6335 白名单 `{"claude", "codex"}` 含 codex
 *   （driver.ts:120-121 Codex threadId resume）；
 * - permission_dialog：src/interactive/session-manager.ts:1776-1790 codex 分支
 *   注入 sessionPermission{requestPermission, requestUserDialog}（同 approvalReady
 *   块，Claude 用 canUseTool/onUserDialog、codex 用 hooks——两桥等价支持）；
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
 */
export const PROVIDER_CAPS: Record<string, ProviderCaps> = {
  claude: {
    resume: true,
    mcp: true,
    multimodal: true,
    thinking: true,
    subagent: true,
    permission_dialog: true,
    edit_patch: true,
    model_select: true,
  },
  codex: {
    resume: true,
    mcp: false,
    multimodal: false,
    thinking: false,
    subagent: false,
    permission_dialog: true,
    edit_patch: false,
    model_select: true,
  },
};

/**
 * 查询 provider 能力；未知 provider 返回全 false 对象（默认拒绝），不抛错。
 *
 * 返回已知 provider 的表内对象（调用方只读，勿就地修改——表是模块级共享态）；
 * 未知 provider 每次返回新的全 false 字面量。
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
    edit_patch: false,
    model_select: false,
  };
}

// ── task-05（FR-05 / design §5.2）：provider 注册表 ───────────────────────────
//
// 分层：上方 PROVIDER_CAPS 是能力矩阵单源（task-02，内容不动）；本节在其上建
// interactive provider 注册表——新增 provider 只加 INTERACTIVE_PROVIDERS 条目，
// InteractiveProvider 联合自动扩展（keyof 推导），driver.ts / types.ts 不再
// 维护字面量联合。本文件由此成为 interactive provider 的唯一注册点
//（caps + family + driver 工厂），与批量层 adapters/index.ts 的 6 协议 ×
// 12 provider 注册表同构：family 复用其 ProtocolType 联合，取值须与
// PROVIDER_TO_PROTOCOL 反查结果一致（守护测试断言）。

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
 * interactive provider 注册表（design §5.2；claude / codex 两键）。
 *
 * `satisfies` 手法：不 widen 键类型，`keyof typeof INTERACTIVE_PROVIDERS`
 * 保持 'claude' | 'codex' 字面量联合——InteractiveProvider 由此推导（单源）。
 * 新增 provider 在此加条目（caps 同步进上方 PROVIDER_CAPS + backend/frontend
 * 两端镜像），类型系统自动扩展，无需改 driver.ts / types.ts 的联合定义。
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
  },
  codex: {
    provider: 'codex',
    family: 'json_rpc',
    displayName: 'Codex',
    createDriver: (): InteractiveDriver => new CodexAppServerDriver(),
    caps: capsOf('codex'),
  },
} satisfies Record<string, ProviderDescriptor>;

/**
 * interactive provider 联合（FR-05：从注册表推导，单源）。
 *
 * driver.ts 原字面量联合 `'claude' | 'codex'` 已改为 re-export 本类型
 *（既有 `from './driver.js'` 导入路径零改动）；types.ts / session-manager.ts
 * 的 provider 字段引用本类型——新增 provider 时除注册表条目外无需再改任何
 * 联合定义。
 */
export type InteractiveProvider = keyof typeof INTERACTIVE_PROVIDERS;
