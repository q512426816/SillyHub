---
author: qinyi
created_at: 2026-09-14 13:58:17
---
# 提案书（Proposal）— 会话一键导出

## 动机

平台会话承载了用户与 Agent 的全部协作过程，但没有任何导出能力。用户想留档、分享、或把对话贴给别的 AI 继续处理时，只能截图或手动复制。本提案为会话列表增加一键导出：选中会话后按两档内容（对话/完整）下载。

## 关键问题

1. **会话域零导出端点**：全仓 grep 仅 ppm 域有 export-excel 先例，`agent_run_logs` 里沉淀的对话正文（唯一持久化源）没有任何取出通道。
2. **"完整信息"分散在多表**：对话正文、思考、工具调用、轮次元数据、token 用量、任务卡、附件本体分别在 `agent_run_logs`/`agent_runs`/`agent_session_task`/`session_attachments`(+MinIO)，用户无从自行聚合。
3. **手动复制不可用**：群聊发言者身份在 `metadata_` JSON 里、子代理归属在 `parent_tool_use_id`/`depth` 列，复制粘贴丢上下文。

## 变更范围

- 后端：daemon 会话域新增 `POST /api/daemon/sessions/export`（body: session_ids 1~50 + tier chat/full），同步组装——chat 档回 Markdown，full 档回 zip（full.json + attachments/ 附件本体）；权限对齐详情端点口径（owner/群可访问，软删 404）。
- 前端：会话列表批量操作条加「导出选中（N）」档位下拉；行 hover 加导出图标同款下拉；`lib/daemon/session-export.ts` 认证下载（401 刷新重试）。
- 测试：后端 pytest（内容断言/zip 结构/权限/降级/截断/路由顺序）+ 前端 vitest + `pnpm gen:types` 同步。

## 不在范围内（显式清单）

- 不做移动端 `m/` 页与悬浮窗导出入口
- 不做导出历史/定时导出/服务端归档/断点续传（D-001@v1 已否决异步任务方案）
- 不做会话恢复/导入（单向导出）
- 不导出排队中消息与定时发送消息（尚未成为对话事实）
- 不做 HTML 导出格式（D-002@v1 选定 Markdown+JSON 双格式）

## 成功标准（可验证）

- 列表勾选 1~50 个会话，点导出选档位，浏览器直接下载对应文件（单会话 chat=.md，其余=zip）
- chat 档 Markdown 含全部用户消息与助手正文（stdout 噪声排除后），无 `[TOOL_USE]`/`[TASK_*]` 等过程噪音行
- full 档 zip 内 full.json 含 runs/logs/tasks/attachments 全字段，附件本体在 `attachments/` 可打开
- 跨用户/软删/群非成员访问导出 → 404；单附件对象丢失 → `missing: true` 整包继续
- 不使用导出功能时，列表页行为与现状零差异（仅多按钮/图标）
- 后端 pytest 模块聚焦通过 + 前端 vitest 通过 + gen:types 零内容差于旧类型
