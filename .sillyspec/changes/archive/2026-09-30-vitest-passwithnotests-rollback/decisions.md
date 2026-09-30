---
author: flow-machine-draft
created_at: 2026-09-30T08:58:33.333Z
---
# 决策记录（Decisions）— 2026-09-30-vitest-passwithnotests-rollback

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：若 sillyspec 修复未生效（CLI 未链接源码）而撤掉兜底会复现假红——已核实 npm ls -g sillyspec 指向 C:/Users/qinyi/IdeaProjects/sillyspec（npm link），且撤除前用原始失败面在修复后源码上复跑门禁函数确认全绿，风险已消除。试过放弃的方案：保留 passWithNoTests 作为双保险——放弃理由：它会掩盖未来真正错误的空收集（如过滤条件写错时 CI 静默通过），兜底价值低于语义保真。
