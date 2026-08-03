---
id: task-09
title: 实跑验证——真实 daemon 会话复现实时「半截+全文」重复场景，确认修复后实时流式只剩 complete 全文（assistant + thinking 两种 override 都验证），重新打开会话历史回显仍正常；backend 日志确认 override publish 到 SSE + _revoke_committed_partials DELETE 基线仍触发（task-14 不回归）
title_zh: 实跑验证实时回复不重复
author: WhaleFall
created_at: 2026-08-03 10:23:11
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08]
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths: []   # 实跑验证不改源码
goal: >
  真实会话端到端验证实时回复不再「半截+全文」重复、回显正常、task-14 不回归。
implementation:
  - 部署 backend（docker --build --force-recreate）+ 重启 daemon 连本机 :8000
  - 真实会话复现场景（agent 写 F:\test.txt 被运行时策略拦截、分段输出，触发 partial flush + override）
  - 实时观察会话气泡：确认不再出现半截+全文叠加（assistant + thinking）
  - 重新打开该会话（历史回显）：确认仍只显示完整全文
  - 查 backend 日志：确认 daemon_messages_override_deleted_committed_partial 仍触发（task-14 DELETE 基线不回归）+ override publish 到 SSE
acceptance:
  - 实时回复无「半截+全文」重复（assistant + thinking 两种 override 均验证）
  - 重新打开会话历史回显正常（只显示 complete 全文）
  - backend 日志 override DELETE 基线仍触发（task-14 落库去重不回归）
  - 残留 partial 行（segment_id IS NOT NULL）= 0
verify:
  - 手动实跑 + 观察（backend docker logs + 前端会话面板）
  - psql 复核 agent_run_logs 残留 partial = 0
constraints:
  - 实跑需真实 daemon↔backend 集成（非 mock），与 task-14 verify-result 同口径
  - 若实跑发现毫秒级中间态明显（R-03），记录现象留优化，不阻断（本轮接受）
---

# task-09 · 实跑验证实时回复不重复

> 变更 `2026-08-03-session-stream-partial-revoke` · Phase 3 实跑（design.md §5.3、§9 兼容、§10 R-03、plan.md AC-06/AC-07）
> 覆盖 FR-07, R-03；depends_on 全部实现任务（task-01…task-08）完成后执行

## 验证目标（goal）

真实会话端到端验证：
1. 实时流式回复不再出现「半截 + 全文」叠加重复（方案 A：override 信号 publish 到 SSE，前端按 segmentId 撤回已渲染半截）。
2. 重新打开同一会话（历史 GET 回显）仍只显示完整全文（task-14 落库去重不回归）。
3. backend 日志确认 override 仍 publish 到 SSE 且 `_revoke_committed_partials` DELETE 基线正常触发（task-14 不回归）。

## 前置条件

- task-01…task-08 全部实现 + 单测通过（AC-01…AC-05）。
- backend 已按 design.md §5 Phase 1 透传 `segment_id` + override 改 publish-only；前端已按 Phase 2 加 override 识别 + onLog 撤回。
- 真实 daemon ↔ backend 集成环境（非 mock），与 task-14 verify-result 同口径。

## 实施步骤（implementation）

### 1. 部署环境
- backend：`docker compose build --force-recreate backend`（或 deploy-to-server 流程），确认镜像含 task-01/02 改动。
- daemon：重启本地 daemon，配置 backend 指向 `http://127.0.0.1:8000`，确认 lease/heartbeat 正常。

### 2. 复现重复场景（修复前基线对照）
- 在 daemon 会话面板发一条会触发「分段输出 + override」的指令：
  - 让 agent 试图 `Write` 到 `F:\test.txt`（被运行时策略拦截）→ 触发 partial flush → complete → override 信号。
  - 触发主 agent + 子代理（segmentId 前缀 `main:` vs `<tool_use_id>:`）多 segment 并发。
- 实时观察会话气泡，记录修复前「半截 + 全文」重复现象作为对照（如仍能复现，说明部署未生效，回查实现）。

### 3. 修复后验证实时流（assistant + thinking 两种 override）
- 同一会话重复触发上述场景，实时观察：
  - **assistant override**：partial `[ASSISTANT]` 半截 → override 到达 → 半截被撤回 → 只剩 complete 全文。
  - **thinking override**：partial `[THINKING]` 半截 → override 到达 → thinking 半截被移除。
  - 确认不再出现「半截 + 全文」叠加；override 前缀文本 `[ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE]` 不作为正文泄漏显示（R-04 兜底）。
  - 多 segment 场景确认 segmentId 隔离不串扰（主 agent 不撤回子代理半截）。

### 4. 重新打开会话（历史回显）
- 完成上述会话后，关闭/刷新页面，重新打开该会话：
  - 确认历史只显示 complete 全文（task-14 落库去重 + override 不落库共同保证）。
  - `logsToTurns` 渲染正常，无 override 文本残留。

### 5. backend 日志 + DB 复核（task-14 不回归）
- `docker compose logs backend` 抓取该会话日志：
  - 确认 `daemon_messages_override_deleted_committed_partial`（task-14 DELETE 基线）仍触发，次数 ≥ 与修复前基线一致（task-14 原 7 次 DELETE 不变）。
  - 确认 override envelope publish 到 session SSE（含 `segment_id` + `stale=true`）。
- psql 复核：
  ```sql
  SELECT count(*) FROM agent_run_logs
   WHERE session_id = '<该会话>'
     AND segment_id IS NOT NULL;   -- 预期 = 0（partial 全被 override DELETE 撤回）
  SELECT count(*) FROM agent_run_logs
   WHERE session_id = '<该会话>'
     AND content LIKE '[%_OVERRIDE]%';  -- 预期 = 0（override 不落库，R-01）
  ```

## 验收标准（acceptance）

| AC | 内容 | 证据来源 |
|---|---|---|
| AC-06-a | 实时回复无「半截+全文」重复（assistant override 验证） | 前端会话面板肉眼观察 + 截图 |
| AC-06-b | 实时回复无「半截+全文」重复（thinking override 验证） | 同上 |
| AC-06-c | 重新打开会话历史回显正常（只显示 complete 全文） | 刷新会话面板观察 |
| AC-07 | 双向兼容：旧前端忽略新字段不劣化 / 新前端缺字段空转（按需补验） | design.md §9 |
| task-14 回归 | backend 日志 `daemon_messages_override_deleted_committed_partial` DELETE 基线仍触发 | docker logs |
| 残留 partial | `agent_run_logs` 中该会话 `segment_id IS NOT NULL` 行 = 0 | psql |
| override 不落库 | `agent_run_logs` 中该会话 `content LIKE '[%_OVERRIDE]%'` 行 = 0 | psql（R-01） |

## 验证方式（verify）

- **主**：手动实跑 + 观察（backend `docker compose logs` + 前端会话面板实时 / 历史两路）。
- **辅**：psql 复核 `agent_run_logs` 残留 partial = 0、override 行 = 0。
- 非 mock：必须真实 daemon ↔ backend 集成链路（与 task-14 verify-result 同口径）。

## 约束（constraints）

- 实跑需真实 daemon ↔ backend 集成（非 mock），与 task-14 verify-result 同口径。
- 若实跑发现 complete → override 之间毫秒级「半截+全文」中间态明显（R-03，design.md §5.1 / §10）：记录现象、留作后续优化（complete 携带 segmentId 即时替换，需改 task-14 落库语义，另开 change），**本轮接受、不阻断**。
- 实跑验证不改源码（`allowed_paths: []`）；若实跑暴露实现缺陷，回退对应实现任务（task-01…task-08）修复，不在本任务内改。
- 回退路径（design.md §9）：若 override publish 引入问题，回退 task-02（override 分支改回 `continue`）即恢复 task-14 行为（实时重复回来但回显正常），前端撤回逻辑空转无副作用。

## 关联

- design.md：§1 背景（实时 vs 回显通道差异）、§5.3 Phase 3 实跑、§9 兼容、§10 R-03/R-05。
- plan.md：task-09 描述、AC-06/AC-07。
- 覆盖矩阵：FR-07、R-03；决策 D-001@v1（允许动后端）、D-002@v1（方案 A）。
- task-14 verify-result：DELETE 基线（7 次）对照口径来源。
