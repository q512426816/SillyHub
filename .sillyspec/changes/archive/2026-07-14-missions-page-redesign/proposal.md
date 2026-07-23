---
author: qinyi
created_at: 2026-07-14 10:20:00
---
# 提案书（Proposal）— 2026-07-14-missions-page-redesign

## 动机
Agent 团队页（`/workspaces/<id>/missions`）让用户派多 AI 团队并行干活，但当前交互反人类：非开发者用户完全不知怎么操作。需重做让普通用户能「描述任务 → 看进度 → 看结果」，全程不见内部概念。

## 关键问题（现有方案为何不够）
1. **进来不知怎么操作**：历史默认铺开抢焦点，创建表单被挤到下方要滚动；双标题冗余；placeholder 用代码路径示例（`backend/app/modules/agent/...`）。
2. **满屏黑话 + 英文状态**：Coordinator/Worker/Finalizer/daemon/role/orchestrator 直接露出；degraded/failed/planning 全英文，普通用户看不懂。
3. **详情一团乱**：历史条目一行塞整段描述 + Windows 绝对路径撑爆；worker 几百字指令原文不折叠；角色中英重复露代号（`架构分析 [arch]`）；多个分身成败散落无「任务最终成没成 / 结论」总览。
4. **single/team 选择对用户无意义**：single 其实也派多分身（GLM 自动拆），概念混淆；用户要的是结果，不是选模式。

## 变更范围
方案 A 单栏流式 + 固定 team 模式（详见 design.md）：
- **创建态**：输入框顶置、历史收顶部按钮、删 mode 选择、「高级：手动配分身」默认折叠、启动按钮。
- **详情态**：MissionSummaryCard 总览卡（中文状态 + 成败统计 + 成本 + AI 最终结论）、分身中文角色、分工目标折叠。
- **全量中文化 + 藏黑话**（Coordinator→主控 / Worker→分身 / daemon→后台 / Mission→任务）。
- **后端无改动**（summary 已落库、mode 字段已支持 team）。

## 成功标准（可验证）
对应 design.md §10 AC-1 ~ AC-10（创建态无 mode/输入顶置、高级默认折叠、详情总览卡含 AI 结论、分身中文无代号、分工目标折叠、状态全中文、历史收起 truncate、黑话不出现、测试更新通过）。

## 不在范围内（Non-Goals）
- 不改后端（mode 字段 / 编排链路 / Finalizer）。
- 不改 execute/verify/会话入口的 single/team（D-008，留独立变更）。
- 不碰 `/agent` 智能体控制台（单 agent 对话，与 mission 并存）。
- 不做模型可配置 / 预算硬门 kill。
