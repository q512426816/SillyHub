---
author: qinyi
created_at: 2026-09-10 11:42:10
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在「本地活动」查看本机 zcode 会话的对话/原文（含历史会话） |
| daemon | 宿主机读取执行者（SQLite 读取器 + 文件回落） |
| backend | platform_sync 读取端点（messages / content）转发与合成 |
| zcode 客户端 | 本地 SQLite 库的属主（只读消费，不干预其写入与清理） |

## 功能需求

### FR-01: 历史会话对话化回看（恒读库）
覆盖决策：D-001@v1, D-003@v1, D-004@v1
Given 上报条目 format=zcode-model-io-jsonl，其 rollout 文件已被清理、会话存在于 zcode 本地 SQLite
When 用户打开该会话的对话化视图（messages 端点）
Then 完整渲染对话段（user_input/reply/thinking/tool_use/tool_result），不报"文件不存在"

Given 会话含系统注入消息（semantics.uiVisibility=='hidden' / transcriptVisibility=='hidden' / visibility=='model-only' 任一命中）
When 归一化遍历 message
Then 该条 message 整体跳过，不产生假用户气泡

Given tool part 为单条含调用+结果（state.status=completed/error）
When 归一化
Then 一条 part 产出 tool_use（input 2KB 摘要）+ tool_result（output 4KB 摘要，is_error=(status=='error')）两段

Given tool part state.status ∈ running/pending（无 output）
When 归一化
Then 只产出 tool_use 段，不产出 tool_result 段

### FR-02: 原文视图从库合成（不截断）
覆盖决策：D-002@v1, D-007@v1
Given zcode 条目（无论文件在否）
When 用户打开原文视图（content 端点）
Then 后端先调 messages RPC，status=parsed 时返回九字段伪 jsonl（seq/kind/text/tool_name/tool_use_id/tool_input/tool_result/is_error/ts 逐行全量 JSON），truncated 沿用窗口语义，size_bytes=合成文本长度，不做 256KB 截断

Given messages RPC 非 parsed 或抛错（not_found / method_not_found 老 daemon / 离线 / 超时）
When content 端点处理
Then 回落现有 read_file 路径（该路径保留原 256KB 尾部截断语义不变）

### FR-03: 库读失败文件兜底
覆盖决策：D-001@v1, D-005@v1
Given format=zcode 且 SQLite 读取失败（node:sqlite 不可用 / 库文件缺失 / 会话不在库 / 查询异常）
When messages RPC 处理
Then 回落现有文件路径（lstat + parse-zcode-model-io）：文件在=正常解析成功；文件也缺=按现状 not_found 错误语义

Given 请求 path 越出 allowed_roots
When readAgentLogMessages 处理
Then assertWithinAllowedRoots 守卫先于 SQLite 分派执行（分派不绕过越界检查，语义同现状）

### FR-04: 零改动面
Given claude / codex 条目
When 任一读取端点处理
Then 分派路径与现状逐字节一致（不走 SQLite 分支）

Given beforeSeq 翻页请求（「加载更早」）
When zcode 会话对话化视图
Then 窗口切片语义与文件 parser 对齐，翻页正常

## 非功能需求

- 兼容性：Node <22.13 或 23.0–23.3（node:sqlite 不可导入）环境自动全走文件路径，
  不崩溃不报新错（engines 不 bump）；@types/node bump 仅类型层
- 只读安全：对 zcode 库恒 mode=ro 只读连接（WAL 并发读），写操作一律被拒且不尝试
- 可回退：分派逻辑收敛在单一 handler 分支 + 独立读取器模块，回退=移除分派（文件
  路径原样保留）
- 可测试：读取器为注入式纯逻辑（库路径可注入 fixture）；分派优先级四态各有用例

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-03 | 恒库主路径 + 文件灾备 |
| D-002@v1 | FR-02 | DB 路径不截断 |
| D-003@v1 | FR-01 | 隐藏/系统注入消息过滤判据 |
| D-004@v1 | FR-01 | tool 单 part 产两段映射 |
| D-005@v1 | FR-03 | 分派插入点（守卫后 registry 前） |
| D-006@v1 | 非功能-兼容性 | node:sqlite 版本带 + @types/node |
| D-007@v1 | FR-02 | 伪 jsonl 九字段封闭 + 回落捕获范围 |
