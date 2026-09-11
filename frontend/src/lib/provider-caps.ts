/**
 * provider 能力矩阵（ProviderCaps）前端表 —— **本文件为生成产物，勿手改**。
 *
 * @generated 由 sillyhub-daemon/scripts/gen-provider-caps.mjs 生成；唯一维护源 =
 * sillyhub-daemon/src/interactive/providers.ts 的 PROVIDER_CAPS（取值依据锚点
 * 注释在单源侧）。重跑生成：node sillyhub-daemon/scripts/gen-provider-caps.mjs
 * （frontend `pnpm gen:types` 链尾已自动执行）。
 *
 * 镜像约定（三端同步，单源 = daemon 侧，2026-09-11-provider-adapter-registry
 * task-04 起手抄镜像退役）：daemon 单源改取值后重跑生成脚本，本文件与 backend
 * app/modules/agent/provider_caps.py 随脚本一并刷新；三端键集合（10 键：
 * 9 个 boolean + dialog string 枚举）与每个 provider 每键取值一致性由
 * backend/app/modules/agent/tests/test_provider_caps_alignment.py 以源文件
 * 读取方式守护（任一端漂移即测试失败）。
 *
 * 取值语义：caps 描述 provider 当前真实能力，9 个 boolean 键缺省 false 默认
 * 拒绝（FR-06 / D-002@v1）；dialog 为 string 枚举键（'native' = 走平台
 * dialog 管道 / 'marker' = 纯前端标记协议 / 'none' = 无通道）；未知 provider
 * 查询返回默认拒绝对象（boolean 键全 false、dialog 取 'none'），不抛错。
 */

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
   * 2026-09-09-askuser-pi-cursor task-12 加入）：'native' = 走平台 dialog
   * 管道（permission_dialog 桥，pending 行 + 答题端点）；'marker' = 纯前端
   * 标记协议（消息尾部 askuser fenced 块，不经后端 dialog 管道）；'none' =
   * 无通道（未知 provider 回退值）。
   */
  dialog: 'native' | 'marker' | 'none';
  /** Edit 工具 structuredPatch（差异渲染数据源）。 */
  edit_patch: boolean;
  /** 模型选择（创建会话时的模型覆盖生效）。 */
  model_select: boolean;
  /** 会话级供应商切换支持（第 10 键，与 daemon 单源 adapter.switchable 同源）。 */
  provider_switch: boolean;
}

/**
 * 各 provider 能力取值（生成自 daemon 单源；取值依据锚点见
 * sillyhub-daemon/src/interactive/providers.ts 的 PROVIDER_CAPS docblock）。
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

/**
 * 会话级供应商切换已解锁的引擎白名单（FR-03；task-04 起随本文件生成——从
 * PROVIDER_CAPS 按 provider_switch === true 派生，不再手抄白名单，取值随
 * daemon 单源）。消费方两处门禁：SessionConfigBar 的 providerLocked（配置条
 * 供应商下拉锁定）与 session-panel 错误卡 timelineOnSwitchProvider——白名单
 * 外引擎（cursor / 未知）仍锁，提示用引擎中性文案「当前引擎不支持会话级
 * 供应商切换」。
 */
export const PROVIDER_SWITCH_ENGINES: ReadonlySet<string> = new Set(Object.entries(PROVIDER_CAPS).filter(([,c]) => c.provider_switch).map(([k]) => k));
