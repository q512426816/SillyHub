---
author: flow-machine-draft
created_at: 2026-10-21T07:12:51.093Z
---
# 决策记录（Decisions）— 2026-10-21-agent-profile-slim-default

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：daemon prune 是删目录操作，误删会话工作区文件——缓解：复用既有 pruneSkillsToSubset（限定 `<workDir>/.claude/skills/` 基目录、跳过隐藏项与非目录、单条失败仅 warn），且仅 spawn 前置链执行一次；实测门覆盖 daemon 测试。次风险：空=清空语义对存量用户反直觉（选了空技能档案的默认档案会让会话没技能）——缓解：设默认交互处提示「该档案未勾选技能，设为默认后你的会话将不挂载技能」（前端文案警示）。 死路：①档案行级 is_default 列（仿供应商）——放弃：档案跨用户共享（workspace/platform 可见），行级标记会让甲的默认影响乙，必须用户级存储；②改通用 pickStrList 空数组语义——放弃：effectiveAllowedRoots 等多调用方依赖「空=不过滤」既有契约，新 strict 变体隔离影响面；③热切换会话技能重挂载——v1 不做：需 daemon 会话存活期重跑 link/prune 链，收益低复杂度高，记边界。
