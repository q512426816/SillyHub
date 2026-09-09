# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。

## 结论 [层：人工判断]

结论枚举：PASS WITH NOTES——自动化与真实 HTTP 集成证据全绿（backend 41 / frontend 245 / daemon 73 / 集成断言脚本 exit 0），12/13 任务交付；notes=task-08 挂起（Cursor 免费额度，spike INCONCLUSIVE 2/2 合规）+ 真机冒烟三项转人工清单（smoke-result §3）

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]

> 全部实现已随 execute 合入主仓并提交（99a228add 已推送）；CLI 的 satisfied 文件级三核验
> （存在×mtime≥verify 起点×未提交 diff 交集）在「已提交」状态下结构性不可满足（diff 集合为空），
> 故统一按 missing+豁免 登记，证据=verify 窗口内实测测试结果 + commit 99a228add（诚实记录，不虚标 satisfied）。

- task-01: missing（豁免：73 项 daemon 单测四态全绿覆盖桥接逻辑；真机 pi 一问一答转人工清单 smoke-result §3，非代码缺陷） | verifiedFiles: sillyhub-daemon/src/interactive/pi-rpc-driver.ts, sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts
- task-02: missing（豁免：tsc 0 + 77 用例绿，commit 99a228add；已提交态文件级复验不适用） | verifiedFiles: sillyhub-daemon/src/interactive/session-manager/driver-factory.ts
- task-03: missing（豁免：51→73 用例绿含 denormalize 回流与三锚点兜底，commit 99a228add） | verifiedFiles: sillyhub-daemon/src/interactive/pi-rpc-driver.ts
- task-04: missing（豁免：73 passed 两轮稳定（含 22 新增四态），verify 窗口内实测） | verifiedFiles: sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts
- task-05: missing（豁免：spike 判定 INCONCLUSIVE 完整落盘（判定口径/证据/挂起决定），非不可验） | verifiedFiles: .sillyspec/changes/2026-09-09-askuser-pi-cursor/spike-cursor-marker.md
- task-06: missing（豁免：31 用例绿，verify 窗口内实测，commit 99a228add） | verifiedFiles: frontend/src/lib/askuser-marker.ts, frontend/src/lib/__tests__/askuser-marker.test.ts
- task-07: missing（豁免：18 新用例+43 既有全绿零适配，verify 窗口内实测） | verifiedFiles: frontend/src/components/ask-user-marker-card.tsx, frontend/src/components/daemon/turn-timeline.tsx
- task-08: missing（豁免：挂起未实现——Cursor 免费额度致 spike INCONCLUSIVE，补测 go 后执行；无代码产出属预期） | verifiedFiles: .sillyspec/changes/2026-09-09-askuser-pi-cursor/spike-cursor-marker.md
- task-09: missing（豁免：41 用例绿含 9 越权反例 + 真实 HTTP 集成断言（外人 404/成员过全门禁），verify 窗口内实测） | verifiedFiles: backend/app/modules/daemon/permission_service.py, backend/app/modules/daemon/tests/test_session_permissions.py
- task-10: missing（豁免：29 用例绿含降级路径，verify 窗口内实测） | verifiedFiles: frontend/src/components/ask-user-dialog-card.tsx
- task-11: missing（豁免：110 用例绿（10 新增+100 既有），verify 窗口内实测） | verifiedFiles: frontend/src/components/group-chat/group-chat-panel.tsx, frontend/src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx
- task-12: missing（豁免：三端 9 键对齐测试 4+44 用例绿，verify 窗口内实测） | verifiedFiles: sillyhub-daemon/src/interactive/providers.ts, backend/app/modules/agent/provider_caps.py, frontend/src/lib/provider-caps.ts
- task-13: missing（豁免：自动化验收面全过（backend 41/frontend 245/daemon 73/集成断言 exit 0）；真机三项转人工清单 smoke-result §3） | verifiedFiles: .sillyspec/changes/2026-09-09-askuser-pi-cursor/smoke-result.md, .sillyspec/changes/2026-09-09-askuser-pi-cursor/verify-integration.log

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
- claim: 影子会话答题授权真实 HTTP 集成：外人 404（R-08 resource-hiding）+ 群成员通过全部授权门禁（影子归属/群成员/manual_approval 豁免）到达 WS 投递步（504=daemon 未连 verify 实例的正确 fail-safe，行保持 pending 不落假 answered） | command: bash /tmp/askuser-verify-evidence.sh（种子：uv run python %TEMP%/askuser-verify-seed.py；服务：uv run uvicorn app.main:app --port 8100） | exit: 0 | log: .sillyspec/changes/2026-09-09-askuser-pi-cursor/verify-integration.log

## 任务完成度 [层：人工判断]
12/13 完成：task-01~07/09~13 逐卡验收标准满足（证据=各卡 verify 命令输出 + QA 验收 13 项 checklist）；**task-08 未实现（挂起）**——CLI 机器勾选器按 review 联动误勾 13/13，按事实纠正：session-manager.ts 零改动、无 prompt 注入，挂起依据 spike-cursor-marker.md（Cursor 免费额度受阻，2/2 有效运行合规）。task-13 自动化面 PASS、真机三项转人工（smoke-result §3）。

## 设计一致性 [层：人工判断]
与 design.md v2 一致（QA 独立验收 13 项全核，execute-review-2026-09-10-002614）。已登记偏差 3 gap：①task-08 挂起（FR-03 生产侧输入源暂缺，前端资产就绪+自然语言降级不坏）；②caps cursor='marker' 乐观初值（no-go 时三端一行改 none，锚点已留）；③非群主读侧不可见 pending 卡（读侧 owner-only，设计已预判另卡）。轻微 2 项：marker 渲染未按 caps 门控（caps=none 时无标记产出，功能等价）；rpc.md 文档不可达已按 fallback 依据实现并注释。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:257` * TODO provider profile 未实现——本变更不实现注入逻辑（design §3 非目标）。
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:283` * TODO provider profile 未实现——仅类型占位（design §3 非目标，留后续变更）。
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:288` * TODO provider profile 未实现——仅类型占位（同上）。
- ℹ️ 清单文件不存在（跳过）：NEW:frontend/src/lib/askuser-marker.ts、NEW:frontend/src/components/ask-user-marker-card.tsx、NEW:frontend/src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx、NEW:frontend/src/lib/__tests__/askuser-marker.test.ts

#### 探针 2：设计关键词覆盖
能力关键词 grep 全命中：pi_extension_ui（pi-rpc-driver.ts+73 用例）/ parseAskUserMarker（lib+组件+群聊）/ recommendResponders（dialog-card+marker-card+群聊）/ session_kind group_member（permission_service 影子分支）/ answered_by_actual_user（SSE 透传链三文件）/ dialog native marker none（caps 三端+对齐测试）/ pendingDialogs（挂起表）/ _cancelAllPendingDialogs（三锚点兜底）。探针 3 的 ⚠️（task-01/02/03/05/13 目录无测试）说明：daemon 测试集中在 tests/interactive/（探针按 src 目录找），task-01/03 的行为由 task-04 同文件 73 用例覆盖；task-05/13 是记录/人工任务无自动化测试属预期。

#### 探针 3：验收标准测试覆盖
- ⚠️ task-01: 模块目录（sillyhub-daemon/src/interactive）递归未找到测试文件（含 co-located tests/）
- ⚠️ task-02: 模块目录（sillyhub-daemon/src/interactive/session-manager、sillyhub-daemon/src/interactive）递归未找到测试文件（含 co-located tests/）
- ⚠️ task-03: 模块目录（sillyhub-daemon/src/interactive）递归未找到测试文件（含 co-located tests/）
- ✅ task-04: 模块目录（sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ⚠️ task-05: 模块目录（NEW:.sillyspec/changes/2026-09-09-askuser-pi-cursor）递归未找到测试文件（含 co-located tests/）
- ✅ task-06: 模块目录（frontend/src/lib、frontend/src/lib/__tests__）找到 20 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/change-autolink.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts …）
- ✅ task-07: 模块目录（frontend/src/components、frontend/src/components/daemon、frontend/src/components/daemon/__tests__）找到 20 个测试文件（frontend/src/components/agent/borrowed-solution-files-panel.test.tsx、frontend/src/components/agent/borrowed-solution-files.test.tsx、frontend/src/components/agent/__tests__/borrow-trigger-contract.test.ts、frontend/src/components/agent-log/__tests__/normalize-dual-path.test.ts、frontend/src/components/agent-log/__tests__/normalize.test.ts …）
- ✅ task-08: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/src/interactive/session-manager、sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ✅ task-09: 模块目录（backend/app/modules/daemon、backend/app/modules/daemon/tests）找到 22 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/grants/tests/conftest.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/modules/daemon/grants/tests/test_migration.py …）
- ✅ task-10: 模块目录（frontend/src/components）找到 10 个测试文件（frontend/src/components/agent/borrowed-solution-files-panel.test.tsx、frontend/src/components/agent/borrowed-solution-files.test.tsx、frontend/src/components/agent/__tests__/borrow-trigger-contract.test.ts、frontend/src/components/agent-log/__tests__/normalize-dual-path.test.ts、frontend/src/components/agent-log/__tests__/normalize.test.ts …）
- ✅ task-11: 模块目录（frontend/src/components/group-chat、frontend/src/components/group-chat/__tests__、frontend/src/lib/daemon）找到 3 个测试文件（frontend/src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx、frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx、frontend/src/components/group-chat/__tests__/member-panel.test.tsx）
- ✅ task-12: 模块目录（sillyhub-daemon/src/interactive、backend/app/modules/agent、frontend/src/lib、backend/app/modules/agent/tests、frontend/src/components/daemon/__tests__、frontend/src/components/sessions/__tests__）找到 38 个测试文件（backend/app/modules/agent/tests/test_agent_sessions_include_ended.py、backend/app/modules/agent/tests/test_agent_session_model.py、backend/app/modules/agent/tests/test_apply_run_metadata_cache.py、backend/app/modules/agent/tests/test_base.py、backend/app/modules/agent/tests/test_borrow_resolver.py …）
- ⚠️ task-13: 模块目录（.sillyspec/changes/2026-09-09-askuser-pi-cursor）递归未找到测试文件（含 co-located tests/）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 4：决策追踪覆盖
D-001@v1（三波组织）→ plan Wave1-6 已覆盖；D-002@v1（pi 桥接+永久等待+红线）→ FR-01/02 → task-01/02/03/04 → 73 用例+红线断言 已覆盖；D-003@v2（纯前端标记+spike 门槛）→ FR-03/04 → task-05/06/07/08 → spike 记录+31+18 用例（task-08 挂起如实）部分；D-004@v2（先到先得+授权放开+推荐人）→ FR-05 → task-09/10/11 → 41+110 用例+真实 HTTP 集成断言 已覆盖；D-005@v1（caps）→ FR-06 → task-12 → 三端 9 键+对齐测试 已覆盖；D-006@v2（管道零改动+授权例外）→ diff 无协议/表结构改动 已覆盖；D-007@v1（方案 A 同构）→ 无网关层、端头直挂 已覆盖。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 2087 backend endpoints (live [scan-root 571] + artifact 1713), 0 frontend calls [scope: change-diff (2 files @ scan-root)] | 591 backend endpoints unused by frontend
- ⚠️ 591 个后端端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

## 测试结果 [层：确定性检查——CLI 实测对账]
worktree 终跑（2026-09-10）：backend uv run pytest test_session_permissions.py test_provider_caps_alignment.py --no-cov = 41 passed 0 failed；frontend pnpm vitest run（marker/dialog/marker-card/group-chat/caps/permission 9 文件）= 245 passed 0 failed；daemon pnpm exec vitest run tests/interactive/pi-rpc-driver.test.ts = 73 passed 0 failed；双端 tsc --noEmit = 0 错；eslint 0 error（30 warning 全预存）；集成断言脚本 exit 0。无 known_failures。全量套件按 CLAUDE 规则 0 留 CI。

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | 流程 | plan 六 Wave | plan.md 结构 | 已覆盖 |
| D-002@v1 | FR-01/02 | task-01/02/03/04 | 73 用例+权限类零桥接断言 | 已覆盖 |
| D-003@v2 | FR-03/04 | task-05/06/07/08 | 31+18 用例+spike 记录；task-08 挂起 | 部分（挂起如实） |
| D-004@v2 | FR-05 | task-09/10/11 | 41+110 用例+HTTP 集成断言 | 已覆盖 |
| D-005@v1 | FR-06 | task-12 | 三端 9 键+对齐测试 4 例 | 已覆盖 |
| D-006@v2 | 管道 | diff 全量 | 无协议/表结构改动 | 已覆盖 |
| D-007@v1 | 结构 | 全部 | 无网关层 | 已覆盖 |

## 技术债务 [层：人工判断]
探针 1 命中的 3 处 TODO 为 providers.ts 的 provider profile 预存占位（diff 零新增，2026-09-03 变更非目标遗留）。本变更新增代码零 TODO/FIXME/HACK。技术债务=smoke-result §4 四条已知限制（非群主读侧另卡/他答人名降级/cursor 免费额度/task-08 挂起）。

## 变更风险等级 [层：人工判断]
integration-critical（关键词判级如实接受：涉及 daemon/backend 跨进程、session 生命周期、SSE 契约字段）。Runtime Evidence 已提供真实集成证据（下方）；未用否定语境抑制任何关键词。部署面（migration/启动路径）未触碰 → 非 deployment-critical。

## Runtime Evidence [层：人工判断]
- 长驻进程启动命令：uv run uvicorn app.main:app --port 8100（主仓新代码 99a228add；PID 41892 已登记 .sillyspec/.runtime/verify-services-2026-09-09-askuser-pi-cursor.pids，CLI 收尾自动回收）
- 触碰的服务端点：POST /api/auth/login（成员/外人）；POST /api/daemon/sessions/{sid}/permissions/{rid}/response（影子会话答题——本变更改动核心路径）
- 触发核心路径的请求与响应：①外人作答 → HTTP 404 {"code":"HTTP_404_DAEMON_SESSION_NOT_FOUND"}（resource-hiding ✅）②群成员作答 → HTTP 504 {"code":"HTTP_504_DAEMON_RUNTIME_OFFLINE","message":"...dialog response could not be delivered"}（授权门全过到达投递步；daemon 未连 8100 实例故 fail-safe ✅）
- 进程日志关键片段：C:\Users\qinyi\AppData\Local\Temp\askuser-verify-integration.log 四断言全过（exit 0，尾行 RESULT: ALL ASSERTIONS PASSED）；uvicorn 日志 askuser-verify-uvicorn.log
- 生命周期终态断言：DB 终态 sd-verify-1=pending + answered_by NULL（投递失败不落假 answered，fail-safe）；run 行被周期清扫判死的边界行为实证（409 no-active-run → 复活后 504 offline 两级 fail-safe 符合设计不变量）
- 失败模式排除：①越权（外人/非群成员）404 不泄露存在性 ✅ ②投递失败不半写 ✅ ③manual_approval=False 影子 dialog 豁免仅 ask_user 类（9 单测含权限审批不豁免反例）✅
- daemon 侧（pi 桥接 WS 投递/settle）：本实例未连 daemon——由 73 项单测四态覆盖（含 PERMISSION_RESPONSE settle 路径），真机 pi 一问一答转人工清单；commit 99a228add

## 代码审查 [层：人工判断]
问题列表：无 P0/P1 代码缺陷（QA 独立验收 13 项 + 代码审查轻量自查 + eslint/ruff/tsc 全净）。3 gap 均为环境/后续卡约束（task-08 挂起、caps 乐观初值、非群主读侧）。总体评价：可交付——自动化覆盖充分、集成路径实证、红线与越权反例齐备、已知限制全部如实登记不虚报。
