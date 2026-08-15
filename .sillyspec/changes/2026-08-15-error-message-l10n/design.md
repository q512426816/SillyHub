---
author: qinyi
created_at: 2026-08-15T10:05:00+08:00
change: 2026-08-15-error-message-l10n
project: backend
status: draft
scale: large
risk_level: unit-sufficient
---

# Design — 后端面向用户报错文案中文化（范围 A：前端可达链路）

> author: qinyi
> created_at: 2026-08-15T10:05:00+08:00
>
> 生命周期契约：无/N/A（纯报错文案改写，不改任何状态机/事件/租约/心跳逻辑）。

## 1. 背景

前端 2026-06-25-frontend-error-handling 已确立错误展示契约：`lib/errors.ts` 的
`errMessage(err)` 直接透传后端 `AppError.message`（注释明言「后端 AppError.message
已是中文」是前提），任何路径不得把英文 code 拼给用户。但后端只有部分履约——
全仓统计 **462 处英文 raise message vs 61 处中文**。用户实际撞到的是
`daemon runtime '3f87ad1d-…' is offline; interactive session '…' could not start.`
这类 UUID+英文技术串（ql-20260815-005 已修 daemon 会话链路 5 处，本变更是其
系统化推广）。

**分层事实**（本次范围决策依据）：462 处并非全部面向浏览器用户——

| 层 | 消费方 | 英文是否合理 |
|---|---|---|
| daemon 内部 RPC（ws_hub/lease/run_sync/host_fs/patch/audit） | daemon 进程 | 合理，不动 |
| MCP 工具（mcp_gateway/tools.py） | AI agent | 合理，不动 |
| platform_sync 双鉴权 | SillySpec CLI | 合理，不动 |
| core 启动期校验（crypto/ssrf/config 启动段） | 运维/日志 | 合理，不动 |
| **router/service 用户动作链路** | **前端 errMessage 透传 → toast/inline** | **不合理，本次清理** |

## 2. 范围（用户已确认：A 只改前端可达链路）

约 45 文件、约 270 处英文 raise 文案。按模块分布（处数，Design Grill 修订版）：

- **auth 链路（Grill 增补）**：auth/service.py 6（User not found / Refresh token
  not recognised / account no longer active / token already used）、auth/router.py 1
  （API key not found or already revoked）、core/security.py AccessTokenError 4 条
  （经 auth_deps 透传为 message）、auth_deps 7
- **mcp_gateway/router.py 1（Grill 增补）**：McpTokenNotFound（mcp-tokens 管理 UI
  可达）；「不做」边界收窄为 mcp_gateway 的 **tools.py / server.py / sse.py**
  （MCP 工具与 SSE，AI 消费）
- agent（service 16 / router 8 / **profile/service.py 9——明示在范围内** /
  skills_bundle_service 3——skills「7 处」实为此文件与 skills/service 残余，
  skills/service.py 实测已中文）
- spec_workspace（service 16 / bootstrap 5+1 generate-projects 链路 / router 1）
- **daemon/router.py 用户面端点 15——机械判据（Grill 增补）**：以下路径为用户面：
  `/api/daemon/version`、`/instances*`、`/machines*`、`/runtimes*`（除
  `pending-leases`——daemon 轮询）、`/sessions*`（stream 端点的 404 分支文案）、
  `/skills/latest/manifest`、`/skills/{name}/content`；**整段排除**：所有
  `@router.websocket`（ws:2501 附近）与 llm-proxy 段（2204-2501 行，agent 子进程消费）
- llm_provider（usage_handlers 12 / service 11 / schema 2）
- workspace（service 12 / members 12 / schema 2 / link 3+1 / member_runtimes 1）
- admin（organizations 11 / roles 10 / users 6）
- release 11、change_writer（service 10 / proxy 4）
- git_gateway 10、ppm（task 8 / kanban 5 / problem 3 / plan 2 / project router 2）
- tool_gateway 8（settings 页策略管理可达）
- change（service 6 / dispatch 2 / router 2 / schema 1）
- incident 7、git_identity 5
- 其余零星：knowledge 2 / workflow 2+1（fsm TransitionError 经 workflow/router
  到前端）/ scan_docs 1 / task 1
- 全局兜底：main.py `Run not found` ×6、errors.py 类默认 message 4 处
  （RoleInUse / OrganizationInUse / OrganizationHasChildren / WorktreeAcquireFailed）
  + Request validation failed / Internal server error 两条 handler 兜底

**明确不做**：daemon 内部 RPC、MCP 工具与 SSE（tools.py/server.py/sse.py）、
platform_sync（CLI 消费；注意 `platform-sync-tokens` 签发端点目前前端无调用，
若未来加 UI 需重评）、core 启动期校验（crypto/ssrf/config 启动段）。

## 3. 决策/方案选择（brainstorm 阶段用户确认）

三方案对比后**选定方案一：原位改写**（用户确认）：

- 方案一【选定】各 raise 点英文直改中文，零结构变更，code/details/http_status
  不动，与前端 N1 决策（不做映射表防双源漂移）一致，daemon 模块
  ql-20260815-005 已验证零回归范式。
- 方案二【否决】集中文案表 code→中文映射全局兜底：code 全站复用
  （HTTP_404_NOT_FOUND 共用）无法区分场景，须先加专属 code=动 API 契约，
  且与 2026-06-25 前端设计 N1 决策冲突。
- 方案三【否决】i18n 框架（gettext/babel）：项目 UI 明确单语中文（CLAUDE.md
  规则 12），引入框架属过度设计。

范围决策：**A 只改前端可达链路**（用户确认），462→约 270 处，机器对机器
接口保持英文。

## 4. 文案规范（沿用 ql-20260815-005 已验证范式）

1. **中文短语 + 行动指引**：「执行代理当前不在线，会话无法启动。请确认本机
   daemon 进程已运行，重启后重试。」——前半句说发生了什么，后半句说怎么办。
2. **技术信息移 details**：UUID / 文件路径 / 上游错误串不进 message，放
   `details={...}`（排查信息不丢，前端不展示）。
3. **code / http_status / API 契约零变更**：前端零改动。
4. **HTTPException 形态（Grill 修订，删 dict 形态）**：全局 handler 对 dict
   detail 做 `str(exc.detail)`，dict 会变成 Python repr 垃圾（比英文更糟）——
   **HTTPException 仅允许纯中文字符串 detail**；需要携带 ID/技术信息的，
   改 raise 对应 AppError 子类并传 `details={...}`（AppError 通道原生支持
   details 且前端不展示）。users_service.py:336 的 dict detail 属预存缺陷，
   本次顺带修正为 AppError 形态。
5. 不做 code→文案映射表（方案二否决理由：code 全站复用无法区分场景，且与
   前端 N1 决策冲突）；不引入 i18n 框架（单语项目，过度设计）。

## 5. 测试与守护

1. 每模块 Wave 内：改前 `grep` 该模块 tests 是否断言旧英文文案。**grep 范围必须
   同时覆盖 `tests/` 和 `app/modules/*/tests/` 两侧**（Grill 修订：英文断言集中
   在模块内 tests）。最大波及面：git_gateway test_dangerous.py（45 处 match/
   in 断言）、test_service.py；tool_gateway、release、incident、ppm 各有若干。
   断言策略：断言英文 message 的测试改为断言异常类型 + 新中文子串。
2. 每 Wave 改完跑模块 pytest；全量收尾跑 backend 全量。
3. ppm 已上线模块：全量回归（`tests/modules/ppm` 496 基线）。
4. **守护测试（新增 1 个，Grill 加固版）**：`tests/core/test_error_message_l10n.py`
   - 范围推导用**目录推导 + 排除清单**（抗腐化）：`app/modules/*/[a-z_]*router*.py`
     与 `*_service.py` / `service.py`，减去明确排除文件（daemon 内部 RPC 子包、
     mcp_gateway tools/server/sse、platform_sync 全部、core 启动期文件）；
   - 断言清单内每个文件**存在**（防删除/改名后静默假绿）；
   - message 字面量断言从「不以 A-Za-z 开头」升级为**「含 CJK 字符」**
     （抓整句英文夹中文及符号开头英文）；
   - 明示只守卫字面量（f-string 动态串静态不可判，文档说明局限）；
   - 发现未登记新文件时（目录推导天然覆盖）自动纳入守护。

## 6. 风险与对策

- R1 语义漂移：批量改写可能改变错误含义 → 每处改写对照上下文理解后落笔，
  不做机械翻译；review 抽查每 Wave ≥20%。
- R2 测试断言英文 message 处漏改 → 改前全仓 grep 各模块断言；CI 全量兜底。
- R3 openapi.json / api-types.ts drift：message 不进 schema，理论上零影响；
  HTTPException detail dict 形态变化也不进 openapi（error response 未建模），
  无需 gen:types。
- R4 他者并行改动：按模块 Wave 提交，pathspec 隔离。

## 7. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/core/auth_deps.py | 报错文案中文化 |
| 修改 | backend/app/core/errors.py | 报错文案中文化 |
| 修改 | backend/app/core/security.py | 报错文案中文化 |
| 修改 | backend/app/main.py | 报错文案中文化 |
| 修改 | backend/app/modules/admin/organizations_service.py | 报错文案中文化 |
| 修改 | backend/app/modules/admin/roles_service.py | 报错文案中文化 |
| 修改 | backend/app/modules/admin/users_service.py | 报错文案中文化 |
| 修改 | backend/app/modules/agent/profile/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/agent/router.py | 报错文案中文化 |
| 修改 | backend/app/modules/agent/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/agent/skills_bundle_service.py | 报错文案中文化 |
| 修改 | backend/app/modules/auth/router.py | 报错文案中文化 |
| 修改 | backend/app/modules/auth/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/change/dispatch.py | 报错文案中文化 |
| 修改 | backend/app/modules/change/router.py | 报错文案中文化 |
| 修改 | backend/app/modules/change/schema.py | 报错文案中文化 |
| 修改 | backend/app/modules/change/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/change_writer/proxy.py | 报错文案中文化 |
| 修改 | backend/app/modules/change_writer/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/daemon/router.py | 报错文案中文化 |
| 修改 | backend/app/modules/git_gateway/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/git_gateway/tests/test_dangerous.py | 报错文案中文化 |
| 修改 | backend/app/modules/git_gateway/tests/test_service.py | 报错文案中文化 |
| 修改 | backend/app/modules/git_identity/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/incident/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/knowledge/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/llm_provider/schema.py | 报错文案中文化 |
| 修改 | backend/app/modules/llm_provider/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/llm_provider/usage_handlers.py | 报错文案中文化 |
| 修改 | backend/app/modules/mcp_gateway/router.py | 报错文案中文化 |
| 修改 | backend/app/modules/ppm/kanban/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/ppm/plan/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/ppm/problem/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/ppm/project/router.py | 报错文案中文化 |
| 修改 | backend/app/modules/ppm/task/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/release/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/scan_docs/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/spec_workspace/bootstrap.py | 报错文案中文化 |
| 修改 | backend/app/modules/spec_workspace/router.py | 报错文案中文化 |
| 修改 | backend/app/modules/spec_workspace/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/spec_workspace/tests/test_bootstrap_provider_model.py | 报错文案中文化 |
| 修改 | backend/app/modules/task/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/tool_gateway/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/workflow/fsm.py | 报错文案中文化 |
| 修改 | backend/app/modules/workflow/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/workspace/link_router.py | 报错文案中文化 |
| 修改 | backend/app/modules/workspace/link_service.py | 报错文案中文化 |
| 修改 | backend/app/modules/workspace/member_runtimes/service.py | 报错文案中文化 |
| 修改 | backend/app/modules/workspace/members_service.py | 报错文案中文化 |
| 修改 | backend/app/modules/workspace/schema.py | 报错文案中文化 |
| 修改 | backend/app/modules/workspace/service.py | 报错文案中文化 |
| 修改 | backend/tests/core/test_error_message_l10n.py | 报错文案中文化 |
| 修改 | backend/tests/modules/agent/test_work_dir_strategy.py | 报错文案中文化 |
| 修改 | backend/tests/modules/change/test_dispatch.py | 报错文案中文化 |
| 新增 | backend/tests/core/test_error_message_l10n.py | 守护测试 |
| 修改 | backend/app/modules/agent/coordinator.py | token/指纹文案（QA 发现用户可达） |
| 修改 | backend/app/modules/agent/profile/router.py | WorkspaceNotFound 文案（W1 守护发现漏登） |
| 修改 | backend/app/modules/agent/schema.py | validator 422 文案（QA 发现） |
| 修改 | backend/app/modules/agent/tests/test_start_init_dispatch.py | 断言同步 |
| 修改 | backend/app/modules/agent/tests/test_start_scan_dispatch_daemon_client.py | 断言同步 |
| 修改 | backend/app/modules/daemon/tests/test_skill_content_endpoint.py | 断言同步 |
| 修改 | backend/app/modules/git_gateway/tests/test_router.py | 断言同步（设计漏登，git_gateway 模块内） |
| 修改 | backend/app/modules/incident/tests/test_fsm.py | 断言同步 |
| 修改 | backend/app/modules/incident/tests/test_service.py | 断言同步 |
| 修改 | backend/app/modules/release/tests/test_service.py | 断言同步 |
| 修改 | backend/app/modules/tool_gateway/policy_router.py | 策略重名文案（QA 发现用户可达） |
| 修改 | backend/app/modules/tool_gateway/tests/test_service.py | 断言同步 |
| 修改 | backend/app/modules/workspace/members_router.py | members 链路英文实落 router 翻译层（范围修正） |
| 修改 | backend/app/modules/worktree/git_runner.py | 克隆失败文案（QA 发现经 503 直达前端） |
| 修改 | backend/app/modules/worktree/service.py | W1 守护发现漏登（9 处） |
| 修改 | backend/tests/modules/admin/test_users_router.py | 断言同步（xfail 转真断言） |
| 修改 | backend/tests/modules/agent/test_context_builder.py | 断言同步 |
| 修改 | backend/tests/modules/workspace/test_scan_generate.py | mock 同步 |

注：task-10 的模块文档同步（.sillyspec/docs/backend/modules/）不入清单（.sillyspec 路径按惯例跳过）。不改前端任何文件。

## 8. 自审（Self-Review）

- 范围完整性：经 Design Grill 独立审查（前端 API 路径反查双向核对），auth 链路与
  mcp-tokens 两处遗漏已增补；不做的模块（storage/platform_sync/MCP tools）逐项核实。
- 可行性：HTTPException 纯字符串中文 detail 与前端 ApiError 解析管线实测兼容；
  dict detail 形态经 Grill 证伪已删除，改为 AppError+details 迁移路径。
- 测试策略：英文断言波及面已实测点名（git_gateway test_dangerous 45 处最大），
  grep 范围双侧目录；守护测试抗腐化设计（目录推导+存在断言+CJK 断言）。
- 风险：批改语义漂移靠逐处对照上下文；message 不进 openapi 无 gen:types 负担。
- 结论：可进 plan。
