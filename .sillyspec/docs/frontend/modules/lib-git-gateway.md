---
schema_version: 1
doc_type: module-card
module_id: lib-git-gateway
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:25
---
# lib-git-gateway

## 定位
worktree 租约域的"Git 操作代理网关"前端客户端。在已获取的 worktree 租约内执行受控 git 命令（如 status/add/commit/push 等），由后端在隔离工作树中代为执行并返回脱敏输出。对应 `/api/worktrees/{leaseId}/git`。

## 契约摘要
| 函数 | 语义 | HTTP |
|---|---|---|
| `executeGitOperation(leaseId, input)` | 在指定租约内执行一条 git 命令 | POST `/api/worktrees/{leaseId}/git` |

类型：
- `GitOperationRequest`：`{ operation: string; args?: string[] }`。
- `GitOperationResponse`：`{ id; operation; result_code; redacted_output; timestamp }`。

## 关键逻辑
```
入参 operation 为 git 子命令名（如 "status"），args 为参数数组
后端执行后返回 result_code 与 redacted_output（已脱敏，过滤密钥/敏感路径）
```

## 注意事项
- 必须先通过 `lib-worktree` 拿到有效 `leaseId`，本模块不创建租约。
- 输出字段名是 `redacted_output`，后端已做敏感信息脱敏，前端直接展示即可。
- `result_code` 为 0 通常表示成功，非 0 为 git 命令失败码。
- 该网关与 `lib-tool-gateway` 结构对称（同样挂在 worktree 租约下）。
- `_module-map` 标注 used_by 为空，目前无页面直接调用，多为 Agent 后端内部链路使用。
- 仅依赖 `lib-api`。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
