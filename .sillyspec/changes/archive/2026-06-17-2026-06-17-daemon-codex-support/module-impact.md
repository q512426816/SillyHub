---
author: qinyi
created_at: 2026-06-17T23:25:00
---

# Module Impact — daemon codex provider 完整支持

本变更影响的 daemon 模块（仅列本次 codex 改动相关文件，其他 git diff 文件归属前序变更）。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| backend-json-rpc | 接口变更 + 逻辑变更 | sillyhub-daemon/src/adapters/json-rpc.ts | 新增 buildArgs（codex app-server --listen stdio://）+ buildHandshake（init/initialized/thread.start）+ buildTurnStart（threadId+instructions+model） | false |
| backend-stream-json | 接口变更 | sillyhub-daemon/src/adapters/stream-json.ts | buildArgs 签名扩展 prompt?:string（不影响现有逻辑） | false |
| backend-jsonl | 逻辑变更 | sillyhub-daemon/src/adapters/jsonl.ts | copilot buildArgs 返回 ['--output-format', 'json'] | false |
| backend-ndjson | 逻辑变更 | sillyhub-daemon/src/adapters/ndjson.ts | buildArgs 返回 [run, --format, json, --dangerously-skip-permissions, prompt] + 签名扩展 | false |
| backend-text | 逻辑变更 | sillyhub-daemon/src/adapters/text.ts | antigravity buildArgs 占位返回 [] + JSDoc 说明 | false |
| task-runner | 接口变更 + 逻辑变更 | sillyhub-daemon/src/task-runner.ts | _spawnAndStream 步骤 6c 集成 buildHandshake；JSON-RPC adapter 跳过 buildInput；_handleLine 检测 thread/start response 触发 buildTurnStart；buildArgs 调用补传 prompt | false |
| backend-json-rpc（文档） | 文档同步 | .sillyspec/docs/sillyhub-daemon/modules/backend-json-rpc.md | 同步握手实现 + codex 字段名陷阱 + buildInput 跳过理由 | false |

## 测试影响

| 测试文件 | 新增用例 | 备注 |
|---------|---------|------|
| sillyhub-daemon/tests/adapters/json-rpc.test.ts | +16（buildArgs 6 + buildHandshake 5 + buildTurnStart 5） | 全通过 |
| sillyhub-daemon/tests/task-runner-provider-dispatch.test.ts | +2（codex 握手序列 + claude 无握手基线） | 全通过 |

## 未匹配文件

无（所有改动均落在 daemon 模块范围内）。
