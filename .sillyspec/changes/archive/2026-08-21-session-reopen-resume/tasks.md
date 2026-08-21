---
author: qinyi
created_at: 2026-08-21 11:37:05
change: 2026-08-21-session-reopen-resume
---

# 任务（Tasks）— 打通会话重新开启（reopen）链路

> 详细设计依据：design.md DS-1 ~ DS-8；Wave 分组/同文件约束/依赖见 plan.md（v3，编号 01-09 连续）。任务名唯一真相在本文件，plan.md 仅纯 ID 引用。

- [x] task-01: DS-1 增量回填——run_sync/service.py submit_messages 内 latest_session_id 块加 AgentSession.agent_session_id 最新值覆盖（batch FK 空跳过）；测试：回填、fork 覆盖、batch 跳过、同事务
- [x] task-02: DS-2 存量迁移——Alembic 迁移取最后一轮 run session_id 回填（provider 限定 claude/codex，排除软删）+ 独立迁移测试；downgrade no-op；SQLite 兼容
- [x] task-03: DS-4 confirm/mark-recovery-failed 可选 lease_id——router.py SessionRuntimeRequest（:1246）加可选字段，service 两函数（:2060/:2130 区域）提供时校验匹配当前 lease，不匹配幂等跳过；**保留既有"非 ended/failed → failed"翻转**（复审 gap：active→failed 供 async-fail 桥接 daemon.ts:1340-1389）；顺带定义 RECONNECTING_RETRY_WINDOW_SEC=180 常量；OpenAPI dump；测试：幂等、lease 不匹配跳过、无 lease_id 向后兼容、既有 recover 链路不变；顺带更新 test_session_reopen.py TestReopenConfirmLinkage 过时 docstring（:638-640）
- [x] task-04: DS-5+DS-7 reopen 前置校验扩展——①reconnecting 且 last_active_at>RECONNECTING_RETRY_WINDOW_SEC 放行重开（旧 lease 置 cancelled，新建旋转 token 重发；last_active_at=now 已写 service.py:2414 复核）②cwd 空 409 专用错误 + 中文文案（原独立 DS-7 任务并入）；测试：窗口内外两分支 + cwd 空 409
- [x] task-05: DS-6 巡检协程——**独立文件** backend/app/modules/daemon/sweep.py + main.py lifespan 挂载（仿 mission_patrol_loop）；60s 周期；import task-03/04 常量；lease 终态 cancelled；条件更新幂等；测试：收敛、幂等、不误伤窗口内会话
- [x] task-06: DS-3 daemon 双向确认——daemon.ts _routeSessionResume 显式供给 runtimeId（写 _recoveryRuntimeBySession 映射或封装加参，任务卡定案二选一）+ 成功调 confirmReconnected（携 lease_id）；失败路径（restore 抛错 + SessionAlreadyExistsError try 前分支）调 markRecoveryFailed；best-effort 不阻塞；修正 daemon.ts:2932 矛盾注释；补 daemon-session-resume-route.test.ts createMockClient 缺失的 confirmReconnected/markRecoveryFailed mock（:41-56）；签名统一记录于任务卡（design.md 不回改保持 hash 稳定）
- [x] task-07: daemon vitest——confirm 真实发出断言（runtimeId 供给，防 F1 回归）、SessionAlreadyExists 失败分支、best-effort 语义
- [x] task-08: 前端会话页 reconnecting 本地计时>240s 显示"重新开启"入口（复用 handleReopen）；409 提示中文化；OpenAPI schema 变更则跑 pnpm gen:types 提交 api-types.ts + openapi.json
- [x] task-09: 收尾——部署说明（先 backend 后 daemon）+ 模块文档同步（backend.md/daemon.md 契约层）+ 全量回归（backend pytest / daemon vitest / frontend vitest，按 local.yaml）

## 依赖关系

task-01/02/03 独立可先行（W1，文件互不相交）；task-03 → task-06（lease_id 契约）→ task-07；task-03 → task-04（同文件分层必须异 Wave）→ task-05（常量依赖）；task-03 → task-08（OpenAPI）；task-09 最后。
