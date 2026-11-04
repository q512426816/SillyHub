---
author: flow-machine-draft
created_at: 2026-11-04T05:57:52.066Z
---
# 任务注册表（Tasks）— 2026-11-04-session-quota-pill-follow-provider

- [x] task-01: `session-panel-page.tsx` 会话态 CtxUsageBar 的 providerId 改为「stagedConfig.llm_provider_id 有定义优先（空串→null），否则 session.llm_provider_id」；验证：代码审阅 + 现有页面对应测试通过
- [x] task-02: `ctx-usage-bar.tsx` 新增导出纯函数 `resolveQuotaFace`（选中供应商 → entry/unsupported/no-data/aggregate 四态），QuotaPill 胶囊面按四态渲染；验证：单测
- [x] task-03: QuotaPill 浮层：选中供应商置顶（有数据列明细，无数据/不可查列状态说明），其余可查供应商按名称序跟随且不重复；验证：单测
- [x] task-04: providerId 为空（本机默认）保持聚合行为，空数据仍显示「暂无供应商额度信息」；验证：单测回归
- [x] task-05: 更新 `ctx-usage-bar.test.tsx` 失效用例（不可查不再整体不渲染、quota=null 不再灰字）并新增 FR-01~FR-05 用例；验证：`pnpm -C frontend test -- ctx-usage-bar` 全绿
- [x] task-06: 跑相关测试与 `pnpm -C frontend lint`，回填 requirements.md 测试绑定与用例名；验证：命令输出
