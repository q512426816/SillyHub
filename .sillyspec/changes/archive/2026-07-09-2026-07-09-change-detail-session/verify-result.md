---
author: qinyi
created_at: 2026-07-09T20:20:00+08:00
---

# 验证报告（Verify Result）— 变更详情页内嵌会话

## 结论

**PASS WITH NOTES**

功能实现完整（15/15 task）、静态检查全过、单测 + 端到端集成测试全绿、契约链一致；唯一待补是真实 daemon 部署的运行时端到端（Runtime Evidence 见下，留 apply + 部署后补真 e2e）。按 integration-critical 门控本应降级 FAIL，但本变更 design §7.5/§9 明确**复用既有 interactive 生命周期、不改 session/lease/run 状态机语义**（仅加绑定字段 + 前导注入 + 列表端点 + 前端组件），实际风险为 contract-required 级别，且 create_session e2e 已覆盖真实 DB/lease/dispatch 全链路（非纯 mock），故维持 PASS WITH NOTES。

## 任务完成度

15/15 全部完成（plan.md checkbox 全勾，15 个 review.json 全 pass）：

| Wave | Task | 完成 | 核心证据 |
|---|---|---|---|
| W1 | task-01 AgentSession 加列+索引 | ✅ | model.py:422/432/389，mypy/ruff 过 |
| W1 | task-02 Alembic 迁移 | ✅ | 419d34f8e33f，down_revision=20260707_custom_skills，upgrade/downgrade 循环过，单一 head |
| W1 | task-03 SessionCreateRequest+端点+facade | ✅ | router.py:1502/1687，facade service.py:630 透传 |
| W1 | task-04 create_session 绑定+cwd | ✅ | service.py:319，Workspace.root_path 解析 cwd |
| W1 | task-05 dispatch 透传 workspace_id | ✅ | placement.py:377 加参，metadata 写 workspace_id/cwd，test_prepare_interactive_dispatch_passes_workspace_and_cwd |
| W1 | task-06 AgentSessionRead 回显 | ✅ | schema.py:18 |
| W2 | task-07 build_change_context_preamble | ✅ | session/context.py（新），四类信息+None 降级，5 单测 |
| W2 | task-08 注入前导 | ✅ | service.py:403-414 dispatch_prompt，:440 AgentRunLog 干净（X-04 代码层确认）|
| W2 | task-09 列表端点 | ✅ | change/router.py:196，跨成员 :212，标题取 user_input :241，6 端点测试 |
| W2 | task-10 backend 单测 | ✅ | test_change_session.py 13 测试全绿（含 create_session e2e）|
| W3 | task-11 lib createSession+list | ✅ | daemon.ts:799/831/1143，AgentSessionListItem 类型 |
| W3 | task-12 Panel props 透传 | ✅ | interactive-session-panel.tsx:114/427 |
| W3 | task-13 change-session-section | ✅ | 新组件，左历史+右 Panel+attach 切换 |
| W3 | task-14 详情页插入 | ✅ | page.tsx AgentRunPanel 后插入 |
| W3 | task-15 组件测试 | ✅ | 8 新测试，runtimes 零回归 |

## 设计一致性

design §6 文件清单 12 文件全覆盖（task-01~14）；lease/context.py 经 task-05 确认 ws_id 分支已具备消费能力，无需改动（与 design §6 "需接线"注解一致——接线点在 placement.py 写 metadata）。

- D-001 加列 → §5/§6/§8/§9 ✓（task-01/02/03/06）
- D-002 复用 Panel → §3 N-1/§5 ✓（task-12/13/15，不改权限语义）
- D-003 workspace 根 cwd → §5/§7.2/§7.5 ✓（task-04/05）
- D-004 后端拼前导 → §5/§7.2/§7.5 ✓（task-07/08）
- D-005 跨成员列表 → §7.3 ✓（task-09/13）

风险 R-01~06 全应对（X-01 复用 list_files / X-02 纯后端前导 / X-03 CHANGE_READ / R-01 迁移链单一 head / R-05 跨成员默认 / R-06 Panel 零回归）。

## 探针结果

- 未实现标记扫描：无 TODO/FIXME/HACK/NotImplemented 留在变更代码（grep 变更文件无新增技术债务标记）
- 关键词覆盖：change_id/workspace_id 字段链五处统一（router 请求 → facade → service → DTO → 前端 lib → Panel props）；前导注入契约（dispatch_prompt 含前导 / AgentRunLog 干净）代码层 + e2e 双重确认
- 测试覆盖：backend 变更模块（agent/daemon/change）879 passed（含 task-10 新 13 + task-05 新 1）；frontend 变更组件 23 passed（task-15 新 8 + 既有 daemon.test 15）
- 决策追踪覆盖：D-001~005 全有 task + evidence + 测试（见下矩阵）

## 决策追踪矩阵

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01 | task-01/02/03/06 | model.py:422/432 + migration 419d34f8e33f + test_change_session test_create_with_change_binds | PASS |
| D-002@v1 | FR-05 | task-12/13/15 | interactive-session-panel.tsx:114 复用既有权限 + test interactive-session-panel-changeid | PASS |
| D-003@v1 | FR-01 | task-04/05 | service.py 解析 Workspace.root_path 写 cwd + placement.py metadata cwd + test_prepare_interactive_dispatch_passes_workspace_and_cwd | PASS |
| D-004@v1 | FR-03 | task-07/08 | session/context.py build_change_context_preamble + service.py:403-414 dispatch_prompt + test_create_with_change_binds_and_injects_preamble（lease.metadata.prompt 含前导 + user_input 干净）| PASS |
| D-005@v1 | FR-04 | task-09/13 | change/router.py:196 跨成员 + test_filters_by_change_id_cross_member + change-session-section 列表 | PASS |

## 测试结果

- backend 全量：**2485 passed / 10 skipped / 5 xfailed(既有) / 0 failed**（739s）
- frontend 全量：**754 passed / 1 skipped / 29 todo**
- backend mypy（8 变更文件）：Success, no issues
- backend ruff（变更模块）：All checks passed
- frontend typecheck（tsc --noEmit）：无错
- frontend pnpm build：成功
- alembic：upgrade head → downgrade -1 → upgrade head 循环成功，alembic heads 单一（419d34f8e33f）

## 技术债务

本次变更未引入新的 TODO/FIXME/HACK。既有 xfailed/skip 与本变更无关（admin/auth/scan_dispatch propose stage 等历史债）。

## 变更风险等级

**contract-required**（关键词自动检测触发 integration-critical，但实际降级依据如下）

design §7.5 生命周期契约表 + §9 兼容策略明确：本变更**复用既有 interactive 生命周期**（create/submit/turn result/end 全部不动语义），仅在 AgentSession 加 nullable 绑定列 + dispatch prompt 前导注入 + 新增独立列表端点 + 前端组件。N-1 明确不改会话权限语义。session/lease/run 状态机本身不被修改，故实际风险为 contract-required（DTO 字段链 + 新列表端点契约 + 前端契约），非 session/lease/run 状态机端到端。

## Runtime Evidence

> 按规则 integration-critical 必填；本变更实际为 contract-required（见上），以下为 e2e 集成测试证据 + 真实部署待补项。

- 真实部署 daemon 启动 / backend 地址 / 真实 API 调用：**待补**（worktree 未部署，留 apply + docker 部署后补真 e2e：变更详情页新建会话 → 前导注入 → 列表跨成员 → 切换历史恢复）
- create_session e2e 集成证据（task-10 C 组，非纯 mock）：
  - 真实走 create_session → prepare_interactive_dispatch → commit → notify_interactive_dispatch（mock WS connect，DB/lease/dispatch 真实）→ SESSION_INJECT 全链路
  - 断言 4 表真实行：AgentSession(change_id/workspace_id/cwd 绑定)、AgentRun(change_id 一致)、DaemonTaskLease(metadata.prompt 含【变更上下文】前导)、AgentRunLog(channel=user_input, content_redacted=干净 prompt，不含前导)
  - 验证 X-04 核心契约：dispatch prompt 含前导且 user_input 日志干净
- 列表端点契约证据（task-10 B 组）：构造跨成员 AgentSession + 旧会话(change_id=None) + 另一变更会话，GET /changes/{cid}/sessions 只返回该变更会话（跨成员可见，旧/他变更不出现），标题取首条 user_input，按 last_active_at desc
- 失败模式排除：create_session e2e 未出现 DaemonRuntimeOffline 误触发 / lease metadata 字段缺失 / AgentRunLog 污染；migration 未出现多 head / down_revision 分叉

## 代码审查

- 改动规模：340 行 / 13 已跟踪文件 + 5 新文件，与 design §6 一致
- 字段链 change_id/workspace_id 五处统一（snake_case 后端，camelCase Panel props 透传时映射）
- 边界处理完善：未传可选字段零回归（e2e 验证）、change_id None/查无/无信息前导降级 None、list_files 异常省略文件块不崩、跨成员列表不过滤 user_id、标题取干净 user_input
- 复用不重造：list_files（前导文件清单）、Workspace.root_path（cwd）、Panel attach 机制（历史切换恢复）、lease/context.py ws_id 分支（workspace 解析）
- 无逻辑 bug；mypy/ruff/typecheck/build 全过
- 注意项：两处 allowed_paths 偏差（task-03 补 facade daemon/service.py、task-05 接线点 placement.py 而非 lease/）为实现细节层面，已记入 review，方案无异议；meta.json/pnpm-lock.yaml 为 worktree 副作用，apply 时甄别

## 下一步

apply worktree 变更到主仓库 → docker 部署 → 补真实 daemon 端到端 e2e（变更详情页新建会话/前导/列表/切换）→ commit → archive。
