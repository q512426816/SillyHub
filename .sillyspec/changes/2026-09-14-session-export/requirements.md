---
author: qinyi
created_at: 2026-09-14 13:58:17
---
# 需求规格（Requirements）— 会话一键导出

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在会话列表勾选会话、触发导出、获得下载文件的最终使用者 |
| 群聊参与者/workspace 管理员 | 对群会话有读权限的用户，可导出其可访问的群会话 |
| 开发者 | 维护导出端点/组装逻辑/前端入口的后端与前端工程师 |

## 功能需求

### FR-01: 批量导出入口
覆盖决策：D-001@v1

Given 会话列表某工作区组处于多选态且勾选了 1~N 个会话
When 用户点击批量操作条上的「导出选中（N）」并在档位下拉中选择「导出对话（Markdown）」或「导出完整信息（JSON+附件）」
Then 前端以 POST 调用 `/api/daemon/sessions/export`（session_ids=勾选集，tier=所选档），按钮进入 loading，成功后浏览器直接下载文件并 toast 成功，失败 toast 错误

Given 勾选数为 0
When 批量栏渲染
Then 导出按钮 disabled（与删除/归档按钮同语义）

Given 请求 session_ids 数量 >50 或为空
When 请求到达后端
Then 422 校验拒绝

### FR-02: 两档内容口径
覆盖决策：D-002@v1

Given 一个含多轮对话的普通会话
When 导出 chat 档
Then Markdown 含会话头（标题/时间/runtime/轮数）+ 按 run 分轮的用户消息（`user_input` 行）与助手正文（`stdout` 行经噪声排除：跳过空行/AskUserQuestion/`[TOOL_RESULT]`/`[(SYSTEM|RESULT)...]`/`[TOOL_USE]`/`[TASK_*]`/技能装载行/CLI 合成错误行/OVERRIDE 撤回行/`[THINKING]` 行，剥 `[ASSISTANT]`/`[LOG:\w+]` 前缀），附件标记行原样保留

Given 同一会话
When 导出 full 档
Then zip 内 full.json 含 export_version/session/runs（模型/token/时间/状态/diff_summary/error_code）/logs 全字段（channel/content_redacted/timestamp/tool_kind/parent_tool_use_id/subagent_type/depth/edit_patch/metadata）/tasks/attachments 清单，且附件本体写入 `attachments/{附件id}_{原名}`

Given 群聊会话（含影子成员投影行）
When 导出任一档
Then 发言行带 `metadata_.member_name` 前缀（chat 档）或原样保留 metadata（full 档），权限按群可访问口径放行

### FR-03: 权限与存在性
覆盖决策：D-001@v1

Given 会话属其他用户、或已软删、或群会话且请求者非参与者非 workspace admin
When 导出请求包含该会话
Then 整个请求 404（不泄露存在性，不做部分成功）

### FR-04: 响应矩阵与文件名
覆盖决策：D-002@v1

Given 单会话 chat 档请求
When 成功
Then 响应 `text/markdown`，文件名 `{标题 sanitize}_{id前8}.md`

Given 多会话 chat 或任一 full 请求
When 成功
Then 响应 `application/zip`，文件名 `会话导出_{档位}_{YYYYMMDD_HHMMSS}.zip`，zip 内每会话一目录/文件（标题 sanitize + id 前 8 位防重名；标题非法字符/Windows 保留名清洗，空回退「未命名会话」）

所有 Content-Disposition 用 RFC5987 UTF-8 编码（中文文件名浏览器可正确落地）。

### FR-05: 截断与体量防护
Given 单会话日志 >20000 行（agent_run_logs 行，每会话独立计数）
When 导出
Then 保留最早 20000 行，产物内标注 `truncated: true` + `dropped_rows`（丢弃行数）

Given full 档整包附件总量（按附件元数据 bytes 预聚合）>512MB
When 导出请求
Then 返回 413 与明确提示（分批导出），预检查发生在附件取流之前

Given 单个附件对象在存储中丢失
When 导出 full 档
Then 该附件在清单标 `missing: true`，整包继续成功（不 500）

### FR-06: 行级导出入口
Given 会话行 hover
When 用户点击操作列新增的下载图标并选择档位
Then 以单会话 id 走同一导出链路

### FR-07: 类型同步
Given 后端 `SessionExportRequest` schema 落地
When 跑 `pnpm gen:types`
Then `api-types.ts` 含该请求类型且对既有类型零破坏，`openapi.json` 同步提交

## 非功能需求

- 兼容性：纯新增端点与入口，不使用导出功能时列表页行为零变化；OpenAPI 只增不改
- 可回退：删除新增文件/入口即完全回退，无数据迁移、无状态
- 可测试：噪声排除为纯函数表驱动测试；权限/降级/截断/413 均有 pytest 用例；前端入口有 vitest 用例
- 跨平台：zip 条目名 sanitize 兼容 Windows 保留名；文件名 RFC5987 中文兼容
- 性能：CPU 密集序列化走 `anyio.to_thread.run_sync`；行数 20000 上限 + 附件总量 512MB 上限双护栏

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01/FR-03/FR-06 | 同步流式导出：POST 端点 + 一次性响应 + 权限对齐详情口径 |
| D-002@v1 | FR-02/FR-04/FR-05 | 双格式两档内容 + 附件按档位区分（chat 标记/full 打包本体） |
