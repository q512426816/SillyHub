---
author: qinyi
created_at: 2026-06-14T22:04:34
id: task-15
title: 端到端多 provider 全链路验收
priority: P1
estimated_hours: 2
depends_on: [task-13, task-14]
blocks: []
allowed_paths: []
---

# task-15: 端到端多 provider 全链路验收

## 上下文
对照 design.md §3（成功标准）+ proposal.md 成功标准 1~6，做真实多 provider 端到端验收。需要至少 2 个在线 provider runtime（如 claude + codex）。依赖 task-13（后端测试）+ task-14（前端测试）全过。

## 修改文件（必填）
- 无（验收任务，不改代码）。若验收失败回对应 task 修复。

## 实现要求（验收剧本，对照成功标准 1~6）
1. **成功标准 1（显式覆盖）**：workspace.default_agent=claude；task 面板选 codex 提交 → agent run 实际用 codex runtime（看 daemon 日志 / agent_run 记录）。
2. **成功标准 2（默认生效）**：workspace.default_agent=claude；task 面板不选（默认/使用默认）提交 → 实际用 claude。
3. **成功标准 3（未配置兜底）**：workspace.default_agent=null；提交 → 实际用 ORDER BY last_heartbeat 的 runtime（任意在线）。
4. **成功标准 4（严格匹配+回退）**：workspace.default_agent=claude；停掉 claude runtime（仅 codex 在线）；提交 → 回退 codex + placement 日志 `placement_provider_fallback wanted=claude actual=codex`。
5. **成功标准 5（前端可选）**：设置页/task/stage/scan 四处下拉都能选 provider 并生效（task-14 已部分覆盖，这里端到端确认实际 runtime）。
6. **成功标准 6（多 provider 持久化）**：设 default_agent=claude → 重启后端/daemon → GET workspace 仍返回 default_agent=claude。

## 接口定义（代码类任务必填）
N/A（端到端验收任务）。

## 边界处理（必填）
- **环境前置**：至少 2 个 provider runtime 可在线（claude + codex 或 mock）。
- **daemon 真实起**：本任务起真实 daemon（非 mock），验证 placement 实际调度。
- **失败定位**：agent_run 记录看实际 runtime_id / provider；daemon 日志看 dispatch 收到的 provider。
- **数据可清空**：本项目未上线，验收后可清测试数据（CLAUDE.md 规则 7）。
- **重启持久化**：成功标准 6 需重启后端进程验证 DB 持久化。

## 非目标（本任务不做的事）
- 不改代码（回对应 task 修）。
- 不做性能/压测。
- 不写自动化 e2e（MVP 手动剧本）。

## 参考
- 成功标准 1~6（proposal.md）。
- design.md §3。
- FR-01~FR-08（requirements.md）。
- task-13/14 验收结果。

## TDD 步骤
1. 准备环境：2+ provider runtime 在线。
2. 按成功标准 1~6 逐剧本执行。
3. 每剧本确认实际 runtime = 预期 provider。
4. 失败回对应 task 修复后重跑。

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 显式覆盖链路 | 成功标准 1 达成（实际用 codex） |
| AC-02 | 默认生效链路 | 成功标准 2 达成（实际用 claude） |
| AC-03 | 未配置兜底链路 | 成功标准 3 达成（任意在线） |
| AC-04 | 严格匹配+回退链路 | 成功标准 4 达成（回退 + 日志） |
| AC-05 | 前端四入口可选 | 成功标准 5 达成 |
| AC-06 | 多 provider 持久化 | 成功标准 6 达成（重启后仍在） |
