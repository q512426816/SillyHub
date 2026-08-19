---
id: task-03
title: Session Log Assembler Unit Tests
title_zh: 装配器单测（分段/嵌套/撤回/配对/去重/一致性）
author: WhaleFall
created_at: 2026-08-19T18:43:32
priority: P0
depends_on: [task-02, task-11]
blocks: [task-12]
requirement_ids: [FR-01, FR-03, FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/daemon/__tests__/session-log-assembler.test.ts
  - frontend/src/components/daemon/session-log-assembler.ts
provides:
  - path: frontend/src/components/daemon/__tests__/session-log-assembler.test.ts
expects_from:
  task-02:
    - contract: AssembledTurn
      needs: [segments, seenLogIds]
  task-11:
    - contract: logsToTurns
      needs: [output, processItems]
goal: 为共享装配器补纯函数单测，锁定分段/归属嵌套/override 撤回/归属桶配对/兜底 stub 合并/双路去重/历史与实时两路径一致性
implementation:
  - 新建测试文件 仅消费 task-01/02/11 已导出装配器 API 断言聚焦段结构形状 分段用例文本被非文本段打断开新段连续文本续接同段（FR-01）
  - 归属嵌套用例 parent_tool_use_id 路由进 tool 段 children depth 大于 1 递归嵌套（FR-03）
  - override 撤回用例 segmentId 前缀 main 与 tool_use_id 三段格式 × 文本/思考两 variant 含跨段撤回（同一 segmentId 分裂多段后 override 到达各段一并撤回 R-06）与 streaming 置位/清除
  - 配对与兜底用例 tool_result 仅同一归属桶内配对最后未配对项不跨桶误配（Grill X-02）子消息先到建 subagent_stub 后续匹配合并迁入 父缺失保留平铺（R-02）
  - 双路与一致性用例 SSE 重复 log_id 经 seenLogIds 丢弃 历史路径 seenText 内容级去重保留两语义不合并（Grill X-08）同一日志序列逐条 applyLogToSegments 与批量 logsToSegments 段结构一致 投影 output 按序拼接且 processItems 的 ts 映射正确
acceptance:
  - pnpm test 过滤 session-log-assembler 全绿 覆盖上述全部用例组 Grill 修正项 X-02/X-06/X-08 均显式覆盖且跨段撤回用例体现段模型与单串截断语义差异
verify:
  - cd frontend && pnpm test -- session-log-assembler
constraints:
  - 装配器为纯函数 单测不 mock 网络/React/定时器 缺陷回写 task-01/02 修复不改断言迁就 assembler.ts 仅限追加测试辅助导出尽量不动实现
related_tests:
  - path: frontend/src/components/daemon/__tests__/session-log-assembler.test.ts
    reason: 本任务交付物 即装配器行为规格
---
