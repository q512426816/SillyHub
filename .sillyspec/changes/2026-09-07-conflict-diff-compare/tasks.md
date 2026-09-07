---
author: qinyi
created_at: 2026-09-07 13:50:00
---

# 任务清单（Tasks）— 2026-09-07-conflict-diff-compare

> 注册表唯一真相；Wave 分组见 plan.md。执行顺序遵守 CLAUDE.md 规则 5：文档 → 读代码 → 写测试 → 写实现 → 跑测试 → 验收 → 更新文档。仅跑本变更相关测试，全量留 CI（规则 0）。

- [ ] task-01: daemon 快照 RPC 测试先行（conflictSnapshot/ql_id/截断护栏/防逃逸）
- [ ] task-02: daemon 实现 conflictSnapshot + RPC 注册 + ql_id 心跳补报 (depends_on: task-01)
- [ ] task-03: backend compare 测试先行（权限/白名单/504/diff/截断/containment）
- [ ] task-04: backend 实现 sillyspec_compare.py + compare 端点 + DTO ql_id (depends_on: task-03)
- [ ] task-05: gen:types 重新生成 api-types.ts + openapi.json (depends_on: task-04)
- [ ] task-06: frontend 弹窗与行改造测试先行（含总览卡 ql 标题单测） (depends_on: task-05)
- [ ] task-07: frontend conflict-compare-modal.tsx + lib/daemon.ts 实现 (depends_on: task-05, task-06)
- [ ] task-08: platform-sync-section 行改造 + changes-overview-card ql 标题 (depends_on: task-05, task-06)
- [ ] task-09: 三端本变更测试与类型检查全跑 (depends_on: task-02, task-04, task-07, task-08)
- [ ] task-10: 实机集成验收（3 条存量冲突链路证据，integration-critical） (depends_on: task-09)
- [ ] task-11: 模块文档更新（sillyhub-daemon.md + backend.md） (depends_on: task-09)
