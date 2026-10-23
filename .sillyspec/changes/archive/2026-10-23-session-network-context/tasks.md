---
author: flow-machine-draft
created_at: 2026-10-23T02:10:36.764Z
---
# 任务注册表（Tasks）— 2026-10-23-session-network-context

<!-- 工作分解契约：每行=可独立完成并当场验证的一步（做什么+怎么验证）；非目标/成功标准在 proposal/requirements，不进任务队列 -->

- [x] task-01: daemon 新建 src/network-info.ts 采集模块（os.networkInterfaces 过滤 internal/无 cidr，IPv4+IPv6 保留）+ tests/network-info.test.ts 单测；验证：pnpm -C sillyhub-daemon test tests/network-info.test.ts 绿
- [x] task-02: daemon 心跳体扩展——hub-client.ts HeartbeatBody 加 network_interfaces 字段 + heartbeat() 签名加尾参，daemon.ts _sendHeartbeatOnce 调 collectNetworkInterfaces 平铺传参；验证：pnpm -C sillyhub-daemon typecheck 过
- [x] task-03: 四个钉子测试文件参数个数断言 N→N+1（daemon-heartbeat-pending / daemon-heartbeat-sillyspec / sillyspec-platform-command×6处 / integration/selfupdate-scenarios×2处）；验证：pnpm -C sillyhub-daemon test 四文件聚焦绿
- [x] task-04: backend 新建 app/core/client_ip.py 共享工具（XFF 最右段→remoteAddress + has_forwarded_for），auth/router.py _client_ip 改调共享工具纯重构；验证：uv run pytest tests/modules/auth 聚焦绿（行为不变）
- [x] task-05: backend daemon_instances 加 network_info JSON 列（model.py）+ Alembic 迁移 + 链尾锚测试 test_align_platform_change_events_migration.py head 常量前移一行；验证：锚测试绿 + alembic upgrade head 幂等
- [x] task-06: backend 心跳/注册端点观测落库——heartbeat.py 加 HeartbeatNetworkInterface schema + 端点注入 Request 观测 observed_ip，version.py 注册首写，runtime/service.py heartbeat_daemon 加参落库（observed_ip 每跳直写 / network_interfaces 出现即整写缺席保留）；验证：新增落库语义用例绿（造数遵守 online⟺心跳<45s 不变量）
- [x] task-07: backend 判定引擎 session/network_context.py（render_network_env 纯函数：IPv4 CIDR 同段判定/四态降级/地址选择优先同段/超10截断 + network_context_for_turn：Redis 快照仅实际注入时更新/<60s 到点补注/故障降级每轮注入）；验证：uv run pytest tests/modules/daemon/test_network_context.py 绿
- [x] task-08: backend 注入穿透——NetworkContextBlock 数据块穿透 inject.py/control.py/create.py/service/__init__.py/queue.py 五文件（首轮 create 强制注入；后续轮走去重；queue 入队序列化 user_ip/has_xff、派发/steering 重放实时重算）；验证：mypy 过 + 注入链聚焦测试绿
- [x] task-09: 文档——.claude/skills/deploy-to-server/SKILL.md nginx 段标注 X-Forwarded-For 为网络判定硬依赖；验证：内容审阅
- [x] task-10: requirements 测试绑定槽回填 + 两端聚焦测试全量复跑（backend pytest 聚焦 + sillyhub-daemon 聚焦 + lint）；验证：绑定槽六条非空 + 全绿
