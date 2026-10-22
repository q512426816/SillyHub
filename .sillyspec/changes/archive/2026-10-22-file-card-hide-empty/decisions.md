---
author: qinyi
created_at: 2026-10-22 08:36:00
change: 2026-10-22-file-card-hide-empty
---

# 决策记录（Decisions）— 2026-10-22-file-card-hide-empty

## D-001@v1: 无数据的轮级文件变更卡一律不出（含采集失败），会话汇总也不留缺口提示
- type: ux
- priority: P1
- status: accepted
- source: user
- question: 58 轮历史会话每轮挂一张「仅工具编辑」降级卡（「daemon 未上报工作区快照，本卡只含 Edit/Write 工具编辑」），零信息且误导——是 daemon 故障，还是该改前端呈现？
- answer: 实测确认 **daemon 无故障**（0.2.0 采集器 `status=ok` / 46 files / 165ms；文件清单来自 `git status`，子代理与 `Write` 改动均计入；归因工具名 `Edit/Write/MultiEdit/NotebookEdit/apply_patch` 大小写不敏感）。这些轮跑在 daemon 0.2.0 / 平台 10-22 00:43 部署之前，backend 无 `daemon_run_snapshots` 行 → `capability="tool_only"`。用户裁决原话意译：**没有信息就隐藏卡片，顶部汇总也不要留缺口提示**。故：`tool_only` / 无快照 / `failed|unavailable` 四条分支一律不出卡；汇总跳过这些轮、删缺口提示行、零文件整卡零渲染；`partial` 但无文件清单仍保留一行「快照未完成」提示（它携带「本轮采集没完成」的真实信息）。
- normalized_requirement: `toFileChangesCardProps` 四条「无数据」分支返回 `null`；`aggregateTurnFileChanges` 跳过 `snapshot==null` / `capability==="tool_only"` / `status∈{failed,unavailable}`；`FileChangesSummary` 在 `totalFiles===0` 时零渲染；`file-changes-card` 的 `degraded` 形态保留但产品页无生产者。
- impacts: requirements FR-01 / FR-03 / FR-04；design「做法概述」「接口契约」「风险与死路」；frontend `file-changes/turn-file-changes.ts`、`file-changes/file-changes-summary.tsx`、`file-changes/file-changes-card.tsx`（注释）、`turn-timeline.tsx`（注释）
- evidence: frontend/src/components/daemon/file-changes/turn-file-changes.ts:112-121；frontend/src/components/daemon/file-changes/file-changes-summary.tsx:104-118；独立评审 review.json（两轮 PASS，reviewedAgainst=a9232edf1）
- 故障面: 排障信号从 UI 消失——「这轮没改文件」与「这轮没采到快照」在页面上不可区分。属用户显式接受的取舍；status/reason 仍留在 `GET /sessions/{id}/runs` 的 `file_changes` 与 daemon 结构化日志 `turn_file_changes_collected`，需要时可从接口/日志复查。回退＝三条分支改回 `degradedProps(...)`（一行改动 + 测试同步改回）。
- 退坡判据: 若用户后续要求「能看出哪些轮没采到快照」（例如做「快照覆盖率」检查器页面），则改为在检查器/详情面板呈现，而非回到逐轮占位卡。

## D-002@v1: 复审两条 P3 的处置（不阻断收口，登记为遗留）
- type: review
- priority: P3
- status: accepted
- source: review
- question: 复审（verdict=PASS）报了两条 P3：①汇总卡的 `failed/unavailable` 展示分支（statusLabel「快照不可用/采集失败」、Σ「—」、`fileChangesSummaryNote` 两条注记）在聚合收窄后不可达且无用例覆盖；②requirements FR-03 括注参与集合未同步排除 `failed/unavailable`。
- answer: ②当场修（requirements 正文本轮已改，属追溯文字一致性，零代码影响）；①**保留不改**——这些分支是组件的防御性兜底（`FileChangesSummary` 是纯 props 组件，检查器 / proto 仍可能直接喂 `failed` 快照），删掉会把「未知状态渲染成完整」的风险重新引入；无输入即不可达也无害，等真有第二消费方时再按需收窄。
- normalized_requirement: 不改代码；把不可达分支的存在理由写进本条决策，避免下次评审重复报同一项。
- impacts: 无（纯登记）
- evidence: .sillyspec/changes/2026-10-22-file-card-hide-empty/review.json（复审 findings#1/#2）
- 故障面: 若未来有人把 `failed` 快照直接喂给 `FileChangesSummary`（绕过聚合），会看到「采集失败 + Σ—」的旧形态——那是兜底行为，不是回归。
- 退坡判据: 出现第二个消费方且明确要求「无缺口提示」时，再收窄状态词表。
