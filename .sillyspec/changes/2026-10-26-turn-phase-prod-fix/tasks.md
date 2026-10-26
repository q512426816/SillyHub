---
author: flow-machine-draft
created_at: 2026-10-26T05:54:46.929Z
---
# 任务注册表（Tasks）— 2026-10-26-turn-phase-prod-fix

<!-- 工作分解契约：每行=可独立完成并当场验证的一步（做什么+怎么验证）；成功标准在 requirements，不重复进队列 -->

- [x] task-01: daemon 观测 helper——新建 src/turn-phase-observability.ts（warn-once 有界 Set + traceEnabled() 逐次读 env）+ tests/turn-phase-observability.test.ts 三态单测；验证：pnpm -C sillyhub-daemon test tests/turn-phase-observability.test.ts 绿
- [x] task-02: daemon 三个上报点接观测——turn-control.ts inject_received 发出点/events.ts first_event 发出点/daemon.ts reportTurnPhase 与 4845 拦截分支（失败首警 warn、TRACE 成功 info、发出点到达记点）；验证：typecheck 过 + 单测绿
- [x] task-03: backend NAT 文案——network_context.py _machine_line 拆两态（无网卡数据保留不可用断言/无掩码 NAT 低置信+候选并存删断言）+ test_network_context.py 两态回归用例；验证：聚焦测试绿
- [x] task-04: 定位采集——bundle 重打+部署本机 daemon（需用户配合窗口：重启会断活跃会话）+ 生产会话发消息采日志，锁定断点环节（发出点未执行/deps 调用异常/HTTP 失败三分类）；验证：日志证据落变更目录（evidence-task04.md：断链载体=旧进程 43940 进程级异常，代码无缺陷，新进程全链路即通）
- [ ] task-05: 防御落地验证（据 task-04 证据改写：无缺陷代码可改）——观测三态生产实证（TRACE 522 条已证/默认静默与失败首警由单测锁定）+ 重启自愈路径实战确认（强杀→分离启动器→平台恢复）；验证：evidence 记录 + 单测绿
- [ ] task-06: 生产终验——修复部署后生产会话发消息，状态条翻动离开「执行器已接收」（FR-01 验收）+ 两端聚焦测试全绿 + 既有钉子零回归；验证：状态条观察 + 聚焦套件全绿
