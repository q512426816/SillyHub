---
author: qinyi
created_at: 2026-08-25 20:05:00
---

# 提案书（Proposal）— 团队分身子会话化 P1 治理地基

## 动机

团队分身运行形态已是 SDK 交互会话，但治理仍按"一次性 batch run"旧语义：mission
挂载链对分身断裂、完成判据错位（等追问间隙被误判全完成、提前删 worktree）、
converge 后子会话成孤儿烧 token、归属错位（apiKey 属主而非任务发起人）、分身
成本漏算。用户要求分身具备与主控一致的完整会话体验，且已拍板会话树架构。

## 关键问题

1. 分身与 mission 的挂载关系在数据模型上不存在（session→mission 只认根会话）。
2. 「分身干完了」没有显式信号，五处判据共用错误的 run 终态代理。
3. converge/cancel 关不掉子会话（interactive lease 永不过期）。
4. 分身会话 owner 落在 daemon 属主，追问/权限卡片/审计全错位；跨 ws 代表机器
   派发与 owner=mission 创建者冲突（placement 属主校验）。
5. 分身拿不到任何 MCP 工具（daemon 谓词排除 mission_worker），显式完成信号
   无注入通道。

## 变更范围

- backend：agent_sessions 加 parent_session_id/worker_done_at（alembic）；
  dispatch_worker 改子会话三元组派发（owner=mission.created_by + placement 代表
  钉定 + stage 透传）；worker_done 新端点；is_worker_complete/mission_derive_status
  单一真相源替换五处判据 + 五个 derive 消费点；converge/cancel 沿树批量 end_session；
  patrol 孤儿扫描；成本口径 union；TeamMissionWorkerSummary 加 sub_session_id。
- sillyhub-daemon：mission_worker stage 注入仅含 worker_done 的受限 MCP server。
- frontend：分身行点击按 sub_session_id 复用 session-panel 打开；gen:types。

## 非目标（Non-Goals）

- 不做递归派发（分身受限 server 单工具，无 dispatch_worker/converge；递归开闸
  = P2：深度上限、层 0 converge、预算树聚合、派发工具下放）。
- 不做门户分组 / 按需开流等完整 UI（P3）。
- 不做 daemon 级会话总数上限（P2）。
- 不迁移存量 batch 分身形态（双判据兼容，本项目未上线）。
- 不改 worktree 隔离引擎（只改清理触发时机）。

## 风险

| 风险 | 应对 |
|---|---|
| 双判据口径分裂 | is_worker_complete + mission_derive_status 单一真相源，禁各自实现 |
| 会话树环 | resolve 带 visited 环检测 |
| 批量收口部分失败 | best-effort + patrol 兜底 |
| 受限 server 被绕过扩工具 | 工具集硬编码；P2 下放走独立决策 |
| gen:types 暴露旧测试债 | 规则 21 惯例顺手补 |

## 实现路径

scale=large → `sillyspec run plan --change 2026-08-25-team-subsession-governance`
