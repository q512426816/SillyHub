/**
 * interactive/session-manager/driver-factory.ts —— 驱动获取 / 主 agent MCP 解析 /
 * driver options 构造簇。
 *
 * task-02（2026-09-07-arch-large-file-split）：原 SessionManager 的 _getDriver /
 * _resolveMainAgentMcp / _buildDriverOptions 方法体原样下沉（仅 ``this`` → ``mgr``
 * 改显式传参，行为零变化）。
 *
 * @module interactive/session-manager/driver-factory
 */

// task-05（FR-05 / design §5.2）：provider 注册表（INTERACTIVE_PROVIDERS 单源，
// InteractiveProvider 联合由其推导）。运行时 import——_getDriver 读注册表做
// provider 合法性门控；经 providers.ts 传递引入两 driver 模块（均为纯定义，
// 模块加载无副作用，与 cli.ts 显式 import 等价）。
import { INTERACTIVE_PROVIDERS, type ProviderDescriptor } from '../providers.js';
import type {
  InteractiveDriver,
  InteractiveProvider,
  McpServerConfigForDriver,
} from '../driver.js';
import type { SessionState } from '../types.js';
import { UnsupportedProviderError } from '../types.js';
// task-10（C-12 / D-017）：主 agent MCP 注入按 profile.mcpRefs 子集过滤（mergeMcpConfigs
// 第三层）。McpConfig 用于把 driver 契约的 MCP 配置表转成 mergeMcpConfigs 入参形态。
import {
  DAEMON_MCP_SERVER_NAME,
  FILE_MCP_SERVER_NAME,
  injectMcpSessionId,
  mergeMcpConfigs,
  WORKER_MCP_SERVER_NAME,
  type McpConfig,
} from '../../mcp-config.js';
import type {
  CanUseToolFn,
  DriverOptionsSpec,
  MainAgentMcpContext,
  SessionManagerCore,
} from './types.js';
import { _SDK_WRITE_TOOLS } from './types.js';

/**
 * D-001@v1（task-02）→ task-05（FR-05 / design §5.2）：按 provider 取已注册 driver，
 * 改读 INTERACTIVE_PROVIDERS 注册表。未注册 → 抛 UnsupportedProviderError。
 *
 * 两道门控（纯重构，错误语义/文案与 task-02 完全一致）：
 *   1. 注册表门：provider 不在 INTERACTIVE_PROVIDERS（运行时收到联合外的
 *      串）→ UnsupportedProviderError——provider 合法性以注册表为单源；
 *   2. 实例门：注册表已知但 `deps.drivers` 未注入该实例（含旧 `deps.driver`
 *      → `_drivers.claude` 兼容映射仍未覆盖的 provider）→ 同样抛
 *      UnsupportedProviderError，保持「driver 未注入即不支持」语义（既有
 *      session-manager 测试锚定此行为）。
 *
 * 兼容入口：`deps.driver`（ClaudeSdkDriver）经构造函数已映射到 `_drivers.claude`，
 * 故 claude 路径无论走 `drivers` registry 还是旧 `driver` 入参都能取到 driver。
 * descriptor.createDriver 工厂已在注册表就位（零参构造等价 cli.ts 现行 new），
 * 但本方法不自动构造——注入实例是现行唯一实例来源（cli.ts 单例注入 + 测试
 * mock 注入），让 _getDriver 兜底构造会让未注入 provider 静默落到真实 driver，
 * 属行为变更（既有 UnsupportedProviderError 用例回归），归后续任务决策。
 * 文案保留现有 Wave1/2 模板（codex 未注入时仍抛此错）。
 */
export function getDriver(
  mgr: SessionManagerCore,
  provider: InteractiveProvider,
): InteractiveDriver {
  // 宽化索引：provider 形参类型是注册表联合，但运行时可能收到联合外字符串
  //（daemon/持久层透传），按 Record<string, ...> 查防 noUncheckedIndexedAccess 盲区。
  const descriptor = (INTERACTIVE_PROVIDERS as Record<
    string,
    ProviderDescriptor | undefined
  >)[provider];
  if (descriptor === undefined) {
    throw new UnsupportedProviderError(provider);
  }
  const driver = mgr._drivers[provider];
  if (!driver) {
    throw new UnsupportedProviderError(provider);
  }
  return driver;
}

/**
 * task-06（D-007@v2）：归一化 MainAgentMcpContext + 调谓词/provider 决定主 agent
 * MCP server 配置。
 *
 * create 路径从 ``CreateSessionInput``、restore 路径从 ``PersistedSessionRecord``
 * 各自抽出 sessionId/leaseId/provider/cwd/model 构造 ctx（两者都含这些字段），
 * 再统一调 ``isMainAgentSession`` 判定 + ``mainAgentMcpConfigProvider`` 取配置。
 *
 * task-06（2026-08-25-team-subsession-governance / D-003@v1，design §5.C.1）：
 * 分身分支在最前——``isWorkerSession`` 判定为 mission_worker 时取
 * ``workerMcpConfigProvider`` 的受限配置表（仅 worker_done 单工具的
 * sillyhub-worker server），**不进**主控分支（5 编排工具不进分身，递归闸）。
 * 与主控注入同机制（谓词 + provider）、不同工具集；create / restore / reload
 * 三路共用本方法，一处分支三路生效。
 *
 * 返回 undefined 的三种情况（均不注入，普通会话零回归）：
 *   1. 谓词未注入 / 返回 false（非主 agent session）；
 *   2. provider 未注入；
 *   3. provider 返回 undefined / 空对象。
 */
export function resolveMainAgentMcp(
  mgr: SessionManagerCore,
  ctx: MainAgentMcpContext,
):
  | Record<string, McpServerConfigForDriver>
  | undefined {
  // ── 分身受限分支（task-06 / design §5.C.1，优先于主控判定）──
  if (mgr._isWorkerSession?.(ctx) === true) {
    const workerConfig = mgr._workerMcpConfigProvider?.(ctx);
    if (!workerConfig) return undefined;
    // injectMcpSessionId 补写受限 server 名（WORKER_MCP_SERVER_NAME）的
    // MCP_SESSION_ID——受限 server 的 worker_done 调用靠 X-Session-Id 定位分身
    // 子会话（backend 沿 parent 链爬根解析 mission，缺头 400）。浅拷贝语义，
    // provider 闭包持有的配置不被污染（与主控分支同机制）。
    return injectMcpSessionId(
      workerConfig,
      ctx.sessionId,
      WORKER_MCP_SERVER_NAME,
    );
  }
  if (mgr._isMainAgentSession?.(ctx) !== true) return undefined;
  const config = mgr._mainAgentMcpConfigProvider?.(ctx);
  if (!config) return undefined;
  // task-10（2026-08-22-team-session-unify / FR-04 / spike-01）：会话上下文注入。
  // MCP server 子进程只继承白名单 + per-server env（spike-01 结论），会话 id 必须
  // 写进 mcpServers['sillyhub-daemon'].env（MCP_SESSION_ID）；cli.ts provider
  // （task-09 定型，不在本任务 allowed_paths）不传 sessionId，故在 provider 返回后
  // 按 ctx.sessionId 补写。create / restore / reload 三路共用本方法——每次 spawn
  // 都重新解析，session id 变化即 env 变化（spike-01 执行指令 1）。
  // task-06（2026-08-23-agent-file-upload-mcp / FR-02）：sillyhub-file server 读
  // 同名 MCP_SESSION_ID env 定位会话（design §6），与 sillyhub-daemon 同管道补写
  // ——调用两次 injectMcpSessionId（serverName 参数已可选，不改其签名），仍仅补
  // 两个 daemon 内置 server 条目，其它 MCP server 不注入（env 卫生）。
  const withDaemonSessionId = injectMcpSessionId(config, ctx.sessionId, DAEMON_MCP_SERVER_NAME);
  const withSessionId = injectMcpSessionId(withDaemonSessionId, ctx.sessionId, FILE_MCP_SERVER_NAME);
  // task-10（C-12 / FR-10 / D-017）：profile.mcpRefs 子集过滤。
  // 非空 mcpRefs 时对 provider 返回的 MCP 配置表按此 ∩ 过滤（mergeMcpConfigs 第三层，
  // 与 batch task-runner 同源逻辑）。cli.ts mainAgentMcpConfigProvider 产出的配置表
  // 已含 daemon 内置 MCP server（sillyhub-daemon / sillyhub-file，task-06）；若
  // profile.mcpRefs 未列入某 server，它会被剔除——这是 profile 收紧语义的正确表现
  // （profile 只允许它声明的子集）。task-06：sillyhub-file 与 sillyhub-daemon 同语义
  // 受过滤、不单独豁免（design §9；需要常驻的 profile 显式列名即可）。
  // 空数组/undefined → 不过滤（FR-15 行为同今天，provider 原样返回）。
  const mcpRefs = ctx.mcpRefs;
  if (!mcpRefs || mcpRefs.length === 0) return withSessionId;
  // 转 McpConfig 入参（补 type:'stdio' + args 默认 []，满足 mergeMcpConfigs 类型 +
  // D-017 stdio 校验）。McpServerConfigForDriver 与 McpServerConfig 结构兼容（command/
  // args/env 同名同义），只是 args 可选 vs 必填、type 缺省——这里归一化补齐。
  const mcpConfigInput: McpConfig = {
    mcpServers: Object.fromEntries(
      Object.entries(withSessionId).map(([name, cfg]) => [
        name,
        {
          type: 'stdio' as const,
          command: cfg.command,
          args: cfg.args ?? [],
          ...(cfg.env ? { env: cfg.env } : {}),
        },
      ]),
    ),
  };
  const merged = mergeMcpConfigs([], mcpRefs, mcpConfigInput);
  // 转回 driver 契约类型（过滤后子集）。
  const result: Record<string, McpServerConfigForDriver> = {};
  for (const [name, cfg] of Object.entries(merged.config.mcpServers)) {
    result[name] = {
      command: cfg.command,
      ...(cfg.args ? { args: cfg.args } : {}),
      ...(cfg.env ? { env: cfg.env } : {}),
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * task-02（R7/D-008）：构造 provider-neutral driver options。create 与
 * restoreAndReconnect 复用，保证 Claude canUseTool/onUserDialog 注入逻辑单一来源
 *（FR-10 不回退：行为与改造前逐行等价，仅从 create/restore 抽出到此 helper）。
 *
 * 职责：
 *   1. 构造 driverOpts base（exe path / cwd / model / allowedTools / env）；
 *      exe 字段同时填 pathToClaudeCodeExecutable（Claude driver 读）和
 *      pathToAgentExecutable（Codex driver 读，task-04），按 provider 决定主字段。
 *   2. enableApproval=true 且 resolverFactory/wsClient 就绪时：建独立 resolver +
 *      注入 canUseTool（_buildCanUseToolCallback，内部调 _requestPermission）+
 *      onUserDialog（supportedDialogKinds 非空时）。
 *   3. task-06：spec.mcpServers 非空时透传到 driverOpts.mcpServers（主 agent
 *      MCP tool 注入，让主 agent discover daemon MCP server 5 tool）。普通会话
 *      spec.mcpServers 缺省 undefined → 不传 → driver 走默认（零回归）。
 *
 * @param state 当前 session（写 driver 归属、读 provider）
 * @param spec exePath/model/allowedTools/env/enableApproval/effectiveAskUserOnly/resume/mcpServers
 */
export function buildDriverOptions(
  mgr: SessionManagerCore,
  state: SessionState,
  spec: DriverOptionsSpec,
): Record<string, unknown> {
  const driverOpts: Record<string, unknown> = {
    // Claude driver 读 pathToClaudeCodeExecutable；Codex driver 读 pathToAgentExecutable。
    // 两字段都填 exePath，各 driver 取自己需要的（provider-neutral，不依赖 SessionManager 知道）。
    pathToClaudeCodeExecutable: spec.exePath,
    pathToAgentExecutable: spec.exePath,
    cwd: state.cwd,
    // ql-20260624-007：透传 sessionId 给 codex driver 落盘 stdout 诊断日志
    //（claude driver 忽略此字段；provider-neutral 填充，各 driver 按需取）。
    sessionId: state.sessionId,
  };
  if (spec.model !== undefined) {
    driverOpts.model = spec.model;
  }
  if (spec.allowedTools !== undefined) {
    driverOpts.allowedTools = spec.allowedTools;
  }
  // gap-8：仅当传入 env 时覆盖（缺省让 driver 回退裸 process.env，兼容）。
  if (spec.env !== undefined) {
    driverOpts.env = spec.env;
  }
  if (spec.resume !== undefined) {
    driverOpts.resume = spec.resume;
  }
  // task-06（D-007@v2）：主 agent MCP tool 注入。spec.mcpServers 由 create/
  // restoreAndReconnect 按主 agent 判定 + provider 构造后传入；非空时透传到
  // driverOpts.mcpServers，driver（Claude SDK）把它传给 SDK options.mcpServers
  // 让主 agent discover daemon MCP server 5 tool。普通会话不传（undefined）。
  if (spec.mcpServers !== undefined) {
    driverOpts.mcpServers = spec.mcpServers;
  }
  // task-05（2026-08-13-profile-system-prompt-injection）：profile.system_prompt 注入。
  // preset:claude_code + append：保留 claude 默认能力（编码/工具/use-tool）+ 追加档案
  // 提示词（sdk.d.ts:1911-1918「Default with additions」）。仅 claude driver 消费此字段
  //（codex 等 StartOptions 无 systemPrompt，编译期不让赋，D-005）。
  if (spec.systemPrompt !== undefined) {
    driverOpts.systemPrompt = {
      type: 'preset',
      preset: 'claude_code',
      // ql-20260818-004：null=取消档案 → preset-only（claude 默认人格，无追加）。
      append: spec.systemPrompt ?? undefined,
    };
    // ql-20260818-002/004：SDK 的 systemPrompt 选项在 **resume** 时被 CLI 忽略
    // （会话 jsonl 固化创建时的 system prompt）——SDK 官方机制 forkSession=true
    // 让 resume fork 出新会话 ID，新 system prompt 对 fork 生效且历史完整复制。
    // 由 reloadWithConfig 显式决策（仅档案维度被切时 fork；provider-only 切换
    // 人格已在 jsonl 固化，resume 自然保留，fork 只会白白换 session id）。
    if (spec.forkSession === true) {
      driverOpts.forkSession = true;
    }
  }
  // scan 真阻塞（per-session，generic-wibbling-whisper.md 改造点 C/D）：
  // enableApproval=true 时按 session 建独立 resolver + 注入远程人审 canUseTool +
  // onUserDialog，让 scan 真阻塞等人审（chat=false 不注入 AskUserQuestion 人审，
  // 但见下方 allowed_roots 写拦截：注入 provider 后 chat 也注入 canUseTool 做写校验）。
  // 行为与改造前逐行等价（FR-10）+ allowed_roots 写拦截增量（2026-06-29）。
  // 显式 permissionMode=default（2026-06-30 修 bug：SDK permissionMode 缺失时
  // 可能沿用 session resume 的旧状态，绕过 canUseTool → 写守卫失效）。
  // 2026-07-08 D-002：撤回 635c0d4a 的 bypassPermissions。canUseTool 注入是无条件
  // 的（writeGuardEnabled 即注入），bypassPermissions 下 SDK 仍调 canUseTool，
  // 未生效且语义混淆。5min 超时真实根因是 ask_user_only=false（task-01 修）。
  driverOpts.permissionMode = 'default';
  const approvalReady =
    spec.enableApproval &&
    !!mgr._permissionResolverFactory &&
    !!mgr._permissionWsClient;
  // interactive CC 写拦截（2026-06-29）+ task-14（design §5.2 PolicyEngine）：
  // 注入 policyEngine（优先）或 allowedRootsProvider（fallback）后，无论
  // enableApproval true/false，都给 Claude driver 注入 canUseTool（写工具白名单前置
  // 校验）。enableApproval=true 时 canUseTool = 写校验 + 远程人审；false 时
  // canUseTool = 写校验 + 直接 allow。读工具不拦（读自由）。
  const writeGuardEnabled = !!mgr._policyEngine || !!mgr._allowedRootsProvider;
  if (approvalReady) {
    const resolver = mgr._permissionResolverFactory!();
    mgr._resolversBySession.set(state.sessionId, resolver);
    const inner = mgr._buildCanUseToolCallback(
      state.sessionId,
      spec.effectiveAskUserOnly,
    );
    driverOpts.canUseTool = writeGuardEnabled
      ? mgr._wrapWithWriteGuard(state.sessionId, state.provider, inner)
      : inner;
    // onUserDialog 路由（SDK request_user_dialog 路径）：supportedDialogKinds 非空才注入。
    // ⚠️ AskUserQuestion 在 SDK headless 模式实际不走 onUserDialog（经 canUseTool 拦截）；
    // 此处仅对 SDK 真正发出 request_user_dialog 的其他 kind 生效。默认 ['AskUserQuestion']
    // 历史值，保留向后兼容。
    if (mgr._supportedDialogKinds && mgr._supportedDialogKinds.length > 0) {
      driverOpts.onUserDialog = mgr._buildOnUserDialogCallback(
        state.sessionId,
      );
      driverOpts.supportedDialogKinds = mgr._supportedDialogKinds;
    }
    // task-06（D-008@v1 / task-05）：Codex driver 的 sessionPermission hooks 注入。
    // Codex driver 经 CodexStartOptions.sessionPermission 读这两个方法引用（task-05
    // approval/user-input/elicitation 映射）。绑定到当前 session 的 SessionManager
    // public 入口（requestPermission/requestUserDialog，签名与 CodexSessionPermissionHooks
    // 一致）。manualApproval=true 时注入；未注入时 driver 走 fail-closed 占位（task-05
    // 既有测试语义）。仅 codex provider 走此分支（Claude 用 canUseTool/onUserDialog）。
    if (state.provider === 'codex') {
      // 参数类型与 CodexSessionPermissionHooks 契约一致（与 SessionManager public
      // requestPermission/requestUserDialog 入参同形，去掉 sessionId 由闭包绑定）。
      driverOpts.sessionPermission = {
        requestPermission: (input: {
          toolName: string;
          toolInput: Record<string, unknown>;
          signal?: AbortSignal;
          toolUseId?: string;
          isUserInputKind?: boolean;
        }) => mgr.requestPermission(state.sessionId, input),
        requestUserDialog: (input: {
          dialogKind: string;
          dialogPayload: Record<string, unknown>;
          toolUseId?: string;
          signal?: AbortSignal;
        }) => mgr.requestUserDialog(state.sessionId, input),
      };
    }
  } else if (writeGuardEnabled) {
    // 默认 chat（enableApproval=false）：注入「写校验 only」canUseTool。
    // 不依赖 resolver/wsClient（纯本地校验）：写工具白名单外 deny、白名单内 allow；
    // 读工具 / 其他 allow（读自由）。SDK 不会因 canUseTool 注入而走人审（人审只在
    // approvalReady 分支内经 resolver.register 触发）。
    const inner = mgr._buildWriteOnlyCanUseToolCallback(state.sessionId);
    driverOpts.canUseTool = mgr._wrapWithWriteGuard(
      state.sessionId,
      state.provider,
      inner,
    );
  }
  // 2026-08-06-public-mcp-server verify 修复（read_only 物制 layer 3 / G3 / D-005@v2）：
  // read_only worker 的 allowed_tools=[Read,Glob,Grep] 经 create→driverOpts 传到 SDK 的
  // allowedTools 字段，但 SDK allowedTools 非严格白名单（无 canUseTool 时 headless 默认
  // 全批准；有写守卫时写守卫按路径放行 Write/Edit/Bash）→ read_only 实测仍能写。故在
  // canUseTool 最外层包一道白名单拒绝：toolName 不在 allowedTools 直接 deny，先于写守卫
  // /默认批准。absent（非 read_only worker）→ 不包，零回归。
  if (spec.allowedTools !== undefined) {
    const _roWhitelist = new Set(spec.allowedTools);
    const _innerCanUse = driverOpts.canUseTool as CanUseToolFn | undefined;
    // R-10 修复（2026-08-28-daemon-agent-share E2E）：SDK allowedTools 语义是
    // 「auto-allowed without prompting——execute automatically without asking for
    // approval」（sdk.d.ts:1420-1424），成员**不经过 canUseTool**。平台共享会话
    // 白名单含 Write/Edit → 写调用被 SDK 直接自动执行，写守卫（overlay 交集收紧/
    // PolicyCache 机器级）从未被调用 → 目录外写放行且零审计（E2E 实证）。修法：
    // 写守卫链存在时把**写类工具从 SDK 层预批准集摘除**（读/mcp 保留预批准，免每
    // 读一次过回调），写工具改经 canUseTool 链——gate 白名单仍用完整 spec 列表
    // （Write 在其中过 gate）→ 写守卫路径校验。read_only worker 列表无写工具，
    // filter 后不变，行为逐字节不变（G3 零回归）。
    if (_innerCanUse) {
      const sdkPreapproved = spec.allowedTools.filter((t) => !_SDK_WRITE_TOOLS.has(t));
      if (sdkPreapproved.length > 0) {
        driverOpts.allowedTools = sdkPreapproved;
      } else {
        delete driverOpts.allowedTools;
      }
    }
    const _roGate: CanUseToolFn = async (toolName, input, options) => {
      if (!_roWhitelist.has(toolName)) {
        return {
          behavior: 'deny',
          message: `read_only: tool '${toolName}' not in allowed_tools whitelist [${[..._roWhitelist].join(',')}]`,
        };
      }
      return _innerCanUse ? _innerCanUse(toolName, input, options) : { behavior: 'allow' };
    };
    driverOpts.canUseTool = _roGate;
  }
  return driverOpts;
}
