---
author: qinyi
created_at: 2026-09-07 10:35:00
---

# 任务清单（Tasks）

- [ ] task-01: daemon liveness 基座——types.ts（LivenessState/DeriverInput/Output）+ registry.ts（format→deriver 注册表，仿 parser 扩展点模式）
- [ ] task-02: zcode deriver（E-03 实证规则）+ fixture 单测
- [ ] task-03: tailer 循环——offset 差量读/reset/ended 回收/watch≤16/4MB 预算/R-02 fail-open + 单测
- [ ] task-04: 自发现最小版——spawn 记录 + sessions.json 恢复 + 窗口重扫兜底，claude/pi 直算路径
- [ ] task-05: 自发现窄扫——codex（uuid）/zcode（共享 rollout 目录）标记匹配 + cwd 归属防串台
- [ ] task-06: hub-client 批量上报 POST /api/agent-logs/states 接线 + daemon.ts 生命周期挂接（独立 try，崩溃不影响主循环）
- [ ] task-07: backend 四列迁移（alembic）+ AgentSessionLogORM/schema 增字段
- [ ] task-08: POST /agent-logs/states 端点——批量 upsert-create（origin=liveness-discovered）+ 转移检测（blocked 段时间戳）
- [ ] task-09: Notification type=agent_blocked——120s 阈值/段级 dedupe/与 5min auto-deny 同源分级/Redis 推
- [ ] task-10: codex deriver（E-02 词汇表规则）+ fixture 单测
- [ ] task-11: E-01 十分钟实证（裸 claude transcript 是否记 permission 等待）→ 结论回写；通过则实现 claude deriver blocked 分支，证伪则定稿关闭
- [ ] task-12: list_workers 增 liveness 字段（R-03：先实调 mission 汇入点，过重则 backend 直查落库状态）
- [ ] task-13: sillyspec 仓派发模板改写——终态轮询+kill lease 段升级为 blocked→升级不 kill / working→再等
- [ ] task-14: 前端——面板徽章+推导时间/工作台聚合表（静默时长=now-last_event_at）/idle 小红点/agent_blocked 通知渲染 + pnpm gen:types
- [ ] task-15: 集成验收——10s 可见性/裸会话自发现回归/R-01 空闲无 blocked 通知/R-02 tailer 崩溃隔离/E-03 轮转恢复/长任务不抢跑 kill
