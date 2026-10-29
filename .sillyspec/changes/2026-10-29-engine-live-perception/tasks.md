---
author: flow-machine-draft
created_at: 2026-10-29T05:06:35.344Z
---
# 任务注册表（Tasks）— 2026-10-29-engine-live-perception

- [x] task-01: spike——zcode 遥测 stream.chunk 覆盖面实测（驱动层日志/真机会话抓样本）：是否覆盖工具参数生成期；结论（估算路径 or 降级 awaiting_first_token 脉冲）落 design Phase A 注记——验证：实测记录进变更目录 spike-notes.md
- [x] task-02: daemon Claude 心跳源——claude-events.ts input_json_delta 字符计数器（节流 1s、不缓冲内容本体、onTurnEnd 清零）+ claude-sdk-driver.ts 首包前 awaiting_first_token——验证：claude-events.test.ts 新增用例绿
- [x] task-03: daemon zcode 心跳源——zcode-events.ts 遥测 stream.chunk 解析 + zcode-app-server-driver.ts 通知接入（按 task-01 结论走估算或降级）——验证：zcode-events.test.ts 新增用例绿
- [x] task-04: daemon codex 桥接——codex-app-server-driver.ts token_usage_updated 处理点转发心跳消息（authoritative）——验证：codex-app-server-driver.test.ts 新增用例绿
- [x] task-05: daemon 上行链——daemon.ts 拦截 turn_heartbeat_report（turn_phase_report 同款形态）→ hub-client.ts POST turn-heartbeat（fire-and-forget）——验证：daemon 上行相关测试绿（含心跳不进 usage 台账断言）
- [x] task-06: backend notify_turn_heartbeat 端点（越权防护照抄 notify_turn_phase）+ publish SSE 直发不落库 + pydantic model；openapi 变更判定与双侧 gen:types 同步（若有）——验证：backend test_event_publish.py 新增用例绿
- [x] task-07: 前端 session-sse.ts——SessionEventKind 加 turn_heartbeat + 分发 case + 轮级心跳状态（按 parent 分桶、main 优先、5s 无心跳自清、不进段树不刷 lastEventAt）——验证：类型与分发测试绿
- [x] task-08: 前端 marquee 三态——turn-live-marquee.tsx 等待条目三态文案 + 估算补显（约/弱化/落定即隐）+ >30s 提示 + turn-timeline 传递——验证：NEW turn-heartbeat-marquee.test.tsx 用例绿（三态/选主/回落/落定即隐）
- [x] task-09: 原型——NEW engine-live-perception-view.tsx（生产组件+假心跳三态演示）+ pnpm prototype:build + 复件 prototype-engine-live-perception.html 进变更目录 + visual-evidence.md——验证：build 产物可开、三态可视
- [ ] task-10: 相关测试面全量回归（daemon 三测试 + backend publish + 前端 marquee/sse 相关）+ 前端 tsc/eslint 0 error + daemon/backend 静态检查——验证：全绿清单落收口汇报
