---
author: zcode-agent
created_at: 2026-10-16T09:55:00+08:00
---
# 决策记录（Decisions）— 2026-10-16-backend-mem-polling

## D-001@v1: 治理技术方案选型——子进程封装 + WS 推送 + 预览持久化（方案 A）
- 类型：architecture
- 状态：confirmed
- 来源：user（AskUserQuestion 用户亲选）
- 问题：backend 内存持续增长（昨夜 7 次 OOM）+ daemon 轮询负载偏高 + sessions 列表慢查询 1.4s，全面根治选哪条技术路线？
- 答案：**方案 A**。四个机制组合：①嵌入计算子进程封装（闲置自退+OOM 保主进程）；②change-writes 改 WS 事件推送，30s 轮询降 120s 兜底；③会话标题预览持久化为列；④部署内存配额重分配。
- 归一化需求：backend 稳态内存可控（闲时回落、不单调爬升致 OOM）+ 稳态轮询请求降 ~75% + 列表查询消窗口函数。
- 影响面：backend knowledge/spec_workspace/daemon(ws_hub,permission,protocol)/agent 模型/迁移/entrypoint/compose；sillyhub-daemon protocol/daemon/config；部署文档。
- 证据：方案选择轮（2026-10-16 对话），用户在 A/B/C 三方案对比表后亲选 A；四阶段设计用户回复"确认"。
- 优先级：P0
- 锚点：backend/app/modules/knowledge/vector_search.py:137
- 模块域：backend, sillyhub-daemon, deploy

## D-002@v1: 落选——方案 B（嵌入独立 Docker 容器 + 长轮询 + 索引优化）
- 类型：architecture
- 状态：rejected
- 来源：user（同轮落选）
- 问题：同 D-001。
- 答案：落选。sidecar 嵌入容器方案。
- 归一化需求：不采用独立容器承载嵌入计算。
- 影响面：无（未实施）。
- 否决理由：①小内存机器上模型常驻 200-300M 总常驻反而恶化；②compose 拓扑/镜像/部署脚本全动；③长轮询占连接；④索引优化治标。
- 复潮条件：服务器升配 ≥4G 且嵌入查询成为高频热路径时重评。
- 证据：同 D-001 轮。
- 优先级：P2
- 模块域：deploy

## D-003@v1: 落选——方案 C（进程内卸载 + 拉长轮询 + 缓存）
- 类型：architecture
- 状态：rejected
- 来源：user（同轮落选）
- 问题：同 D-001。
- 答案：落选。进程内 del+gc 卸载方案。
- 归一化需求：不采用进程内模型卸载作为内存治理手段。
- 影响面：无（未实施）。
- 否决理由：onnxruntime/Python allocator 进程内卸载不保证归还 OS（arena 棘轮），非确定性根治；轮询拉长恶化派发延迟。
- 复潮条件：无（机制性不可靠，非场景性劣势）。
- 证据：同 D-001 轮。
- 优先级：P2

## D-004@v1: 深扫发现的三处高危内存缺陷纳入本变更任务面
- 类型：architecture
- 状态：confirmed
- 来源：agent（Explore 子代理横扫报告，2026-10-16）
- 问题：子代理横扫 backend 进程内存增长嫌疑点，发现的高危项是否纳入本变更？
- 答案：纳入。①knowledge/vector_search.py `_indexes` 无界索引缓存（LRU 工作区上限）；②spec_workspace/service.py `_bundle_gzip_cache` 无全局帽（128MB LRU）；③permission_service.py 权限定时器 pin 已关 session 且 route_key None 路径不提交（idle-in-transaction 元凶，新开短 session+全路径提交）。中危配套（ws_hub _pending_rpcs 泄漏两径/disconnect 无身份校验/附件先读后检/WS 大消息日志）一并治理。
- 归一化需求：两处无界缓存加上限；权限定时器不再 pin 长命 session；ws_hub 泄漏路径收口。
- 影响面：backend knowledge/spec_workspace/daemon(ws_hub,permission_service,gateway_misc)/session_attachment。
- 证据：Explore 报告（文件:行号级）：嫌疑1 vector_search.py:168-171/137-154/223-233；嫌疑2 service.py:186-221/245-255；嫌疑3 permission_service.py:294/560-562/1543-1648 + 生产 idle-in-transaction FATAL 日志吻合；嫌疑4 ws_hub.py:594-612/630-647/114-131。
- 优先级：P0
- 锚点：backend/app/modules/knowledge/vector_search.py:168
- 模块域：backend, sillyhub-daemon

## D-005@v1: 执行期裁决——task-04 disconnect 身份校验需调用方透传 ws（边界微扩）
- 类型：process
- 状态：confirmed
- 来源：agent（主代理执行期裁决，2026-10-16）
- 问题：disconnect 连接身份校验在 ws_hub 内无法独立完成——调用方（gateway_misc.py:614 finally）必须把自己持有的 ws 实例传入才能比对；该文件不在 task-04 allowed_paths。
- 答案：disconnect 加可选 ws 参数（不传保持旧语义向后兼容）；gateway_misc.py 调用点 +1 行透传。非破坏性（可选参数、1 行接线），随 task-04 一并提交。
- 归一化需求：快速重连时旧 handler 收尾不得 pop 新连接。
- 影响面：ws_hub.py disconnect 签名（可选参）；gateway_misc.py 1 行。
- 证据：gateway_misc.py:614 持 websocket in scope；_evict_stale :133-158 同款先例。
- 优先级：P1
- 锚点：backend/app/modules/daemon/ws_hub.py:114
- 模块域：backend
