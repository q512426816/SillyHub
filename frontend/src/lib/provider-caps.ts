/**
 * provider 能力矩阵（ProviderCaps）前端镜像表。
 *
 * 出处：2026-09-03-agent-provider-abstraction task-02（design §5.2）。
 *
 * 镜像约定（单源 = daemon 侧）：唯一维护源是
 * sillyhub-daemon/src/interactive/providers.ts 的 PROVIDER_CAPS（含取值依据的
 * 文件:行号锚点注释）；本文件与 backend app/modules/agent/provider_caps.py 为
 * 手工镜像，三端键集合（9 键：8 个 boolean + dialog string 枚举）与每个
 * provider 每键取值必须一致（dialog 枚举为 2026-09-09-askuser-pi-cursor
 * task-12 / FR-06 加入，打破「全 boolean」旧约定），由
 * backend/app/modules/agent/tests/test_provider_caps_alignment.py 以源文件读取
 * 方式守护（任一端漂移即测试失败）。改取值先改 daemon 单源，再同步两端镜像。
 *
 * 取值语义：caps 描述 provider 当前真实能力，8 个 boolean 键缺省 false 默认
 * 拒绝（FR-06 / D-002@v1）；dialog 为 string 枚举键（'native' = 走平台
 * dialog 管道 / 'marker' = 纯前端标记协议 / 'none' = 无通道）；未知 provider
 * 查询返回默认拒绝对象（boolean 键全 false、dialog 取 'none'），不抛错。
 */

/** provider 能力矩阵（9 键：8 个 boolean + dialog string 枚举，缺省默认拒绝）。 */
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
}

/**
 * 各 provider 能力取值（daemon 侧手工镜像，取值依据锚点见
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
  },
  // pi（2026-09-04-provider-pi-onboarding task-04 / design §5.3）：取值依据
  // 锚点见 daemon 侧 providers.ts 的 PROVIDER_CAPS docblock pi 段；
  // subagent 终值 false（task-06 实证：聚合型无 per-child 归属，详见
  // onboarding §5.3 PI 案例锚）；permission_dialog / dialog 随
  // 2026-09-09-askuser-pi-cursor Wave A 翻值（值变更只随 daemon 单源三端同步）。
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
  },
  // cursor（2026-09-08-cursor-interactive-session task-05 / design「注册（providers.ts）」节）：
  // 取值依据锚点见 daemon 侧 providers.ts 的 PROVIDER_CAPS docblock cursor 段；
  // thinking=true 为 task-01 实测修正（顶层 thinking 帧稳定存在且有 fixture，
  // 归一化器已映射 delta→thinking）；dialog='marker' 为
  // 2026-09-09-askuser-pi-cursor task-12 初值，spike no-go 则随 task-08 三端
  // 改 'none'（值变更只随 daemon 单源三端同步）。
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
  };
}

/**
 * 会话级供应商切换已解锁的引擎白名单（2026-09-11-session-provider-switch-codex-pi
 * task-05 / design Wave 3 / FR-03）。消费方两处门禁：SessionConfigBar 的
 * providerLocked（配置条供应商下拉锁定）与 session-panel 错误卡
 * timelineOnSwitchProvider——白名单外引擎（cursor / 未知）仍锁，提示用引擎
 * 中性文案「当前引擎不支持会话级供应商切换」。
 *
 * 取值依据（钉死，R-04）：daemon 注入面并集——env REGISTRY（claude/pi，
 * sillyhub-daemon/src/credential-injector.ts）∪ 文件层（codex/pi，
 * sillyhub-daemon/src/provider-file-settings.ts，codex 走 per-session
 * CODEX_HOME / pi 自定义端点走 PI_CODING_AGENT_DIR）。新引擎接入 daemon
 * 注入面（reload 链路含文件层合并）时必须同步本白名单，否则前端会继续锁死。
 *
 * 注意：本常量**不是** ProviderCaps 9 键矩阵成员，不参与三端同步（本变更
 * design 非目标：不改三端同步的 9 键矩阵）——纯前端本地常量，勿并入
 * PROVIDER_CAPS；与矩阵取值语义正交（矩阵描述 provider 能力，本白名单描述
 * 引擎是否解锁会话级供应商切换）。
 */
export const PROVIDER_SWITCH_ENGINES: ReadonlySet<string> = new Set([
  'claude',
  'codex',
  'pi',
]);
