---
author: flow-machine-draft
created_at: 2026-10-11T14:53:15.643Z
---
# 决策记录（Decisions）— 2026-10-11-daemon-masked-test-fix

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：pi 翻 mcp=true 后兜底代报的 codex/cursor 载体若未来也翻 true，本测试面将再失载体——届时应按 caps 现状再选载体或改测 caps 注入而非硬编码 provider 名（当前 getProviderCaps 直接读注册表，测试无注入点，故先硬编码）。放弃的方案：把 daemon.ts 门控改回对 pi 也代报（推翻 task-08 SPIKE-00 实测结论，制造双写缺陷——不做）；给 golden 快照写自动再生成脚本（一次性三键补齐用不上专用管线，且驱动协议依赖 vitest fake timers，脚本化收益低于维护成本——手补 + 头注留痕）。
