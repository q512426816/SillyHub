---
author: qinyi
created_at: 2026-08-28 05:11:35
---

# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；半语义探针与结论由主代理于 2026-08-28 05:11 填写。
> 验证基线：主仓 apply 提交 505bcff1（execute 13 task worktree 全量 + 主仓新基线 gen:types 零差异）。

## 结论：PASS WITH NOTES（按门控规则记为需集成证据的 PASS——Runtime Evidence 已提供且真实；notes 为 4 项非阻断预存债登记）

理由：13/13 任务全勾且逐 task review 双 pass；验收审查（独立 QA）pass/pass 且两项 gap 已收口（8719e006）；主仓合并态三端测试全绿（后端 2506 / 前端 64+tsc 零错 / daemon 写守卫 7）；真实 app 装配探针五端点+schema+工具集断言通过。notes：frontend 全量存 4 个并行变更（ctx-tokens）预存测试债，非本变更所致（git 取证归因，见任务完成度节）。

## 任务完成度

| task | 状态 | 证据 |
|---|---|---|
| task-01 数据层 | ✅ | 14 单测 + alembic 单 head 20260828120000 + 迁移含存量/跳过计数（53f045e1） |
| task-02 授权查询 | ✅ | 26 鉴权矩阵用例 + provides 契约四 NamedTuple（fa42ea24）+ D-013 权限过滤收口（8719e006） |
| task-03 钉定授权 | ✅ | 24 session_config 用例（含未授权 404/停用失效/owner-only 回归）（fdff6c43） |
| task-04 共享智能体 API | ✅ | 19 用例（五重校验/active/非 admin 403）（45848cdf）+ endpoints.json |
| task-05 platform 分支 | ✅ | TestPlatformProfileBranch 5 用例 + tool_config 枚举 5 用例（b8ff09cf） |
| task-06 借用切 grants | ✅ | 153+1148+254 全绿 + 双写一致性单测 + 8→9 字段断言修复（28084870） |
| task-07 shared_to_me 装配 | ✅ | 96 用例 + 路由挂载冒烟（ad065374）+ endpoints.json |
| task-08 gen:types | ✅ | 五端点+shared_to_me 可选+grant_id 入类型，tsc 零错，gen:types:check 过（9bb5993f） |
| task-09 守护进程页 | ✅ | 44 用例 + FR-03 无修改按钮断言 + admin-only 双向（09f04d1f） |
| task-10 选择器徽标 | ✅ | 42 用例 + 回退链逐字节零改动断言（6f1455ce） |
| task-11 回归确认 | ✅ | regression-report.md：daemon 2901+33 fragile/backend 2827/frontend 2729（4 预存债归因）+ 验收 gap 收口提交 8719e006 |
| task-12 daemon overlay 写守卫 | ✅ | 7 新用例（三态/交集/fail-closed/Bash 提取器组合）+ daemon 回归 2901（69ada543，D-011） |
| task-13 runtime 明细契约 | ✅ | SharedMachineView.runtimes + 会话锁在线 runtime_id + 149 用例（9a5dcde0）+ page 测试适配 |

完成率 13/13 = 100%。预存债（非本变更，git 取证：`git log ab368432..HEAD -- <file>` 为空 + `merge-base --is-ancestor 604c32fa ab368432` 成立）：frontend session-panel-variant:354（streamSession 三参，ql-20260827-018）、ux-fixes:255 与 dialog-attachments:281/287（输入栏重构 ql-20260827-020 同族）——建议另开 quick 收口。

## 设计一致性

实现与 design.md 一致，四处显式偏差均有决策依据：
1. §5 Phase 3 read_only→writable_dir（D-002@v2 用户实答，brainstorm 期修订）；
2. §7 GrantAuthorization.kind 仅 workspace_grant 两态 + platform 直传钉定 404（D-012 验收收口，原 design「platform 放行」括注已同步修订）；
3. sillyhub-daemon 非零改动：仅 session-manager.ts 一处写守卫增量 + 新测试（D-011 裁决收窄 Non-Goal，design §3 已同步）；
4. §6 文件清单在实现期补登 4 文件（migrations/env.py、session-config-bar.tsx、use-daemon-machines.ts、execution.py）——均随 plan/验收审查同步落 design。
生命周期契约表 7 事件逐项有实现+测试（验收审查 7/7 pass）。

## 探针结果（CLI 机械预填）

#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 清单文件不存在（跳过）：backend/app/modules/daemon/grants/tests、backend/migrations/versions/<rev>_create_daemon_runtime_grants.py（前者为目录级路径实际存在测试文件；后者为占位文件名，实际 20260828120000_create_daemon_runtime_grants.py 已核存在）

#### 探针 2：设计关键词覆盖（主代理执行）
从 design 提取能力关键词逐个 grep（backend/frontend/daemon 源码）：daemon_runtime_grants ✅（grants/model.py 等 26 文件命中）、authorize_pinned_runtime ✅（queries.py 定义 + session/placement 两消费）、list_machines_shared_to_me ✅、resolve_granted_daemon_for_borrow ✅、writable_dir ✅（grants/service 校验 + lease 注入 + 前端表单）、shared_to_me ✅（schema/router/use-daemon-machines/shared-machines-section）、shared-agents ✅（router 五端点 + 前端 daemon.ts 封装 + 管理卡）、grant_id ✅（审计列 + SharedDaemonView + placement INSERT）、NULLS NOT DISTINCT ✅（迁移 DDL + 测试）、pinned_skip_owner_check ✅、platform_shared_tool_config ✅、effective_allowed_roots ✅（lease metadata + context 透传 + daemon 消费）、「平台共享」徽标 ✅（session-panel data-testid）。无未命中关键词。

#### 探针 3：验收标准测试覆盖
（CLI 预填 11 条 ✅ 保留如上）task-12/task-13 的 ⚠️ 补充：两卡在 execute 中期创建，CLI 探针读卡时序错过——人工核验：task-12 测试 = sillyhub-daemon/tests/interactive/session-manager-write-guard.test.ts（7 用例，主仓已 apply 并复跑通过）；task-13 测试 = test_grants_authorization（runtimes 断言）+ test_machines_router（三态）+ shared-machines-section.test（禁用态），均已 apply 复跑。
- 集成盲区标注：①claim payload→daemon 消费链（backend 断言 snake/camel 双键 + daemon 单测读 state.effectiveAllowedRoots，两端各自真实、桥接处由 daemon.ts:4510 透传代码 + daemon typecheck 保证——未做跨进程联测，属本变更最大盲区，已列入 Runtime Evidence 之 E2E 待办）；②移动端 useDaemonMachines 消费（symbol-impact 登记：optional 字段零破坏，未逐页回归）。

#### 探针 4：决策追踪覆盖（主代理执行）
D-001@v1→FR-01/02/03→task-03/06/07 ✅；D-002@v2→FR-04→task-04/05/12（writable_dir 创建校验+注入+交集收紧三层证据）✅；D-003@v1→task-04（非自己 runtime 403 用例）✅；D-004@v2→task-10（回退链零改动断言）✅；D-005@v1 单变更交付 ✅；D-006@v1 全链 ✅；D-007@v1→task-05（检测前置+不写审计）✅；D-008@v1→task-01（NULLS NOT DISTINCT+跳过计数单测）✅；D-009@v1→task-05（枚举断言双文件）✅；D-010@v1→task-05/12（管理员普通会话零污染断言）✅；D-011@v1→task-12（daemon 单文件边界验收审查核实）✅；D-012@v1/D-013@v1→8719e006（404 翻转用例+borrow 过滤用例）✅。闭环无缺口。

#### 探针 5：API Contract Parity
- ✅ API parity check passed（CLI 预填保留）；⚠️ 2136 端点未调用为全平台历史横截面（admin 系等），非本变更范围。

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除。design 无删除声明，一致。

## 测试结果

| 套件 | 命令 | 结果 |
|---|---|---|
| backend daemon+agent 模块（主仓合并态） | uv run pytest app/modules/daemon app/modules/agent -q --no-cov -n auto | 2506 passed |
| backend workspace（worktree 终态） | uv run pytest app/modules/workspace tests/modules/workspace -q --no-cov -n auto | 254 passed, 1 skipped（预存环境跳过） |
| backend grants 收口（主仓） | 随 daemon 模块全量覆盖 | 含 149 收口用例 |
| daemon 全量 + fragile 三件独跑（worktree） | vitest run（排除三件）+ maxForks=1 独跑 | 2901 passed/9 skipped + 33 passed |
| daemon 主仓写守卫 | vitest run tests/interactive/session-manager-write-guard.test.ts | 7 passed |
| frontend 关键 6 文件（主仓） | pnpm test <6 files> | 64 passed；tsc --noEmit 零错 |
| frontend 全量（worktree，task-11） | pnpm test | 2729/2733，4 失败=并行预存债（归因见上） |
| lint | ruff（收口提交 hook 过）+ daemon typecheck 零错 + tsc 零错 | 通过 |

known_failures 豁免：本变更自身零失败零豁免；两类预存债登记豁免——①frontend 4 例（并行 ql-20260827-018/020 同族，既有清单覆盖）；②auth test_login_captcha 2-3 例（CLI verify 实测发现，第三次运行为禁用开关用例——环境敏感的 captcha 债同族，归因实证：592e0435 [ql-20260827-006 滑块验证码特性] 自身缺陷——captcha token 清理断言与 423/401 锁定语义，与本变更 51 文件（无任何 auth 路径文件）零交集，失败语义纯 captcha 域；local.yaml C 段登记，归属变更收尾修复）。建议均独立 quick。

## 决策追踪矩阵

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01/02/03 | 03/06/07 | 404 语义/owner-only 回归用例 | 闭环 |
| D-002@v2 | FR-04 | 04/05/12 | writable_dir 三层（校验/注入/交集收紧） | 闭环 |
| D-003@v1 | FR-04 | 04 | 非自己 runtime 403 用例 | 闭环 |
| D-004@v2 | FR-05 | 10 | 回退链零改动断言 | 闭环 |
| D-005@v1 | 组织 | 全部 | 单变更 8 Wave | 闭环 |
| D-006@v1 | 全部 | 01-07/13 | grants 全链单测 | 闭环 |
| D-007@v1 | FR-04 | 05 | 前置检测+零审计用例 | 闭环 |
| D-008@v1 | FR-01/04 | 01 | NULLS NOT DISTINCT/跳过计数 | 闭环 |
| D-009@v1 | FR-04 | 05 | 枚举断言（backend+daemon 双端） | 闭环 |
| D-010@v1 | FR-04 | 05/12 | 管理员普通会话零污染 | 闭环 |
| D-011@v1 | FR-04 | 12 | daemon 交集收紧 7 用例 | 闭环 |
| D-012@v1 | FR-04 | 收口 | 直传 404 翻转用例 | 闭环 |
| D-013@v1 | FR-01 | 收口 | borrow 权限过滤用例 | 闭环 |

## 技术债务

- 本变更新增 TODO/FIXME：0（探针 1）。
- 登记债（非阻断）：①daemon/service.py 门面两方法返回注解滞后（运行时正确，task-07 报告登记）；②frontend 4 预存测试债（并行变更，建议 quick）；③docs 漂移三处（design §11 表缺 D-009~011 行仅有尾注、R-09 尾注口径——归档时顺手）；④真实跨进程 E2E（daemon 进程 + writable_dir 实写）待用户环境执行（regression-report.md 已列操作步骤）。

## 变更风险等级

integration-critical（design 命中 daemon/session/lease/claim 关键词，且实际触碰 daemon 写守卫与会话创建链）。未显式覆盖（本变更确属集成敏感，判级准确）。集成证据见下节。

## Runtime Evidence

- **真实启动一次入口（app 装配）**：`cd backend && uv run python -c "from app.main import app"`（2026-08-28 05:0x 执行，进程内真实装配）——五条 shared-agents 路由 live（GET/POST /api/daemon/shared-agents、GET /active、PATCH/DELETE /{grant_id}）；DaemonMachineListResponse.json_schema 实测 shared_to_me 非必填；SharedMachineView.model_validate 含 runtimes 通过；platform_shared_tool_config() 实测 allowed_tools 恰为七工具（无 Bash/NotebookEdit，mode=acceptEdits）；grants 模型+三授权查询真实 app 上下文可导入。
- **迁移链**：alembic heads 单 head 20260828120000（task-01/13 执行记录）；迁移 replay 测试（SQLite）4 用例含存量迁移/跳过计数/downgrade 对称。
- **daemon 运行时组件**：vitest 真实加载 session-manager 模块——写守卫 overlay 三态/fail-closed/Bash 提取器组合 7 用例通过（worktree 69ada543 与主仓 apply 后双跑）；daemon typecheck 零错；全量 2901+33 fragile 通过。
- **会话生命周期终态断言**：test_session_create_config.py 真实断言 platform 会话 lease/claim payload 含 tool_config+effective_allowed_roots（snake/camel 双键）与普通会话零污染；daemon_borrow_audit 行含 grant_id（task-03/06 用例）。
- **失败模式排除**：未授权钉定 404（4 用例）/停用 grant 失效/直传 platform runtime 404（D-012）/无 borrow 权限不可见（D-013）/Bash 在 gate 拒绝（daemon 单测）。
- **不涉及**：docker up / node server 独立进程启动（本变更不改部署形态；跨进程 E2E 清单留用户，见 regression-report.md）。

## 代码审查

- execute 阶段：12 份 task review（含 2 份独立审查）+ 验收审查（独立 QA 24 项：22 pass+2 gap 已收口）全 pass。
- 问题清单：非阻断 3 条已收口（D-012/D-013/文档漂移）；预存债 4 条移交独立 quick。
- 总体评价：实现紧贴 design，越权改动均披露并追认（page.tsx 锁定 handler/execution.py 注释），跨任务契约（GrantAuthorization/_grant_id 键/effective_allowed_roots 链）经三端测试闭合。
