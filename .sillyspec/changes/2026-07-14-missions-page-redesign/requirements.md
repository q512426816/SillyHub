---
author: qinyi
created_at: 2026-07-14 10:20:00
---
# 需求规格（Requirements）— 2026-07-14-missions-page-redesign

## 功能需求（FR）
- **FR-1**（创建态）页面只留一个标题；输入框顶置，placeholder 为人话（无代码路径）。
- **FR-2**（创建态）无 single/team 切换；固定 team（D-001）。
- **FR-3**（创建态）「高级：手动配分身」默认折叠；默认不填 worker（主 agent 自动拆，D-002）；展开可手动预设分身列表 + 主 agent 配置。
- **FR-4**（创建态）历史 Mission 默认收进顶部「历史(N)」下拉按钮（D-007）。
- **FR-5**（创建态）费用上限 +「启动」按钮（不再"启动团队"）。
- **FR-6**（详情态）顶部 MissionSummaryCard：中文状态徽标 + 成败统计（**只算真 worker role!==orchestrator，主控单独**，G1）+ 累计成本 + AI 最终结论（`kind==="summary"` artifact，D-003）。
- **FR-7**（详情态）分身角色只显中文，无 `[arch]`/`[orchestrator]` 方括号代号。
- **FR-8**（详情态）分身分工目标默认折叠，点开看完整（D-006）。
- **FR-9**（全局）状态词全中文：规划中/运行中/已完成/部分完成/失败/已取消（D-005）。
- **FR-10**（全局）UI 不出现 Coordinator/Worker/daemon/role/orchestrator/Mission 黑话（用户可见处）；workspace/mission/run 三层标识不露。
- **FR-11**（历史）条目长描述 truncate + hover 全文，不撑爆布局。
- **FR-12**（降级）summary 仅 mission∈{done,degraded} 产出；running/planning 显「进行中，暂无结论」；failed/cancelled 无 summary 显「无最终结论」。

## 非功能需求（NFR）
- **NFR-1** 零后端改动。
- **NFR-2** 前端全量测试零回归（mission-console.test.tsx 更新 + 其余通过）。
- **NFR-3** 兼容老 mission 数据（worker_preset nullable / summary 可能缺失均防御）。
- **NFR-4** 文案中文（项目硬性规则，CLAUDE.md 规则 12）。
- **NFR-5** 兼容 Windows/Linux/macOS（CLAUDE.md 规则 13）。

## 数据契约
- 前端类型不变（`lib/agent.ts`：Mission / MissionWorkerRun / MissionArtifact / CreateMissionInput / WorkerPresetItem / MainAgentConfig）。
- `createMission` 固定 `mode: "team"` + `main_agent_config`（默认值，始终传）+ `worker_preset`（默认空数组）。
- AI 结论：`mission.workers.flatMap(w => w.artifacts).find(a => a.kind === "summary")?.content_ref`。

## 验收标准
见 design.md §10 AC-1 ~ AC-10。
