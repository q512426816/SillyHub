---
author: qinyi
created_at: 2026-06-17T22:55:00
---

# Plan — daemon codex provider 完整支持

plan_level: light

## 任务总表

| ID | 任务 | 文件 | 依赖 | Wave | 状态 |
|----|------|------|------|------|------|
| task-01 | ProtocolAdapter 接口扩展（buildHandshake / buildTurnStart 可选方法） | sillyhub-daemon/src/adapters/protocol-adapter.ts | - | 1 | ✅ |
| task-02 | JsonRpcAdapter.buildHandshake 实现 | sillyhub-daemon/src/adapters/json-rpc.ts | task-01 | 1 | ✅ |
| task-03 | JsonRpcAdapter.buildTurnStart 实现 | sillyhub-daemon/src/adapters/json-rpc.ts | task-01 | 1 | ✅ |
| task-04 | TaskRunner 集成握手序列（spawn 后 write buildHandshake） | sillyhub-daemon/src/task-runner.ts | task-01/02 | 2 | ✅ |
| task-05 | TaskRunner thread/start response 监听（触发 buildTurnStart） | sillyhub-daemon/src/task-runner.ts | task-03/04 | 2 | ✅ |
| task-06 | copilot buildArgs 实现 | sillyhub-daemon/src/adapters/jsonl.ts | - | 1 | ✅ |
| task-07 | opencode/openclaw/pi buildArgs 实现 | sillyhub-daemon/src/adapters/ndjson.ts | - | 1 | ✅ |
| task-08 | antigravity buildArgs 文档化占位 | sillyhub-daemon/src/adapters/text.ts | - | 1 | ✅ |
| task-09 | json-rpc.test.ts 新增握手单元测试 | sillyhub-daemon/tests/adapters/json-rpc.test.ts | task-02/03 | 3 | ✅ |
| task-10 | task-runner-provider-dispatch.test.ts codex 端到端测试 | sillyhub-daemon/tests/task-runner-provider-dispatch.test.ts | task-04/05 | 3 | ✅ |
| task-11 | codex 实测验证（quick chat / scan / task） | - | task-09/10 | 4 | ⏸ pending（用户重启 daemon 后实测） |
| task-12 | 同步更新 backend-json-rpc.md 模块文档 | .sillyspec/docs/sillyhub-daemon/modules/backend-json-rpc.md | - | 4 | ✅ |

## Checkbox 汇总（archive 检查用）

- [x] task-01 ProtocolAdapter 接口扩展
- [x] task-02 JsonRpcAdapter.buildHandshake 实现
- [x] task-03 JsonRpcAdapter.buildTurnStart 实现
- [x] task-04 TaskRunner 集成握手序列
- [x] task-05 TaskRunner thread/start response 监听
- [x] task-06 copilot buildArgs 实现
- [x] task-07 opencode/openclaw/pi buildArgs 实现
- [x] task-08 antigravity buildArgs 文档化占位
- [x] task-09 json-rpc.test.ts 新增握手单元测试
- [x] task-10 task-runner-provider-dispatch.test.ts codex 端到端测试
- [ ] task-11 codex 实测验证（留待用户重启 daemon 配合真实 codex CLI 验证）
- [x] task-12 同步更新 backend-json-rpc.md 模块文档

## Wave 分组

### Wave 1：接口扩展 + adapter 实现（无依赖，可并行）

- task-01 ProtocolAdapter 扩展（前置）
- task-02/03 JsonRpcAdapter 实现 buildHandshake/buildTurnStart
- task-06/07/08 其他协议 buildArgs 补全

### Wave 2：TaskRunner 集成（依赖 Wave 1）

- task-04 TaskRunner spawn 后 write buildHandshake
- task-05 TaskRunner 监听 thread/start response

### Wave 3：测试覆盖（依赖 Wave 2）

- task-09 json-rpc.test.ts 单元测试
- task-10 task-runner-provider-dispatch.test.ts 集成测试

### Wave 4：实测 + 文档同步

- task-11 codex 实测（需要重启 daemon，用户配合）
- task-12 backend-json-rpc.md 同步

## 完成标准（每 task）

- task-01: ProtocolAdapter 接口编译通过，5 adapter 不破坏
- task-02: buildHandshake 返回 3 条 JSON-RPC request（initialize/initialized/thread.start），JSON 合法
- task-03: buildTurnStart 返回 turn/start request，含 threadId + instructions + model
- task-04: TaskRunner._spawnAndStream 在 buildInput 后调 adapter.buildHandshake（若存在），逐行 write
- task-05: TaskRunner._handleLine 检测 thread/start response（id=2），调 buildTurnStart 写 turn/start
- task-06: jsonl.ts copilot buildArgs 返回 `['--output-format', 'json']`
- task-07: ndjson.ts buildArgs 按 provider 返回 opencode/openclaw/pi 对应启动参数
- task-08: text.ts antigravity buildArgs 返回 []，JSDoc 注明"待 CLI 二进制后补全"
- task-09: json-rpc.test.ts 新增 6+ 用例，全 35+ 通过
- task-10: task-runner-provider-dispatch.test.ts 新增 codex 端到端 mock 用例
- task-11: 用户在 /runtimes quick chat 选 codex 发消息，60s 内返回响应；scan/task 同样可用
- task-12: backend-json-rpc.md 注明 buildHandshake/buildTurnStart 已实现，JSON-RPC 传输完成

## 验证

- 单元测试：`cd sillyhub-daemon && pnpm test`
- 类型检查：`cd sillyhub-daemon && pnpm exec tsc --noEmit`
- 构建：`cd sillyhub-daemon && pnpm build`
- 集成：用户重启 daemon + 触发 codex lease

## 风险与回滚

- 协议字段错误 → 单元测试在 task-09 暴露，回滚 task-02/03
- TaskRunner 集成破坏 claude → task-runner.test.ts 在 task-10 暴露，回滚 task-04/05
- 实测失败（task-11）→ 重新审 design.md，必要时改用方案 B（codex exec --json）
