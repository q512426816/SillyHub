---
author: qinyi
created_at: 2026-09-13 00:53:34
---
# 任务清单（Tasks）

- [ ] task-01: 新增 usage-ctx.ts 共享派生 helper（净值三和 + 毛值直取，全缺不伪造）+ 单测
- [ ] task-02: pi-events buildUsageEvent 派生 ctx_tokens + fixture 断言 (depends_on: task-01)
- [ ] task-03: cursor-events mapUsage 派生 ctx_tokens + 修正旧注释 + fixture 断言 (depends_on: task-01)
- [ ] task-04: codex driver 解析 last + 两路 usage 附加 ctx_tokens + 测试 (depends_on: task-01)
- [ ] task-05: claude-events 改调共享 helper（行为零变化）+ 既有测试回归 (depends_on: task-01)
- [ ] task-06: ProviderCaps 第 11 键 ctx_usage + gen 脚本同步 + 三端生成 + 双守护测试同步
- [ ] task-07: 前端 CtxUsageBar caps 门控 + 两调用点传 provider + vitest (depends_on: task-06)
- [ ] task-08: onboarding 文档补派生口径说明 + 真机验证三引擎（含 spike-01 codex last） (depends_on: task-02,03,04,06)
