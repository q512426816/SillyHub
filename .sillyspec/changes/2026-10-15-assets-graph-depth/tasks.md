---
author: flow-machine-draft
created_at: 2026-10-15T09:22:53.271Z
---
# 任务注册表（Tasks）— 2026-10-15-assets-graph-depth

- [x] task-01: 测试先行（change-assets-graph.test.tsx）：既有调用断言补 depth: 1；新增「层级选择器」用例（默认 1 跳激活，点 2跳/3跳 断言 getKnowledgeGraphQuery 依次收到 depth: 2/3）与「keepPreviousData 不闪空」用例（切深度在途时分区仍在、无 loading 替换）；验证：pnpm exec vitest run change-assets-graph.test.tsx，新用例红（chips 不存在）。
- [x] task-02: 实现（change-assets-graph.tsx）：depth state（默认 1）+ 卡头三档 chips（data-testid="assets-graph-depth-N"、aria-pressed）+ queryKey/queryFn 带 depth + placeholderData: keepPreviousData + 标题改「本变更邻域」；验证：change-assets-graph.test.tsx 全文件绿。
- [x] task-03: 相关面回归：change-assets-graph.test.tsx + change-assets-card.test.tsx 两文件复跑 0 fail（既有 fail-open 三用例断言零改动仍绿）；验证：输出汇总全绿。
