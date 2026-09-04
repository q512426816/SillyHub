---
author: qinyi
created_at: 2026-09-04 22:06:01
---

# 任务清单（Tasks）

> 任务名唯一真相在本文件；实现细节（TaskCard）由 execute 阶段按 plan.md Wave 展开。

- [ ] task-01: backend WS 消息契约（protocol.py 两条 MSG 常量 + ws_hub.py send_sillyspec_resolve / send_sillyspec_ghost_cleanup）
- [ ] task-02: backend REST 端点（sillyspec-resolve / sillyspec-ghost-cleanup：权限+归属+change 白名单+504）
- [ ] task-03: backend 心跳结果链路（DTO + daemon_instances 新 JSON 列 + 迁移 + heartbeat_daemon 两态落库/register 恒清 + 机器视图透出）
- [ ] task-04: backend 测试（端点权限/白名单/504/两态落库/键不出现置 NULL/register 恒清）
- [ ] task-05: daemon 协议与分发（protocol.ts 常量+payload + _handleWsMessage 两直连 case + in-flight 串行 guard）
- [ ] task-06: daemon 命令执行与结果槽（runResolve/runGhostCleanup + _lastCommandResult 10min 终态窗 + 心跳携带 + config 键）
- [ ] task-07: daemon 测试（case 分发/strategy→flag 映射/超时/非零退出/忙拒/心跳携带与过期停发）
- [ ] task-08: 前端 API 与类型（lib/daemon.ts 两触发函数 + pnpm gen:types 再生成）
- [ ] task-09: 前端平台同步卡片（platform-sync-section + 权限 hook + 桌面/移动挂载 + 回显/150s 恢复）
- [ ] task-10: 前端总览卡收口（changes-overview-card CLI 指引改跳转变更中心）
- [ ] task-11: 模块文档更新（backend.md / sillyhub-daemon.md / frontend.md 变更索引条目）
