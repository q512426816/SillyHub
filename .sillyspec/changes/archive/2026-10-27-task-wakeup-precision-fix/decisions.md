---
author: flow-machine-draft
created_at: 2026-10-27T01:21:09.929Z
---
# 决策记录（Decisions）— 2026-10-27-task-wakeup-precision-fix

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- 最大风险：**既有测试与生产行为的隐性依赖**——现有唤醒用例（如「61s completed 注入恰一次」）的 task_started 构造不带 tool_use 元数据，新判据下走「信息不足兜底」路径，行为恰好不变；但若未来有用例显式构造 meta 而期望旧行为，会静默走新分支。缓解：新增用例显式覆盖三态（true/false/undefined），并在 WARN 日志中标注判定来源，行为可观测可归因。 - 次要风险：Bash 纳入 meta 登记后 `[TASK_STARTED]` 的 task_name 兜底路径变化（meta.taskName 对 Bash = description，与帧 description 同值）——无行为差异，但 `[TASK_STARTED]` 落行量不变（仅 meta Map 增条目），内存开销可忽略（会话终态清理）。 - 试过放弃的方案：①以「tool_result 同轮配对」为判据（最本质）——需跨事件流追踪 result 与轮次绑定关系，改动面与回归面远超本变更体量，放弃；②以「任务名/命令特征」启发式判断——脆弱且不可解释，放弃；③backend 正则只认新文案——混版本窗口功能退化，改为兼容双文案。
