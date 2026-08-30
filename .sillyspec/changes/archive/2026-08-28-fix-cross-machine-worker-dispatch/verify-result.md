# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论必须写明 PASS / FAIL**——
> 留「待填」会被 gate 判不过（fail-closed）。

## 结论：PASS —— 7/7 任务完成、三道防线全部落码且经决策→任务→测试证据闭环、四类测试闸门全绿（backend 相关子集 145、daemon 2954、ruff、typecheck），integration-critical 所需真实集成证据齐备（backend 运行时探针 + daemon 认领链路集成测试，见 Runtime Evidence）。

## 任务完成度
- task-01 ✅：queries.py 双解析 5 处统一全序 ORDER BY（实例心跳 DESC NULLS LAST, daemon_id ASC）+ 路由 inner join + stale 丢弃注释；member_runtimes 测试 15 例（14 绿 + :124 涟漪已由 task-04 修复后全绿）。
- task-02 ✅：placement.py 模块级 fetch_daemon_allowed_roots（instance ∪ 名下全部 runtimes）+ path_definitively_outside_roots（仅可判定越界）+ 12 用例。
- task-03 ✅：mcp_tools 唯一钉定（own_rt 抢占删除，`_get_online_runtime` 仅存于历史根因注释无代码调用）+ 两段式 provider + 400 预检建行前。
- task-04 ✅：:736 QM 场景重写 + :124 全序新语义 + A1 两段式两用例 + A3 三形态 + 双源同序两用例；三文件 53 绿（含 :283/:317/:684 零字节改动回归）。
- task-05 ✅：interactive-cwd-guard.ts 纯函数（白名单先行/存在性/中文 message）+ vitest 11 绿。
- task-06 ✅：daemon.ts truthy 判定 + firstRunId 守卫后插入守卫 + notifyRunResult 拒绝不 mkdir + gap-8 mkdir 条件化；typecheck exit 0。
- task-07 ✅：daemon 23 夹具债修复（6 文件真实 cwd + allowed_roots，零 skip）+ 四闸门（145 passed / ruff 全过 / typecheck 0 / vitest 2954-0fail）+ 5 条验收逐项 PASS（卡内执行记录落盘）。

## 设计一致性
一致，无偏差。三道防线（D-001 唯一钉定 / D-003@v2 双重校验 / D-004 拒建+truthy+插入点）与 D-002@v1 两段式、D-005@v1 双源同序全部按 design 落码；生命周期契约表新增事件（cwd 守卫拒绝）字段与实现逐字段一致；非目标边界守住（batch/普通会话/host_fs 方法/表结构/对外 DTO 零触碰，探针 5 佐证）。两处清单外文件已透明登记：daemon/router.py + mcp_tools.py:1632 的 SIM114 为 base commit（873ebc46）搭载的存量债机械修复（merge-base 实证、零语义、守护用例 52+169 绿）；6 个 daemon 测试夹具为 design Wave C「既有 claim 链路测试回归」口径内的夹具更新（task-07 卡内逐文件登记）。

## 探针结果（CLI 机械预填）
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中

#### 探针 2：设计关键词覆盖（agent 补判）
design 能力关键词逐一 grep 主仓实现确认：`pinned_runtime_id`/`pinned_skip_owner_check`（mcp_tools.py 钉定三行 ✅）；`resolve_representative_binding` 两段式调用 ✅；`fetch_daemon_allowed_roots`/`path_definitively_outside_roots`（placement.py 定义 + mcp_tools.py 消费 ✅）；`checkWorkspaceBoundCwd`/`CwdGuardVerdict`（guard 定义 + daemon.ts 3 处消费 ✅）；`cwd_forbidden`/`cwd_not_found`（错误码 ✅）；`ORDER BY di.last_heartbeat_at`（queries.py 5 处 ✅）；`notifyRunResult`+`error_during_execution`（拒绝回传 ✅）；gap-8 `mkdir` 条件化 ✅。覆盖无缺口。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/app/modules/workspace/member_runtimes）找到 4 个测试文件（…test_representative_binding.py 含全序新语义两用例）
- ✅ task-02 ~ task-07：模块目录测试文件全命中（预填清单，逐一核实）
- 集成盲区 agent 标注：⚠️ daemon.ts 接线级「不 mkdir / 保留 mkdir」无自动化断言——按 design Wave C 口径以 diff 人工核验坐实（task-06 review + QA acceptance 双重人工核验）；其余跨模块装配（钉定→lease→host_fs 路由）由 test_placement_member_binding 双源同序用例 + backend 运行时探针覆盖。

#### 探针 4：决策追踪覆盖（agent 补判）
见下方决策追踪矩阵——5 决策全闭环。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 843 backend endpoints, 0 frontend calls [scope: change-diff] | 179 unused 为存量格局（本变更为纯后端/daemon 行为变更，零 API 字段/DTO 变化，无新增未调用端点）

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除；own_rt 分支删除为块级删除（design 明示），非 fail blocker

## 测试结果
- backend 相关子集（6 套件）：145 passed / 0 failed（task-07 实跑，QA --collect-only 复核 145 吻合）；主仓 apply 后冒烟 test_worker_subsession_dispatch + member_runtimes 34 passed。
- daemon vitest 全量：2954 passed / 0 failed / 9 skipped（task-07 实跑，含守卫 11 用例）；主仓 apply 后 daemon-kind-dispatch 19 + daemon-interactive-codex 14 passed。
- ruff：7 改动文件主仓 All checks passed；daemon typecheck：tsc --noEmit exit 0。
- known_failures：无。

## 决策追踪矩阵
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 唯一钉定 | FR-01 | task-03 | own_rt 分支删除 + test_binding_machine_pinned_over_own_runtime（QM 复刻：lease 落第三方绑定机器）+ 运行时探针 PROBE-1 | 闭环 |
| D-002@v1 两段式 provider | FR-02 | task-03 | 严格命中无回退日志 / 仅 codex 回退命中（provider==codex + fallback warning）两用例 | 闭环 |
| D-003@v2 仅可判定越界 | FR-04 | task-02/03 | 预检三形态用例（400 零落库/~ 放行/空并集放行）+ 纯函数 12 用例 + 运行时探针 PROBE-2/3 | 闭环 |
| D-004@v1 拒建+truthy+插入点 | FR-05 | task-05/06 | 守卫 11 用例（双违反 forbidden 优先）+ 接线 diff 人工核验 + 认领链路 33 集成用例绿 | 闭环 |
| D-005@v1 双源同序 | FR-03 | task-01 | 收敛同机 + daemon_id tie-break 两用例 + 运行时探针 PROBE-1（pin==route） | 闭环 |

## 技术债务
探针 1 零命中（无新 TODO/FIXME）。存量债顺手清偿 2 处 SIM114（mcp_tools.py:1632 / daemon/router.py:3123，base 搭载、机械合并零语义）。遗留观察项（非债）：daemon 接线级 mkdir 口径无自动化断言，已按 design 声明以人工核验 + 夹具回归双重覆盖。

## 变更风险等级
integration-critical（CLI 关键词判级：daemon/session/lease/claim/heartbeat 全命中，且本变更确实触碰 daemon↔backend 跨进程认领链路与 lease 钉定行为——判级名副其实，不做 risk_level 豁免声明）。Runtime Evidence 如下，真实实跑。

## Runtime Evidence
1. **backend 运行时探针（2026-08-28 17:38，主仓 apply 后，commit dcdf7c3a）**——内存 DB 真实调用生产函数链（非 mock）：QM 形态（owner 在线机器未绑定目标区 + 第三方 crrcdt-hubin 绑定且实例心跳更新）：
   ```
   representative_binding_any_online_hit provider=claude runtime_id=0e3c0ce1…
   PROBE-1 backend runtime: pin==route==crrcdt-hubin 686eb5b4   ← 钉定解析与 host_fs 路由收敛同机，绝不落 owner 机器
   PROBE-2 roots union: ['/srv/qm']                              ← instance ∪ runtimes 并集正确
   PROBE-3 precheck: inside=False outside=True tilde-undecidable=False => OK
   ALL_RUNTIME_PROBES_PASSED
   ```
2. **daemon 认领链路集成测试（2026-08-28，主仓 apply 后实跑）**——真实走 `_runLeaseStateMachine → _startInteractiveSession → cwd 守卫（stat + assertWithinAllowedRoots）→ spawn` 全链路：
   ```
   ✓ tests/daemon-interactive-codex.test.ts (14 tests)
   ✓ tests/daemon-kind-dispatch.test.ts (19 tests)   ← 夹具修复后经真实守卫路径（mockConfig 带 allowed_roots + 真实 tmpdir cwd）
   ```
3. **全量闸门**：backend 相关子集 145 passed（integration_cross_workspace / mcp_tools_cross_workspace 佐证 batch 路径与普通会话零波及）；daemon vitest 2954 passed / 0 failed（含空 rootPath gap-8 mkdir 保留用例 + 借用沙箱零变化用例 + 守卫拒绝回传 notifyRunResult 契约实证）。
4. 失败模式排除：task-06 曾实证旧夹具假 rootPath + 空白名单被守卫正确拒（cwd_forbidden 日志 + stash 基线对照）——错机派发/白名单错配路径 fail-loud 成立，无静默形态残留。
5. 部署/迁移：不涉及（无表结构/配置变更，新旧端兼容顺序已在 design 兼容策略论证）。

## 代码审查
- execute 期：7 task 逐个 review.json 双 pass（主 agent 逐行 diff 审查）+ 独立 QA acceptance review pass（抽查 task-03/06 diff 与 reviewerNotes 逐点相符、跨 task 交界三处一致、组装证据交叉自洽）。
- verify 期发现：0 个阻断问题；2 处流程瑕疵已透明登记（router.py 超 allowed_paths 的存量债连带修复、接线级 mkdir 无自动化断言按声明口径人工核验）。
- 总体评价：实现质量高——根因定位准确（选机/校验/掩盖三要素），三道防线纵深布防，跨 OS 路径归一双端同测，测试翻转全部有需求变更依据（CLAUDE.md 规则9）非放水。
