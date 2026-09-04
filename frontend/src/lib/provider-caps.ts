/**
 * provider 能力矩阵（ProviderCaps）前端镜像表。
 *
 * 出处：2026-09-03-agent-provider-abstraction task-02（design §5.2）。
 *
 * 镜像约定（单源 = daemon 侧）：唯一维护源是
 * sillyhub-daemon/src/interactive/providers.ts 的 PROVIDER_CAPS（含取值依据的
 * 文件:行号锚点注释）；本文件与 backend app/modules/agent/provider_caps.py 为
 * 手工镜像，三端键集合（8 键）与每个 provider 每键取值必须一致，由
 * backend/app/modules/agent/tests/test_provider_caps_alignment.py 以源文件读取
 * 方式守护（任一端漂移即测试失败）。改取值先改 daemon 单源，再同步两端镜像。
 *
 * 取值语义：caps 描述 provider 当前真实能力，缺省 false 默认拒绝
 * （FR-06 / D-002@v1）；未知 provider 查询返回全 false 对象，不抛错。
 */

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
  // pi（2026-09-04-provider-pi-onboarding task-04 / design §5.3）：取值依据
  // 锚点见 daemon 侧 providers.ts 的 PROVIDER_CAPS docblock pi 段；
  // subagent 初始 false（§6.2 纪律，实证后只由 task-06 在三端同步翻值）。
  pi: {
    resume: true,
    mcp: false,
    multimodal: true,
    thinking: true,
    subagent: false,
    permission_dialog: false,
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
