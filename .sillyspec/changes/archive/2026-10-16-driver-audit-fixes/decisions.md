---
author: flow-machine-draft
created_at: 2026-10-16T00:16:07.807Z
---
# 决策记录（Decisions）— 2026-10-16-driver-audit-fixes

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 锚点：tests/agent-detector.test.ts
- 答案：最大风险：FR-04 让 codex 族 manualApproval=true 会话从恒自动放行变为真人审——行为面变化，若有依赖旧行为（自动放行）的存量 scan 流程会开始弹审批卡。裁决依据：driver-factory 既有注释（"manualApproval=true 时注入"）、基类契约（"driver 读取并据此决定审批行为"）、claude 路为同义行为（canUseTool 人审），三处均指明人审才是设计意图，恒 allow 是接线缺陷而非决策。已用独立测试文件钉住新契约。 试过但放弃：把 manualApproval 映射放在 approvalReady 块外（chat 也显式 false）——放弃，chat 会话 driverOpts 多两键对行为无增益（驱动 `!undefined` 与 `!false` 同真），且扩大 opts 面变更半径；维持「映射只在审批就绪面生效」最小切口。zcode 主循环曾考虑保留 for-await 仅加槽位——放弃，实测（本变更 TDD）证明 for-await 在 close 后仍挂 `next()`，必须改 while 形态才能收敛。 存量损坏顺带修复（收口实测门拦下，非本变更引入）：① `tests/agent-detector.test.ts` 自 329c0e8aa 起语法损坏（13→14 的标题更新被做成「插入新 it( 行」而非替换，3 处悬挂 it 头致缺 3 个 `}`）——tsconfig exclude tests 使 `tsc --noEmit` 全绿假阴性，该文件自损坏起从未被运行；修复=删除 3 个悬挂旧头 + 期望数组补回被误替换的 'dsh'（PROVIDER_SPECS 实序 dsh 在 zcode 前）。② zcode 注册为 fileSettings writer 后触发 provider-adapter-registry 守护③（smokeSuite 须含 API_FORMAT_VOCAB 全部字面量）——补 buildZcodeProviderConfig 真实 api_format→api.type 映射用例（'openai_chat'→'openai-chat-completions' / 'anthropic'·缺省→'anthropic-messages'）满足判据，非塞注释骗静态扫描。
