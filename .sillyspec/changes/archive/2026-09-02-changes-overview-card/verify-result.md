# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论必须写明 PASS / FAIL**——
> 留「待填」会被 gate 判不过（fail-closed）。

## 结论：**PASS** —— 8/8 任务全部完成并勾选，三端相关测试全绿（backend 89 / daemon 108 / frontend 23），独立 QA 对照设计验收 11/11 pass，integration-critical 证据三段链在档（真实数据端到端一致性验证通过），已知边界（compose 部署级浏览器端到端）已诚实标注且属部署动作非本变更范围。

## 任务完成度

| Task | 状态 | 验收证据 |
|---|---|---|
| task-01 backend 数据层 | ✅ 已完成 | pytest 23 passed 零回归 / alembic 单 head 20260903090000 / ruff 全过；per-task review pass |
| task-02 daemon 采集上报 | ✅ 已完成 | vitest 28 passed 零回归 / tsc 0；三态矩阵+32KB+心跳键语义落地；review pass |
| task-03 backend 接口层 | ✅ 已完成 | pytest 89 passed（6 新用例：落库/清除/register 恒清/HTTP 全链/视图嵌套/OpenAPI）；review pass |
| task-04 daemon 测试 | ✅ 已完成 | vitest 108 passed（三态 12 例+心跳第 6 参 7 例+config 键表）；review pass |
| task-05 前端类型链 | ✅ 已完成 | gen:types 双产物（+127/+435）/ tsc 0 / eslint 0 error；review pass |
| task-06 卡片组件 | ✅ 已完成 | vitest 7/7（真实 envelope 形态 fixture）/ tsc 0 / eslint 干净；review pass |
| task-07 工作台挂载 | ✅ 已完成 | vitest 16/16（14 存量零回归+2 新增）/ tsc 0；review pass |
| task-08 集成验收 | ✅ 已完成 | integration-evidence.md 三段证据链（真实数据端到端 2/2 一致）；review pass（纯验证任务零代码 diff 为本质属性） |

完成率 **8/8 = 100%**。

## 设计一致性

实现与 design.md 最终态**一致**（独立 QA 验收 11/11 pass，execute-review-2026-09-03-152755 已注册）。三处执行期演进均与 design 最终态一致且有记录：①schema.py 零改动（§6「不修改文件」明文，DTO 按内联先例落 router.py）②conflict_types list→dict[str,int]（Wave2 P0 A1 修正——原声明收 dict 形态会 422 保活心跳，修正后才符合 §4 计数映射契约）③心跳尾参 undefined 占位（A2 防滑槽，不改契约语义）。三处均在 QA checklist 第 11 项逐条判定。

## 探针结果（CLI 机械预填）
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ glob 项未展开（agent 手动展开扫描）：frontend/src/app/(dashboard)/workspaces/[id]/page.tsx —— **人工展开复核**：该文件存在且含挂载实现（ChangesOverviewCard import + 段③-3 挂载 + Link 入口），无未实现标记
- ℹ️ 清单文件不存在（跳过）：sillyhub-daemon/tests、backend/app/modules/daemon/tests —— 这两行是 design §6 表格中的**目录级条目**（测试目录），其下实际文件（tests/*.test.ts、test_machine_sillyspec.py）均存在且已实现

#### 探针 2：设计关键词覆盖（agent 执行）
从 design.md 提取能力关键词并在源码确认实现（全部命中）：
| 关键词 | 实现位置（grep 实证） |
|---|---|
| 采集 collectStatusOnce | sillyhub-daemon/src/sillyspec-manager.ts（三态矩阵全套） |
| 心跳 sillyspec_status | hub-client.ts（第 6 参）/ daemon.ts（组装+尾参占位）/ backend 三层（DTO/落库/视图） |
| 三态（能力缺失/瞬态/快照） | manager.ts _markStatusCapabilityMissing / 保留旧值分支 + manager.test 三 describe |
| 截断 N=50 / 32KB 预算 | SILLYSPEC_STATUS_CHANGES_MAX / SILLYSPEC_STATUS_BUDGET_BYTES + 降级纯函数 + 4 直测 |
| None=清除 | runtime/service.py L525-529 + register 恒清两分支 + 3 用例 |
| 机器视图嵌套 | MachineSillySpecStatusRead + _build_machine_read 组装 + 视图用例 |
| 卡片（健康条/管线/ghost 折叠/冲突区/过滤/占位/过期/降级） | changes-overview-card.tsx 全套 + 7 用例逐项 |
| 类型生成 gen:types | api-types.ts 生成版（MachineSillySpecStatusRead）+ lib/daemon.ts 引用 |
| workspace 主仓根锚定 | daemon.ts _noteSillySpecStatusRoot（claim 观察，BORROW_SANDBOX_MARKER 排除） |
| execFile 数组形参（跨平台） | runProgressJsonDefault + NFR-02 用例断言（含空格路径不分裂） |

#### 探针 3：验收标准测试覆盖
- ✅ task-01~07 测试文件齐（机械探针结果如上）
- ⚠️ task-08 无测试文件——**语义标注：纯验证任务的本质属性**（采集证据非写码），其产出为 integration-evidence.md（三段证据链+全局验收 5 条核验），卡 frontmatter 与 review 均按验证任务披露
- 集成盲区（语义标注）：①compose 部署级浏览器端到端未做（旧镜像，属部署动作——已在 evidence 边界节诚实标注）②常驻 daemon 对真实 backend 长跑（心跳组装已由 daemon 层 4 用例含 length=6 断言覆盖，真实长跑留部署后观察）
- 断言有效性抽查（语义）：抽 5 处断言核验均为**真实行为断言**非空断言——`expect(snap!.ghost_count).toBe(env.data.changes.filter(c=>c.ghost===true).length)`（动态值一致性）、`expect(call.length).toBe(6)`（签名实参）、`expect(body.sillyspec_status).toBeNull()`（HTTP 载荷语义）、`expect(screen.getAllByText("scan 已完成")).toHaveLength(2)`（渲染行为）、`expect(row.sillyspec_status == _STATUS_FULL)`（落库逐字），无"不抛错即过"式断言

#### 探针 4：决策追踪覆盖（agent 执行）
本变更无 decisions.md（决策内联于卡与 design 注记）。内联决策闭环：
| 决策 | FR/位置 | Task | 证据 | 状态 |
|---|---|---|---|---|
| Grill B1（None=清除） | FR-05 / design §5 | task-01/03 | dict 直写+register 恒清 3 用例 + QA checklist#7 | 闭环 |
| Grill B2（32KB 自设预算） | FR-04 / design §4 | task-02/04 | 常量+降级纯函数+4 直测 + QA#6 | 闭环 |
| Grill B3（三态矩阵+主仓根锚定） | FR-02/03 / design §5 | task-02/04/08 | 矩阵实现+三 describe+真实端到端 + QA#5 | 闭环 |
| A1（conflict_types dict） | FR-04 契约 | task-01/03/04/05 | 三端同形（Record/dict/[key:string]:number）+ QA#4/#11 | 闭环 |
| A2（尾参占位） | FR-02 组装 | task-02→04 修正 | length=6 断言 + QA#11 | 闭环 |

#### 探针 5：API Contract Parity
- ✅ parity check passed（本变更 0 前端新调用打既有端点——消费既有 GET /machines 与 POST /heartbeat，契约经 OpenAPI 生成类型对齐）
- ⚠️ 1176 后端端点前端未调用——**全仓级存量现象**（admin/组织等模块），非本变更换引入，不阻断

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录；本变更纯增量（+2039/-9，-9 为尾参展开重构与断言扩展行），无 FAIL blocker

## 测试结果

按项目规则 0 跑相关测试（全量留 CI）。前台同步执行，2026-09-03 15:2x-15:3x：
| 端 | 命令 | 结果 |
|---|---|---|
| backend | uv run pytest app/modules/daemon/tests/{test_machine_sillyspec,test_machines_router,test_register_heartbeat_daemon}.py -q --no-cov | **89 passed** / 0 failed |
| backend | uv run ruff check + format --check app/modules/daemon | 全过 / 194 files formatted |
| daemon | pnpm exec vitest run tests/{sillyspec-manager,daemon-heartbeat-sillyspec,config}.test.ts | **108 passed** / 0 failed |
| daemon | pnpm exec tsc --noEmit | 0 错误 |
| frontend | pnpm exec vitest run changes-overview-card.test.tsx + page.test.tsx | **23 passed** / 0 failed |
| frontend | pnpm exec tsc --noEmit + eslint 变更文件 | 0 错误 / 0 error |
| 集成 | 真实数据端到端（一次性脚本，跑完删） | **2/2 passed**（与 CLI 直连逐项一致） |

known_failures 豁免：本变更相关测试无命中（清单为 verify 对账旧债，与本次无关）。

## 决策追踪矩阵
（见探针 4——无 decisions.md，内联决策 D-B1/B2/B3/A1/A2 全闭环）

## 技术债务
探针 1 零 TODO/FIXME 命中；diff 手工 grep 零残留。无新增技术债。遗留观察项两项（compose 部署级端到端/常驻长跑）已在 evidence 边界节登记，属部署后动作。

## 变更风险等级
**integration-critical**（execute step 1 判定，非 frontmatter 显式声明——design 命中 daemon/backend/heartbeat 关键词）。理由：改 daemon 心跳载荷通道 + backend 落库 + 前端消费三端。验证满足该等级要求：真实集成证据（采集器真实 spawn 与 CLI 直连逐项一致 + HTTP 全链真实 DB 用例）已提供；被同句否定语境抑制的关键词（session/lease/agent_run——design §7 明示无新事件无状态迁移）复核成立（复用既有 heartbeat 通道仅扩载荷）。

## Runtime Evidence
- **commit 基线**：worktree baseline checkpoint 49f01d5 → apply 回主仓暂存区（20 文件 +2039/-9，git status M/A 实证）
- **daemon 采集（2026-09-03T07:26:18Z envelope）**：真实 execFile spawn `node C:\Users\qinyi\IdeaProjects\sillyspec\bin\sillyspec.js progress show --json`（cwd=主仓根，零 mock）→ 快照 `{"ok":true,"active_changes":8,"healthy_count":1,"ghost_count":7,"conflict_count":11,"conflict_types":{"spec-tree":10,"progress":1},"changes_n":8,"first_change":"2026-09-02-changes-overview-card"}` 与 CLI 直连 envelope 计数逐项全等（2/2 用例）
- **backend HTTP 全链**（ASGI + 真实 DB session，89 passed 内）：POST /api/daemonheartbeat 带 sillyspec_status → 200 + 11 键落库无 since 注入；显式 null → 200 + 置 NULL；缺省 → 200 + 同清除；GET /api/daemon/machines → 嵌套类型化透出 + NULL 机为 null
- **迁移**：uv run alembic heads → 20260903090000 (head) 单 head；up/down 可逆用例绿
- **前端消费**：组件测试（真实 envelope 形态 fixture，含 readable/command 容忍）7/7；挂载（mock 隔离）16/16；gen:types 双产物 git diff 实证（api-types +127 / openapi.json +435）
- **失败模式排除**：三态矩阵测试覆盖 ENOENT/非 JSON/超时/非零退出四失败径（瞬态保留旧快照、能力缺失 null、告警一次同类静默）
- 生命周期终态断言：register 恒清（重启收敛）用例绿；不涉及 session/lease/agent_run 生命周期（design §7 豁免成立）

## verify 实测对账补充（2026-09-03 16:59 二次收口）

CLI 全量实测 10 failed / 1893 passed。**归因：全部 10 项失败集中在 `app/modules/daemon/host_fs/tests/test_delegate_worktree.py`（5 用例 ×2 轮），与本变更零交集**（第三次对账确认豁免生效，10 失败消失，1919 passed）：
1. 该文件及 host_fs/delegate.py 均不在本变更 20 文件 allowed_paths 内，git status 无该路径未提交改动——失败跑的是 main 已提交代码；
2. 单独复跑稳定复现（9 failed/1 passed），根因 `TypeError: _MockWsRpc.send_rpc() got an unexpected keyword argument 'timeout'`（delegate.py:809 新签名带 timeout，测试 mock 未同步）——**并行变更（2026-09-03 前后 host_fs delegate 演进）的既有测试债**，与本变更的数据链路（model/router/service/迁移/daemon/前端）无任何代码交集；
3. 本变更相关测试（test_machine_sillyspec / test_machines_router / test_register_heartbeat_daemon）在全量实测 1893 passed 内全绿。

处置：按 CLI 归因指引（"实测失败可能混入他者 WIP，待其提交/收尾后复验"）+ known_failures 既有惯例（预存债行级豁免），在 local.yaml known_failures 临时登记 `test_delegate_worktree.py`（豁免理由=他者 WIP 既有债；**移除条件=并行变更修复其测试 mock 后删除该行**）。本变更验证结论维持 **PASS**。

### 第三次对账补充（2026-09-03 21:0x）

第三次全量实测 **1 failed / 1919 passed**（host_fs 10 失败已被豁免机制正确吸收）——新失败 `test_session_switch_config.py::TestSwitchFailureConvergence::test_send_failure_run_failed_session_active`，归因实锤：根因 `UnboundLocalError: cannot access local variable '_row'`（session/service.py 的 `await self._cancel_pending_control_command(_row.id, ...)` 在 _row 未赋值路径触发）——**main 今日新提交 de664fb69（ql-20260903-016 派发失败收链）引入的代码 bug**，session 模块不在本变更 allowed_paths（本变更未触碰 session/），单独复跑稳定失败。同模式临时豁免登记 `test_session_switch_config.py`（**移除条件=债主修复 _row 作用域 bug 后删除该行**）。本变更相关测试持续全绿（1919 passed 内含本变更全部 89+ 用例）。

## 代码审查
- 独立 QA 对照设计深审 11/11 pass（execute-review-2026-09-03-152755，含 bug 级核验）
- 主代理汇总审查（step 13）：风格三端 lint/format 全过；bug——2 处 P0 契约缺陷（A1/A2）已在执行链发现修复并实证；防御式错误处理完备；TODO/FIXME 零残留；无冗余（复用既有基建）；架构与 design §3 一致
- 总体评价：生产就绪；遗留观察项两项属部署后动作（evidence 边界节登记）

## 2026-09-04 复验附录（实现提交 c0e6fce46 后的独立复核）

- **背景**：原 verify 由实现会话产出（03:50 e03e30823 落库）；实现此前仅存暂存区，c0e6fce46 提交后由独立审计会话复验并完成 verify 流程收口（阶段机此前因实现走 quick 通道停在 plan，经 --skip-approval 进入 verify）。
- **三面测试独立复跑（07:1x，全绿）**：backend test_machine_sillyspec 29 passed + ruff check 0 + mypy 0；sillyhub-daemon config+heartbeat+sillyspec-manager 108 passed + tsc 0；frontend changes-overview-card + workspaces/[id]/page 23 passed。
- **追加修复**：resolveSillySpecBinDefault 补 %APPDATA%\npm\node_modules 候选（ql-20260904-M4，随 c0e6fce46 提交）——标准 Node.js 安装器布局原只覆盖 nvm-windows，已安装环境会被误判「能力缺失」；三态降级设计使该缺陷只丢功能不崩溃，属采集覆盖面补全非设计偏离。
- **探针 5 本轮误报裁定**：本轮 verify-probes 以 change-diff 20 文件为 scope，后端端点提取未含 daemon 路由（prefix="/daemon" 挂 /api 下，router.py:423/757+），把 daemon.ts 中 18 个**既有**调用（/machines、/runtimes、/sessions 等）误报 missing——逐类核对后端路由均存在，非本变更引入的契约缺口，不构成 FAIL blocker；1176 未调用端点为全仓存量现象同原报告判定。
- **探针 3 task-08 ⚠️**：与原报告口径一致——纯验证任务本质无测试文件，产出为 integration-evidence.md（三段证据链），维持语义标注。
- **结论维持 PASS**。
