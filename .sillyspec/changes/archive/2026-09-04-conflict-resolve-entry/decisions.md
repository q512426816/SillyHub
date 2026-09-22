---
author: qinyi
created_at: 2026-09-04 12:55:00
---

# 决策记录（Decisions）

## D-001@v1: 命令下发通道——机器级即时 WS 指令（方案 A）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 页面按钮 → 机器执行 sillyspec 命令的技术通道？（A 机器级即时 WS 指令 / B 正式 control command 新 KIND 落库+ack / C host_fs.run_command 白名单扩展）
- answer: 方案 A。复用机器级 fire-and-forget WS 指令先例（self_update/cleanup/sillyspec_update 同款，`POST /machines/{id}/sillyspec-update` router.py:1269）：backend 校验权限后经 DaemonWsHub 即时下发，daemon 侧 handler 本地 execFile 执行 sillyspec CLI（sillyspec-manager 30s 超时模式），执行结果缓存于 daemon 内存并随下次心跳 sillyspec_status 通道上报（≤60s 页面自动回绿）。B 的离线补拉增益对本场景为负（sillyspec 操作必须机器在线，离线排队上线时现场可能已变）且六处协议扩展过重；C 的 host_fs RPC 挂会话上下文无页面载体、字符级白名单对变长 change 名脆弱，不适配
- normalized_requirement: 不新建命令队列表；新指令必须有心跳侧执行结果上报（action/exit_code/时间戳），否则 fire-and-forget 失败无从诊断
- impacts: [FR-01, FR-02, FR-03, FR-05]
- evidence: 用户 AskUserQuestion 方案轮实答选 A（2026-09-04）；Explore 子代理通道调研报告（control_commands.py / ws_hub.py / sillyspec_update 先例 / host_fs 白名单双端对齐）

## D-002@v1: 功能范围——冲突裁决 + ghost 清理一并纳入
- type: scope
- priority: P0
- status: accepted
- source: user
- question: 页面处理入口只做同步冲突裁决，还是连 ghost 残留清理一起做？
- answer: 一起做。两类「需关注」红灯共用同一套下发通道与权限模型，增量成本低，一次闭环。abort 不上页面（活跃变更误弃风险，留 CLI），记入 design Non-Goals
- impacts: [FR-02, FR-03, FR-04]
- evidence: 用户 AskUserQuestion 需求澄清轮实答（2026-09-04）

## D-003@v1: 操作权限——机器所有者 + 平台管理员
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 裁决有破坏性（覆盖冲突某一端版本），谁可点「裁决/清理」按钮？
- answer: 机器所有者 + 平台管理员。冲突数据挂机器维度，机器主人最清楚现场，管理员兜底无主机器；其他成员只读红灯不可操作。活跃阶段变更（非 archived）的冲突行加警示标注 + 确认弹窗加重文案，不硬禁（机器主人有最终裁量）
- impacts: [FR-04]
- evidence: 用户 AskUserQuestion 需求澄清轮实答（2026-09-04）

## D-004@v1: 心跳 sillyspec_command_result 落库语义——两态清除 + register 恒清（Grill X-04 修订）
- type: consistency
- priority: P1
- status: accepted
- source: design-grill
- question: 命令结果字段的心跳携带语义用三态（键不出现=保持 / null=清除 / 对象=直写）还是两态？
- answer: 两态。对象=整包直写、键不出现=置 NULL 清除，与 sillyspec_status 现状（model.py:108-109、runtime/service.py:525-529）语义一致；daemon 终态窗过期后直接停发该键，不发送显式 null；register 恒清（service.py:232-235 先例）堵 daemon 重启后 DB 残留。三态需在心跳面新增 absent/null 判别，唯一先例 router.py:988 display_alias PUT 属 PUT 端点非心跳，无谓引入新机制
- normalized_requirement: heartbeat_daemon 对 sillyspec_command_result 按两态处理（对象=直写/缺键=置 NULL）；register 恒清；daemon 侧禁止发送显式 null
- impacts: [FR-05, design §5 Phase1/2, §7 携带语义, §7.5 register 行, §9 兼容策略]
- evidence: brainstorm-review-2026-09-04-213204 X-04（model.py:108-109 / service.py:525-529、232-235 / router.py:988）
