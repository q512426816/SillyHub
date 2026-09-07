---
author: qinyi
created_at: 2026-09-07 10:35:00
---

# 任务清单（Tasks）

- [x] task-01: daemon liveness 基座——types.ts + registry.ts（format→deriver 注册表）(depends_on: —)
- [ ] task-02: zcode deriver（E-03 实证规则）+ fixture 单测 (depends_on: task-01)
- [ ] task-03: tailer 循环——offset 差量读/reset/ended 回收/watch≤16/4MB 预算/R-02 fail-open (depends_on: task-01)
- [ ] task-04: 自发现最小版——spawn 记录 + sessions.json 恢复 + 窗口重扫兜底 + claude/pi 直算路径 (depends_on: task-01)
- [ ] task-05: 自发现窄扫——codex（uuid）/zcode（共享 rollout 目录）标记匹配 + cwd 防串台 (depends_on: task-04)
- [ ] task-06: hub-client 三职——POST /states 批量上报 + GET /agent-logs 周期拉登记行 + 第一方 blocked 并入（D-012 优先级）+ daemon.ts 生命周期挂接（独立 try） (depends_on: task-02,03,04)
- [x] task-07: backend 四列迁移（alembic）+ AgentSessionLogORM/schema 增字段 (depends_on: —)
- [ ] task-08: POST /agent-logs/states 端点——批量 upsert-create（origin=liveness-discovered）+ 转移检测 (depends_on: task-07)
- [ ] task-09: Notification type=agent_blocked——120s 阈值/段级 dedupe/与 5min auto-deny 同源分级/Redis 推 (depends_on: task-08)
- [ ] task-10: codex deriver（E-02 词汇表规则）+ fixture 单测 (depends_on: task-01)
- [ ] task-11: E-01 实证（spike-02）→ claude deriver（证伪则只留 working/idle 并回写结论） (depends_on: task-01, spike-02)
- [ ] task-12: list_workers 增 liveness 字段（spike-01 定汇入点；过重则 backend 直查落库状态） (depends_on: task-08, spike-01)
- [ ] task-13: sillyspec 仓派发模板改写——blocked→升级不 kill / working→再等（repo:sillyspec） (depends_on: task-12)
- [ ] task-14: 前端（D-004 两层）——会话列表小灯+悬浮卡/工作台总览卡片/面板徽章/idle 小红点/通知渲染 + pnpm gen:types (depends_on: task-08)
- [ ] task-15: 集成验收——10s 可见性/裸会话自发现/R-01 空闲无通知/R-02 崩溃隔离/E-03 轮转恢复/长任务不抢跑 (depends_on: task-05~14 全部)
