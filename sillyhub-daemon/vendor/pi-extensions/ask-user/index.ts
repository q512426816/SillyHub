/**
 * Ask User Tool — 模型可调的用户提问工具（SillyHub vendored，非 pi 官方 examples 快照）。
 *
 * 背景：SillyHub 平台的 AskUser 弹窗链路（2026-09-09-askuser-pi-cursor Wave A）只
 * 桥接了 pi `extension_ui_request` 的 dialog 类方法（select/confirm/input/editor →
 * daemon → 平台弹窗卡），但 pi 本体不提供任何「模型可调」的提问工具——extension
 * UI 方法只能由 extension 代码发起，导致 pi 会话里模型只能文字罗列问题、平台无弹窗
 * （会话 d4c29d95 实测暴露）。本扩展补上发起端：注册 `ask_user` 工具，内部经
 * `ctx.ui.select / ctx.ui.input` 发 dialog → RPC 模式下 pi 自动上抛
 * `extension_ui_request` → daemon 现有桥接 → 平台弹窗，用户作答后同轮回流。
 *
 * 语义要点（与 daemon 桥接端约定对齐，改任一侧须同步）：
 *   - 有 options → `ctx.ui.select(question, options)`（单选，options 为 string[]；
 *     pi 0.81.1 select 无 description/allowCustom 字段，选项说明由模型写进字符串）；
 *   - 无 options → `ctx.ui.input(question)`（daemon 端自动 allowCustom:true + 占位
 *     选项「由我输入」，卡片常驻自定义输入框）；
 *   - **不传 timeout**（ExtensionUIDialogOptions.timeout 会让 pi 侧自动超时回默认
 *     值；不传 = 阻塞至 daemon 应答，对齐平台「dialog 永久等待」语义 FR-02）；
 *   - 取消/无 UI 通道 → 明确文本告知模型降级（print 模式 hasUI=false、daemon 桥接
 *     fail-closed 回 cancelled 时 select/input 均返回 undefined）。
 *
 * 装载：daemon pi-rpc-driver spawn 时 `--extension <本文件>`（见
 * piVendoredAskUserExtensionPath）；TUI 直跑场景同样可用（pi 内置 dialog 渲染）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const AskUserParams = Type.Object({
	question: Type.String({
		description: "要问用户的问题（一句话说清决策点，不要在正文里罗列多个问题）",
	}),
	options: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"可选的候选项列表（2-5 个，每项一段完整选项文本，可含「选项：说明」）。提供时用户点选；省略时用户自由输入",
		}),
	),
});

export default function askUser(pi: ExtensionAPI) {
	pi.registerTool({
		// 工具名对齐 claude 内置 AskUserQuestion：daemon/backend 双端 tool-kind
		// 分类器已认 askuserquestion→ask（零改动），backend scan 步骤提示词
		// 「必须调用 AskUserQuestion 工具」对 pi 会话同样成立，跨引擎体验统一。
		name: "AskUserQuestion",
		label: "AskUser",
		description:
			"向用户提问并等待回答（弹出选择卡片，阻塞至用户作答）。需要用户决策、确认方向或澄清歧义时必须调用本工具，禁止在回复文本里罗列问题让用户打字回答。一次只问一个问题；候选项 2-5 个时给 options，开放性问题时省略 options。",
		parameters: AskUserParams,
		// 阻塞等用户作答，禁止与其他工具并行（对齐官方 question.ts 先例）。
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [
						{
							type: "text",
							text: "Error: 当前运行模式无用户对话通道（hasUI=false）。请改为在回复文本中直接向用户提问，等用户下一条消息。",
						},
					],
				};
			}
			const question = params.question.trim();
			if (question === "") {
				return {
					content: [{ type: "text", text: "Error: question 为空，未发起提问。" }],
				};
			}
			const options = (params.options ?? [])
				.map((o) => o.trim())
				.filter((o) => o !== "");
			// 不传 ExtensionUIDialogOptions：无 timeout = 永久等待 daemon 应答。
			const answer =
				options.length > 0
					? await ctx.ui.select(question, options)
					: await ctx.ui.input(question);
			if (answer === undefined || answer.trim() === "") {
				return {
					content: [
						{
							type: "text",
							text: "用户取消了本次提问（未作答）。请基于现有信息谨慎推进，或在回复文本中说明你的默认选择后继续。",
						},
					],
				};
			}
			return {
				content: [{ type: "text", text: `用户回答：${answer}` }],
			};
		},
	});
}
