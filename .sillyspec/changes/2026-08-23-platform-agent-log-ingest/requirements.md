---
author: qinyi
created_at: 2026-08-23 04:50:00
---

# 需求（Requirements）— 平台承接 Agent 日志上报

> 权威需求源：CLI 仓 `docs/platform-agent-log-protocol.md` §1（上报契约）+ §1.3（平台端待办两件事）。用户上一会话已确认：推送式架构、面板字段、内容渲染不做。

## 功能需求

- **FR-01** `POST /api/agent-logs` 写端点：接收 CLI 上报 body（`schema_version`/`pushed_at`/`agent_cwd`/`workspace_id`/`scan_run_id`/`entries[]`），鉴权与进度同步写端点同规——无凭据 401、`shk_live_`/JWT 凭据有效也 403（写通道仅 `shpsync_`）、token 无 workspace 归属 403 fail-closed；任意 2xx 即成功（CLI 不读 body）。
- **FR-02** 落库 upsert：按 `(workspace_id, log_path)` 复合唯一键幂等 upsert（重推整行覆盖，不产生重复行）；workspace_id 只取 token 派生值，body 的 `workspace_id` 仅忽略（不信任、不落库）；整行存 entry 元信息：`harness`/`format`/`session_id`/`originator`/`detected_via`/`agent_cwd`/`exists`/`size_bytes`/`mtime_ms`/`first_seen_at`/`last_seen_at`/`invocations`/`last_command`（+ 顶层 `scan_run_id`/`pushed_at`）。
- **FR-03** `GET /api/agent-logs?workspace_id=<uuid>&limit=<n>` 读通道：JWT（CHANGE_READ workspace 并集 + NULL 桶）/`shk_live_` 同规、`shpsync_` token 绑定单 workspace；按 `last_seen_at` 新→旧排序；workspace_id 参数须在读权限 scope 内（不在则空列表，不泄漏存在性）；limit 默认 20、上限 100。
- **FR-04** 会话详情「本地 Agent 日志」卡片：挂载 SessionPanelPage（消息流下方、团队任务块附近），数据 `GET /api/agent-logs?workspace_id=session.workspace_id`；按 last_seen_at 新→旧列出 harness 徽标 / session_id 短码（点击复制）/ originator 标签 / 大小（人性化 KB·MB）/ 活跃时间（相对）/ 调用次数 / 最近命令 / 日志路径（截断展示，点击复制）；默认展示 3 条可展开；workspace 为 null 的会话不渲染卡片；空态提示「agent 下次 sillyspec run 时自动上报」。
- **FR-05** 类型同步：后端 schema 变更后同变更内跑 `pnpm gen:types`，提交 `frontend/src/lib/api-types.ts` + `backend/openapi.json`。

## 非功能需求

- **NFR-01** 上报通道 best-effort 语义在服务端延续：请求合法性校验（Pydantic）失败 422 不影响 CLI（其自身静默降级）；服务端处理失败不影响其它端点。
- **NFR-02** Windows 路径兼容：`log_path` 按字符串原样存储（含反斜杠/盘符/正斜杠混合），不做分隔符归一（CLI 已归一化探测，原样保存是排障需要）。
- **NFR-03** UI 双主题（blue / ai-native）正常渲染，品牌色走 `brand-*` 语义阶。

## 验收标准

- pytest：鉴权矩阵（401/403×2/200）、幂等 upsert（同 body 二推一行）、批量 entries、跨 workspace 隔离（复合键维度）、422（缺 harness/log_path）、GET 排序与 scope 过滤。
- 前端：vitest 组件测试（渲染/空态/复制回调）+ tsc + lint 过；真实 CLI `sillyspec status` 上报命中 200（端到端实证）。
