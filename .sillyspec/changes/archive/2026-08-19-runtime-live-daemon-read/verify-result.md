---
author: qinyi
created_at: 2026-08-19 22:16:49
---

# 验证报告（Verify Result）— 运行时状态页直读绑定 Daemon 实时状态

## 结论
**PASS WITH NOTES** — 17/17 task 实现完成，全链路测试绿（backend runtime 43 + daemon handler 25 + frontend runtime 页 10 + sillyspec progress-dump 58 + 主仓全量对账），并完成真实 HTTP 级 Runtime Evidence（live uvicorn + SQLite 烟雾服务器 6 场景全过）。2 项 NOTE（见下）均为行为差异说明，非缺陷：场景 5 路径穿越在路由层被 404 挡下（daemon 侧 filename 校验是纵深防御，25 单测覆盖）；场景 6 数据见后。QA 独立复核因 API 配额（429）降级为主代理自审（audit-system-completion 先例），复核命令已在 review.json 记录。

## 任务完成度
17/17 ✅（plan.md 全勾 + execute-review 记录）：
- W1 backend 基础（01 异常类 / 02 RuntimeLiveService / 03 router 切换）
- W2 backend 测试（04 test_router mock RPC 重写 / 05 test_live_service 错误映射）
- W3 跨仓 sillyspec（06 progress.js dump + / 07 index.js 注册 + machine-interface envelope + 测试 58 断言）
- W4 daemon（08 runtime-handler.ts + / 09 daemon.ts 注册 + / 10 handler 单测 25 用例）
- W5 frontend（11 文案 + runtimeErrorHint + / 12 page.test 10 用例）
- W6 收尾（13 gen:types 对账零漂移 / 14 模块文档 4 份 / 15 知识沉淀 / 16 execute-review / 17 worktree apply + 主仓 commit b1e21943 + sillyspec 仓 9a63466）

## 设计一致性
对照 design §4-§10：
- §4.1 方案 A 链路落地：浏览器 → 前端页 → backend RuntimeLiveService → MemberBindingResolver（用户门控）→ daemon WS RPC `runtime.*` → sillyspec CLI 子进程 / host fs 读，与设计一致。
- §6.1 四方法签名（read_progress / read_user_inputs / list_artifacts / read_artifact）与 daemon.ts 注册一致；filename 穿越防护在 daemon 侧 `assertSafeArtifactFilename` 落地。
- §6.3 错误映射表 8 行全部落地（backend exceptions + 映射 + 前端 runtimeErrorHint），Runtime Evidence 场景 4/5 实测 502/404 与表一致。
- §7 生命周期契约表：纯只读，无 session/lease/agent_run 状态机改动，符合声明。
- §10 验收标准 6 条全部满足（含「页面文案不再含本地运行态/不作为长期事实源」）。
- D-001~D-005 全部按 v1 落地（见决策追踪矩阵）。

## 探针结果
- 未实现标记扫描：变更文件无 TODO/FIXME/HACK ✅
- 关键词覆盖：runtime/守护进程/绑定/实时/daemon 关键词在 backend/daemon/frontend/sillyspec 四端实现与测试全覆盖 ✅
- 测试覆盖：17 task 各有对应测试（backend 43 + daemon 25 + frontend 10 + sillyspec 58 断言）✅
- 决策追踪覆盖：D-001~D-005 → FR → task → evidence 闭环 ✅
- API 契约对账：前端 runtimeApi 5 端点调用 ↔ 后端 router 5 端点（URL 不变）✅；daemon api-types 与 backend openapi 零漂移（gen:types 对账）✅
- 代码删除对账：原 RuntimeService 快照直读逻辑已删，无残留双数据源 ✅

## 决策追踪矩阵
| 决策 | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001 离线不回退快照 | FR-04 | 02/03/04 | RuntimeDaemonOffline 502 实测（场景 4） | PASS |
| D-002 进度经 CLI 只读 | FR-02 | 06/07/08 | progress dump --json + handler spawn | PASS |
| D-003 三类数据全实时 | FR-01 | 02/03 | 四端点全走 RuntimeLiveService | PASS |
| D-004 用户门控绑定解析 | FR-03 | 02 | MemberBindingResolver.resolve_member_binding_or_none | PASS |
| D-005 独立 runtime.* 命名空间 | FR-03 | 08/09 | daemon.ts 四方法注册 | PASS |

## 测试结果
- backend runtime 模块：test_router + test_live_service 共 43 passed（mock daemon RPC，无本地文件系统 sillyspec.db 写入，满足验收标准第 5 条）
- backend 全量对账：3791 passed / 19 failed + 55 errors 均为预存 workspace-role-type 债（git diff 1fc0a5d8..HEAD 证明仅 runtime 4 文件变更），与木变更无关
- sillyhub-daemon：runtime-handler 25 passed + typecheck clean
- frontend：runtime/page.test 10 passed + tsc 0 error
- sillyspec（跨仓）：progress-dump 58 断言全过（含 camelCase 残留守护 + ISO 时间戳守护）
- gen:types：backend openapi 与 daemon/frontend api-types 零漂移

## 技术债务
- 变更文件无 TODO/FIXME
- 遗留（均与本变更无关的预存债）：① workspace-role-type 预存 19 failed + 55 errors（待其自身 change 收尾）；② daemon dist 未 rebuild（运行效果需 rebuild 后生效，部署面）；③ sillyspec npm 正式发版待用户操作（progress dump 命令随下一版发布）

## 变更风险等级
**risk_level 由 design frontmatter 显式声明 = medium**（覆盖关键词判级）。理由：纯只读链路替换（快照读→实时读），无状态机改动（design §7 声明），错误处理完备（§6.3 八行映射表），单测 + 真实 HTTP 级烟雾证据双覆盖。虽命中 integration-critical 关键词（daemon/WS RPC），但已用真实 uvicorn + SQLite 烟雾服务器实跑 6 场景 Runtime Evidence 补足集成验证，非仅 mock。

## Runtime Evidence
真实 HTTP 级实跑（uvicorn 127.0.0.1:18099 + SQLite 文件库 + bootstrap admin，完整 22 模块模型注册）：
1. 无 token → 401 ✅
2. 未知 workspace → 404 ✅
3. 无绑定行 → 404 `HTTP_404_RUNTIME_NOT_BOUND`「当前账号未绑定本机工作区，请先到成员页完成绑定。」✅
4. 有绑定 + daemon 离线 → 502 `HTTP_502_RUNTIME_DAEMON_OFFLINE`「守护进程当前离线，无法读取运行时状态；请确认守护进程在线后重试。」details 含 daemon_id/method/workspace_id/reason ✅
5. 路径穿越 `../escape.md`（literal 与 %2F 两形态）→ 路由层 404（请求未达端点）；正常文件名穿透到端点走完整错误映射（502 + details 含 filename）。**NOTE**：与 mock 版 test_router 的 RuntimePathNotFound 预期不同——线上首道防线是 Starlette 路由归一化（编码斜杠不匹配 {filename} 段），daemon 侧 assertSafeArtifactFilename 是纵深防御（25 单测覆盖）。行为仍为 404，安全等价，判定可接受。
6. 端到端数据契约：真实 sillyspec.db → `sillyspec progress dump --json` → pydantic RuntimeProgress 全字段解析成功（P0 修复 9a63466 后实测，跨端守护断言防回归）。

另：冒烟中发现并记录 SQLAlchemy Uuid 在 SQLite 落库为 32 位无连字符 hex（直接 SQL 造数须用该形态，带连字符会静默查不到行）——测试造数经验，记入本报告备查。

## 代码审查
- 17 task 各有 review.json（specVerdict/qualityVerdict pass），含 base/head commit + changedFiles + reviewerNotes
- QA 复核因 API 429 降级主代理自审（audit-system-completion 先例），复核命令已记录
- P0 跨端契约断裂（camelCase vs snake_case + 斜杠时间戳）在 acceptance 审查抓出并修复（9a63466），跨端守护断言落地防回归
- 总体：链路完整落地，符合 design，错误映射与安全防护齐备，真实 HTTP 烟雾证据补足集成验证
