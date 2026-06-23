---
schema_version: 1
doc_type: module-card
module_id: lib-tool-gateway
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:25
---
# lib-tool-gateway

## 定位
worktree 租约域的"工具执行代理网关"前端客户端。在已获取的 worktree 租约内执行受控工具（文件读写/列目录/搜索/shell 执行等），由后端在隔离工作树中代为执行并返回脱敏输出。对应 `/api/worktrees/{leaseId}/tools`。

## 契约摘要
| 函数 | 语义 | HTTP |
|---|---|---|
| `executeTool(leaseId, input)` | 在指定租约内执行一个工具 | POST `/api/worktrees/{leaseId}/tools` |

类型：
- `ToolType`：`"file_read" | "file_write" | "file_list" | "file_search" | "shell_exec"`。
- `ToolExecuteRequest`：`{ tool_type: ToolType; params: Record<string, unknown> }`。
- `ToolExecuteResponse`：`{ id; tool_type; result_code; redacted_output; timestamp }`。

## 关键逻辑
```
入参 tool_type 选枚举值，params 为该工具的参数字典（路径/内容/命令等）
后端按 tool_type 路由执行，返回 result_code + redacted_output（脱敏）
```

## 注意事项
- 必须先通过 `lib-worktree` 拿到有效 `leaseId`，本模块不创建租约。
- `shell_exec` 风险最高，通常受审批（`lib-approvals`）约束。
- 输出字段名是 `redacted_output`，后端已脱敏，前端直接展示。
- `result_code` 语义因工具而异（文件类多为 0/非 0，shell 类为进程退出码）。
- 与 `lib-git-gateway` 结构对称。
- `_module-map` 标注 used_by 为空，目前无页面直接调用，多为 Agent 后端内部链路使用。
- 仅依赖 `lib-api`。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
