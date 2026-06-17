---
author: qinyi
created_at: 2026-06-17T22:50:00
---

# Tasks — daemon codex provider 完整支持

任务清单（细节在 plan 阶段展开）：

- [x] task-01: ProtocolAdapter 接口扩展（新增 buildHandshake / buildTurnStart 可选方法）
- [x] task-02: JsonRpcAdapter 实现 buildHandshake（initialize/initialized/thread.start 三条）
- [x] task-03: JsonRpcAdapter 实现 buildTurnStart（turn/start with threadId）
- [x] task-04: TaskRunner 集成握手序列（spawn 后 write buildHandshake）
- [x] task-05: TaskRunner thread/start response 监听（触发 buildTurnStart 延迟写入）
- [x] task-06: copilot buildArgs 实现（jsonl.ts）
- [x] task-07: opencode/openclaw/pi buildArgs 实现（ndjson.ts）
- [x] task-08: antigravity buildArgs 文档化占位（text.ts）
- [x] task-09: json-rpc.test.ts 新增 buildHandshake/buildTurnStart 单元测试
- [x] task-10: task-runner-provider-dispatch.test.ts 新增 codex 端到端 mock 测试
- [ ] task-11: codex 实测验证（quick chat / scan / task 三入口）—— 留待用户重启 daemon + 真实 codex CLI 后验证
- [x] task-12: 同步更新 backend-json-rpc.md（标注实现完成 vs 文档原声明）
