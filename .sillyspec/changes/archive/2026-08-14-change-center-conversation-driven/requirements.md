---
author: qinyi
created_at: 2026-08-14 15:12:45
---

# 需求规格（Requirements）— 变更中心会话驱动化

## 角色

| 角色 | 说明 |
|---|---|
| 工作区成员 | 在工作区会话里与 agent 对话、提出需求；在变更中心查看变更文件/进度；执行人工审批 |
| Agent（本地） | 在会话中跑 sillyspec CLI 创建/推进变更；接收审批注入消息并继续 |
| Daemon | spec 文件增量同步（带 change_dirs 标注）；承载交互式会话 |
| 平台（backend/frontend） | 被动接收同步并展示变更；提供会话入口；审批落库 + 投影收敛 + 服务身份注入 |

## 功能需求

### FR-01 变更自动出现（命门）
agent 在会话里经 sillyspec 创建的变更，经 daemon 增量同步后**自动**出现在平台变更中心列表。
- FR-01a daemon 增量推送请求体含 `change_dirs: string[]`（含 `changes/` 与 `changes/archive/` 前缀分组的 key）；旧 daemon 不带时 backend 按 ops 路径前缀检测兜底。
- FR-01b backend `apply_ops` 落盘后（事务外 best-effort）触发 scoped reparse；归档路径命中走全量。
- FR-01c scoped reparse **零删除**：scope 内外均不删行；删除仅发生在全量/手动重扫描。
- FR-01d 请求体缺 `change_dirs` 时缺省 `[]`，旧请求不报错（pydantic 兼容）。

### FR-02 变更-会话绑定
- FR-02a 新表 `change_session_links`（change_id/session_id/created_at，unique(change_id, session_id)）。
- FR-02b reparse 发现新变更（created）时，按可测试查询自动绑定：`workspace_id=:wid AND deleted_at IS NULL ORDER BY coalesce(last_active_at, created_at) DESC LIMIT 1`（跨成员、不限 status）。
- FR-02c 绑定写入失败不阻断 reparse 主流程。

### FR-03 工作区独立会话入口
- FR-03a workspace 一级导航新增「会话」tab + 新页 `/workspaces/[id]/sessions`（左侧会话列表含已结束 + 发起入口，右侧复用交互式会话面板）。
- FR-03b 新建会话为 workspace 级（传 workspace_id，不绑 change）。
- FR-03c 扩展现有 `GET /workspaces/{wid}/agent-sessions` 加 `include_ended` 参数返回完整会话字段（不新增双端点）。

### FR-04 去表单
- FR-04a 变更中心列表页删除「+ 新建变更」按钮与空态 CTA；空态引导「去会话跟 agent 对话」。
- FR-04b 删除 `create-change` 页面；删除后端 `change_writer` 的 create/proxy-create/execute/documents 端点及前端对应客户端方法。
- FR-04c 「重新扫描」按钮保留（全量语义兜底，负责收敛 scoped 不做的删除）。

### FR-05 详情页退化 + 审批联动
- FR-05a 删除全部执行控制：推进/重新派发/运行验证门禁/选智能体档案/团队配置，**含 quick 阶段分支**。
- FR-05b 保留只读展示：阶段进度条/执行日志流/变更文件/审核历史/任务看板。
- FR-05c 审批四端点行为：只落审批记录 + 阶段状态（decision 用各端点既有合法词表），**不派发 agent**；审批推进阶段时同步 upsert `platform_change_progress`（source=platform）使读时投影立即收敛。
- FR-05d 审批端点加 `notify_session: bool = true`：审批落库后由**后端服务身份**对绑定会话注入审批消息（绕过用户会话归属校验）；best-effort，失败不回滚审批；响应含 `notified_session` / `notify_error`。
- FR-05e 前端审批卡：意见 + 绑定会话只读展示 +「通过/打回并通知绑定会话」单端点调用；三类降级提示（turn 冲突=agent 忙 / 会话非 active / 其它异常），文案可复制。
- FR-05f MCP `submit_stage_review` 工具 docstring/返回契约随上述行为同步更新。

### FR-06 类型与文档
- FR-06a 后端 schema 改动后跑 `pnpm gen:types` 并提交 `api-types.ts` + `openapi.json`。
- FR-06b 模块文档同步：change / spec_workspace / agent / mcp_gateway / change_writer / daemon / frontend。

## 验收标准

对应 proposal「成功标准」，verify 阶段逐条核验：FR-01（新旧 daemon 双路径 + 零删除测试）、FR-02（绑定 SQL 语义测试）、FR-03（vitest 会话页）、FR-04（vitest 空态/无入口 + 后端端点删除回归）、FR-05（pytest 审批不派发/投影收敛/注入三类降级 + vitest 审批卡）、FR-06（gen:types diff 干净）。
