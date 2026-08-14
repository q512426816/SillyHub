---
author: qinyi
created_at: 2026-08-14 21:18:23
---

# 验证报告（Verify Result）

## 结论

PASS WITH NOTES

## 任务完成度

12/12 全部完成（三重核验：verify step3 主仓符号实测 + step4 测试断言抽查 + execute acceptance QA 独立复跑后端 116/前端 38 passed）。

| 任务 | 核验证据 | 状态 |
|---|---|---|
| task-01 daemon change_dirs 标注 | extractChangeDirs（spec-sync.ts）+ postSpecSyncIncremental body 传 change_dirs；daemon typecheck + 相关测试过 | ✅ |
| task-02 命门全链 | 02a change_dirs 接收+_compute_reparse_scope 三路兜底；02b scoped 零删除守卫（`if scope is None` 包 delete 循环）；02c ChangeSessionLink+migration（alembic upgrade/downgrade 循环实测）+§8 SQL 语义绑定；独立测试 22+9 用例 | ✅ |
| task-03 审批不派发+投影收敛 | review 四方法改 transition/_record_stage_rework + _upsert_projection_progress；299 passed 含 13 新测试 | ✅ |
| task-04 服务身份注入 | inject_session_as_service（绕归属校验）+ notify_session 透传 + 三类降级；16 测试（服务层13+router层3） | ✅ |
| task-05 MCP 契约同步 | submit_stage_review docstring/agent_dispatch 恒空/notify 透传；107 passed | ✅ |
| task-06 include_ended | agent-sessions 扩展（缺省不回归）+ listWorkspaceAgentSessions；513 passed 含 11 新 | ✅ |
| task-07 删 change_writer 端点 | 五端点删（router 空壳）+ 测试清理；22 passed | ✅ |
| task-08 会话页 | sessions 页 + WorkspaceSessionSection（不绑 change）+ tabs；1422 vitest | ✅ |
| task-09 去表单 | 删按钮/CTA/create-change 页 + 空态引导会话 + lib 清理；1422 vitest | ✅ |
| task-10 详情页退化+审批卡 | 删全部执行控制（quick 分支只读）+ 三类降级 UI + notify 透传；1425 vitest 含 20 新 | ✅ |
| task-11 gen:types 收口 | api-types.ts 含 5 新字段（change_dirs/notify_session×4/notified_session/notify_error/include_ended）；gen:types:check 幂等；后端 1023 + 前端 1425 全绿 | ✅ |
| task-12 文档+基线 | 7 份模块文档 + _module-map 登记；spec-sync-visibility 基线零回退核对 | ✅ |

## 设计一致性

- design §2 目标全部达成（acceptance QA 逐条核验 FR-01~06 全 pass，4 红线全 PASS）。
- 4 条验收红线：scoped 零删除（代码守卫+测试：范围外/范围内消失均不删）/ 变更自动出现（daemon→hub-client→schema→apply_ops→scoped reparse→ux_changes 全链闭合）/ 详情页零执行控制（handler+UI 全删，quick 只读）/ 注入三类降级不回滚审批（best-effort 全捕获+测试含打回降级仍落 rework）。
- 生命周期契约表 8 事件全部有实现落点。

## 探针结果

- 未实现标记扫描：变更文件 0 命中（TODO/FIXME/HACK/XXX 无）。
- 关键词覆盖：change_dirs(7文件)/scoped(55)/include_ended(7)/notify_session(13)/notified_session(12)/inject_session_as_service(3)/会话组件(1)/reparse(48)——全覆盖。
- 测试覆盖（含断言有效性抽查）：6 新测试文件在；抽查 scoped 零删除（断言真实副作用：B 磁盘消失行保留/A 消失行保留）与注入降级（打回+降级仍落 rework）均为行为断言非空断言。
- 决策追踪覆盖：D-001~D-007 在 plan 覆盖矩阵 26 处引用全闭环（见下矩阵）。
- API 契约对账：openapi.json 与 api-types.ts 由 gen:types 同步生成（gen:types:check 幂等过）；审批四端点请求/响应字段（notify_session/notified_session/notify_error）与 design §7 一致。
- 代码删除对账：4 个删除文件（create-change 页+测试、change_writer 两测试）均在 design §6 清单或 execute 落地补充清单内声明；无未声明删除。`.claude/CLAUDE.md` 的 M 是并行会话改动非本 change（apply 未触碰，git status 可辨）。

## 决策追踪矩阵

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-04a/b | task-07, task-09 | change_writer 端点删 + create-change 页删 + 空态引导 | PASS |
| D-002@v1 | FR-03a/b/c | task-06, task-08 | sessions 页 + WorkspaceSessionSection + include_ended | PASS |
| D-003@v1 | FR-05a/b | task-10 | 执行控制全删 + 只读区保留 + 审批卡 | PASS |
| D-004@v1 | FR-05c/f | task-03, task-05 | 审批不派发 + 投影收敛 + MCP 契约同步 | PASS |
| D-005@v1 | FR-01a-d | task-01, task-02 | change_dirs 标注 + 增量触发 + scoped 零删除 + 双兜底 | PASS |
| D-006@v2 | FR-05d/e | task-04, task-10 | 服务身份注入 + 三类降级 + router 接线 | PASS |
| D-007@v1 | FR-02 | task-02 | ChangeSessionLink + §8 SQL 绑定 + 失败不阻断 | PASS |

## 测试结果

- **CLI 统一对账实测（2026-08-14 21:30 verify-run 20260814133015）**：frontend 1425 passed / backend daemon 810 + agent 511 + change 299 + change_writer 22 + mcp_gateway 107 全绿；sillyhub-daemon 1 失败 → 已修复（见下）。修复后 daemon 定向复跑 10 passed。
- **sillyhub-daemon 失败修复记录（3 处同类预存断言漂移，一次性全修）**：`test_pull_before_push.test.ts:84`、`test_init_lease.test.ts:110`、`spec-sync.test.ts:106` 三处断言写死 2 参 `toHaveBeenCalledWith(wsId, expect.any(Buffer))`，而生产调用 `client.postSpecSync(wsId, tarBuf, changeWriteId)` 三参形态在 HEAD 已存在（spec-sync.ts:530/552，此前 change 引入 changeWriteId 时测试未跟上；本 change diff 未触及该调用点，task-01 子代理 stash 基线对比 + HEAD 版核对双重确认为预存断言漂移）。修法：断言补第三参 `undefined` 对齐生产签名——不掩盖任何逻辑错误，仅消除参数个数严格匹配的假失败。修复后本地预跑 CLI 同款 daemon 两批命令全绿（135 文件 2267 passed + 串行 3 文件 33 passed）。
- 后端 pytest 重点模块（change/spec_workspace/agent/mcp_gateway/change_writer）：1023 passed, 3 skipped（execute 阶段 worktree 全量）；主仓 apply 后冒烟：test_reparse_scoped_zero_delete + test_approval_notify_session → 23 passed。
- 前端 vitest 全量：1425 passed / 144 files；主仓 apply 后冒烟 32 passed（node_modules 半坏经 pnpm install --force 修复后）。
- lint/typecheck：ruff format/check + mypy 全过；tsc 0 错误；eslint 0 error。

## 变更风险等级

本变更涉及 daemon↔backend 跨进程契约（change_dirs 标注）与 session 注入状态机 → 关键词判级 integration-critical，**未做 frontmatter 豁免声明**（如实按 integration-critical 对待）。

## Runtime Evidence（集成证据）

集成级证据 = 真实端到端 HTTP 测试（非纯 mock 单测）：

1. **增量同步→变更自动出现端到端**：`test_incremental_reparse_trigger.py` 的端到端用例走真实 sync-incremental HTTP 端点（TestClient）→ apply_ops 落盘 → 事务外触发 scoped reparse → 断言 ux_changes 行出现/更新/零删除（含 change_dirs 标注路径与前缀兜底路径双验证、归档路径走全量）。
2. **审批→注入端到端**：`test_approval_notify_session.py` router 层用例走真实审批 HTTP 端点 → service 落库+投影收敛 → 服务身份注入（mock inject_session_as_service 边界处，HTTP/service/DB 链路真实）→ 断言响应 notified_session/notify_error 透传与审批不回滚。
3. **迁移**：alembic upgrade head → downgrade -1 → upgrade head 本地 Postgres 实测循环通过（change_session_links 表/索引就位）。

**NOTES（如实披露）**：真实 daemon 进程 ↔ backend 的 live 集成（起 daemon 发真增量同步）未在本 verify 执行——daemon 侧改动（spec-sync.ts/hub-client.ts）由 daemon 单测+typecheck 覆盖，端到端 HTTP 测试已覆盖 backend 接收侧全链；live 联调建议在部署后以真实会话冒烟（用户在会话页发起对话→agent 建变更→平台列表自动出现）。

## module-impact.md 核对

实际 git diff 文件与影响矩阵一致：change/spec_workspace/agent/mcp_gateway/change_writer/daemon-session/backend migrations/frontend/文档全覆盖；补充清单（router 接线/测试文件）在 design §6 execute 落地补充段。无漏标/误标。

## 遗留与风险（NOTES）

1. **P2**：详情页绑定会话展示为前端近似（sessions?.[0] 最近活跃），非权威 change_session_links 最新 link（注入走后端权威表正确，仅展示近似；前端无只读端点，后续可加）。
2. **P2**：详情页侧栏保留历史「会话调试」卡（ChangeSessionsCard，源自 change-detail-layout-rework，非本 change 范围，未删）。
3. **P2**：change_writer proxy.py/service.py 建行死代码保留（跨文件复用 DaemonClientNoActiveSession + e2e 引用，建议后续独立 cleanup 任务）。
4. daemon↔backend live 进程级联调未实测（见 Runtime Evidence NOTES，建议部署后真实会话冒烟）。
