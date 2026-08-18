---
schema_version: 1
doc_type: module-card
module_id: tool-kind
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 工具调用分类器（tool-kind）

## 定位
工具调用分类器（`src/tool-kind.ts`）：从 agent 事件的 toolName + args 推导 14 类 `ToolKind` 观测标签，供 task-runner 上报用量/审计归类。与 backend `app/modules/agent/tool_kind.py` 保持同逻辑、单测用例共享（R-05 防漂移约定：改任一侧必须同步另一侧）。唯一调用方是 task-runner。

## 契约摘要
- `TOOL_KIND_VALUES`：`sillyspec / skill / bash / read / write / search / task / web / todo / plan / ask / schedule / mcp / other`（14 类）。
- `ToolKind`：上述字面量 union。
- `classifyToolKind(toolName, args): ToolKind | null`——toolName 缺失/空返回 null（非工具调用）；大小写不敏感（先 toLowerCase）。

## 关键逻辑
```
name=bash → isSillyspecCommand(args.command) ? 'sillyspec' : 'bash'
write←{write,edit,multiedit,notebookedit}；search←{grep,glob}；task←{task,agent}
web←{websearch,webfetch}；todo←{todowrite,taskcreate,taskupdate,taskget,tasklist}
plan←exitplanmode；ask←askuserquestion；schedule←startsWith('cron')||schedulewakeup
mcp←startsWith('mcp__')；其余→other
isSillyspecCommand: 按 &&/;/| 切段→逐行取首命令（跳过 pnpm/npx/yarn/sudo/node 前缀）
                  首命令==='sillyspec' 才归（ql-20260705-006 C3，推翻 D-001 子串语义）
```

## 注意事项
- sillyspec 归类用「主命令」语义而非子串匹配：DB 实测 41 条含 sillyspec 字样的 bash 命令里 34 条（83%）是脚本内容/grep 提及被误归，故改为逐段解析首 token（内部模块注释记载此决策）。
- `schedule` 匹配 `startsWith('cron')`：前缀匹配而非全名匹配，新增 cron 系工具名天然覆盖。
- `mcp__` 前缀匹配 MCP 工具（如 `mcp__daemon__dispatch_worker`）。
- 判定顺序与 Python 版完全一致（design.md §7 逐字参照）；新增工具类别需双端同步改 + 同步共享测试用例。
- args 形状不合法（command 非 string）时按空串处理 → 归 `bash`，不抛错。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
