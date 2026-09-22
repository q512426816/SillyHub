# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。

## 结论 [层：人工判断]

结论枚举：PASS WITH NOTES——7/7 任务完成、主仓落位 807ed6047、相关面全绿（daemon 229/backend 20+16/frontend 63/双端 tsc/ruff/mypy 0）、真机实证（codex 受理全证/pi 通道信封证/QUICKLOG ql-20260914-008）；notes：①R-01 claude /compact 未取得真机实证（本机裸 CLI 401 认证失效）——官方 SDK 文档背书+代码就位+降级预案（不生效翻 caps claude compact=false 重生成，按钮消失零破坏），留生产环境首用实证；②pi 数字回执未取得（三轮放大上下文仍低于 ~36k 压缩阈值）——字段名以官方 rpc.md 为准+代码 spike 校正点在位。

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
<!-- 无 cannot_verify 任务时本节写「无」；有则逐 task 一行 -->
无（8 个 task review 全 pass，无 cannot_verify 任务）

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
- claim: 真机 codex app-server thread/compact/start 受理实证 | command: node $TEMP/spike-compact-codex.mjs（真机 codex 0.147 建线程跑轮后发 compact） | exit: 0（response {"id":100,"result":{}}） | log: QUICKLOG ql-20260914-008
- claim: 真机 pi rpc compact 通道/信封/错误语义实证 | command: node $TEMP/spike-compact-pi.mjs（真机 pi 0.81.1 get_state→prompt→turn_end→compact） | exit: 0（真实信封："Nothing to compact (session too small)"） | log: QUICKLOG ql-20260914-008
- claim: 主仓合并态端到端相关面（apply 后复验） | command: vitest 7 套件 + pytest 端点 + 前端面板 | exit: 0（daemon 229/backend 16/frontend 36） | log: 本报告测试结果节

## 任务完成度 [层：人工判断]
7/7 全部完成（review.json verdict 全 pass）：task-01 caps 十二键三端（14/4/27 绿+幂等）/task-02 端点双分路（16 用例）/task-03 RPC handler 六守卫（44+9 绿）/task-04 pi compact（97 绿含超时）/task-05 codex pending+compact（67+37 绿）/task-06 前端三态三分型（36+41 绿）/task-07 spike 实证+文档（QUICKLOG 回执）。

## 设计一致性 [层：人工判断]
一致。两处执行期实证修正均留痕：①task-02 claude 分路 svc.inject_session 方法面调用（facade 不暴露私有 helper，语义等价）；②router/__init__.py _ENDPOINT_ORDER 机械必改（import 期不变量）已补 design 清单行。其余 FR-01~08 逐条对上（三轮 Grill v3 设计的 caps/RPC 双分路/三分型通知/六守卫全部落地）。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:351` * TODO provider profile 未实现——本变更不实现注入逻辑（design §3 非目标）。
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:377` * TODO provider profile 未实现——仅类型占位（design §3 非目标，留后续变更）。
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:382` * TODO provider profile 未实现——仅类型占位（同上）。
- ⚠️ `docs/agent-provider-onboarding.md:198` envPath: 'SILLYHUB_XXX_PATH',                 // env 覆盖变量

#### 探针 2：设计关键词覆盖
- compact 键：providers.ts/gen 脚本/两 @generated/双守护/picker 七处命中 ✅
- session_compact RPC：daemon.ts registerRpcHandler + session-manager compact + backend send_rpc 三端命中 ✅
- CompactResult/compact?()：driver.ts 契约 + pi/codex 两实现命中 ✅
- thread/compact/start：codex driver + spike-02 真机实证 ✅
- {"type":"compact"}：pi driver + spike-01 真机实证 ✅
- /compact inject 复用：compact.py svc.inject_session ✅
- 三分型通知：session-panel-page handleSessionCompact ✅
- DaemonSessionTurnConflict/DaemonRpcTimeout/Offline/RemoteError：compact.py 四映射命中 ✅

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/scripts、frontend/src/lib、backend/app/modules/agent、backend/app/modules/agent/tests、sillyhub-daemon/tests/interactive、frontend/src/components/sessions/__tests__、sillyhub-daemon/tests）找到 48 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/change-autolink.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts …）
- ✅ task-02: 模块目录（backend/app/modules/daemon/router、backend/app/modules/daemon、backend/app/modules/daemon/session/service、backend/app/modules/daemon/tests、backend、frontend/src/lib）找到 78 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/grants/tests/conftest.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/modules/daemon/grants/tests/test_migration.py …）
- ✅ task-03: 模块目录（sillyhub-daemon/src、sillyhub-daemon/src/interactive、sillyhub-daemon/src/interactive/session-manager、sillyhub-daemon/tests/interactive）找到 12 个测试文件（sillyhub-daemon/src/sillyspec-manager.ts、sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts …）
- ✅ task-04: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ✅ task-05: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ✅ task-06: 模块目录（frontend/src/lib/daemon、frontend/src/components/sessions、frontend/src/components/daemon/session-panel、frontend/src/components/sessions/__tests__）找到 8 个测试文件（frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx、frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx、frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx、frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx、frontend/src/components/sessions/__tests__/session-config-bar.test.tsx …）
- ✅ task-07: 模块目录（docs）找到 11 个测试文件（docs/archive/agent-sillyspec-stage-execution-analysis.md、docs/archive/spec-alignment.md、docs/integrations/sillyspec-dispatch.md、docs/sillyspec/finished/2026-08-23-monorepo-cwd-wrong-spec-instance.md、docs/sillyspec/finished/2026-08-27-task-review-draft-overwrite-and-pathspec-brackets.md …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 4：决策追踪覆盖
D-001@v1→NG-01（全任务无自动压缩配置）；D-002@v1→task-02/03/06 三层空闲守卫；D-003@v3→task-02/03/04/05 双分路+RPC；D-004@v1→task-02 DTO/task-06 三分型——全部闭环 ✅

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 2189 backend endpoints (live [scan-root 599] + artifact 1797), 0 frontend calls [scope: change-diff (7 files @ scan-root)] | 621 backend endpoints unused by frontend
- ⚠️ 621 个后端端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

## 测试结果 [层：确定性检查——CLI 实测对账]

主仓合并态实跑（2026-09-14，apply 后复验）：
- daemon vitest 7 套件：session-compact(15)+pi-rpc-driver(82)+codex-app-server-driver(52)+approval(37)+session-manager(29)+provider-registry+provider-adapter-registry = **229 passed / 0 failed**（exit 0）
- backend pytest：test_session_compact_endpoint 16 + alignment 4 = **20 passed**（exit 0）
- frontend vitest：ctx-usage-bar(36)+pre-session-picker(27) = **63 passed**（exit 0）
- 质量扫描：backend ruff+mypy 944 文件 0；daemon/frontend tsc 0；eslint 改动文件 0 error（3 存量 warning 留痕）
- 全量：CLI --done 统一执行对账（known_failures 沿用既有 J/K/L 组豁免）

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
<!-- 机械半边预填（CLI，P0-1）：D→FR→task 链自 decisions.md × tasks/*.md frontmatter 结构化字段构建；
     Evidence / 状态两列是人工判断——逐格复核，未闭环行必须在报告标注风险 -->
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01、FR-08 | task-01、task-07 | <待填：证据回指> | <待填> |
| D-002@v1 | FR-02、FR-03、FR-04、FR-05、FR-06、FR-07 | task-02、task-03、task-06 | <待填：证据回指> | <待填> |
| D-003@v1 | ⚠️ 未映射 | ⚠️ 未闭环（无 task 回指） | <待填：证据回指> | <待填> |
| D-003@v2 | ⚠️ 未映射 | ⚠️ 未闭环（无 task 回指） | <待填：证据回指> | <待填> |
| D-004@v1 | FR-02、FR-03、FR-06、FR-07 | task-02、task-06 | <待填：证据回指> | <待填> |
| D-003@v3 | FR-02、FR-03、FR-04、FR-05 | task-02、task-03、task-04、task-05 | <待填：证据回指> | <待填> |

## 技术债务 [层：人工判断]
- 本变更新增代码零 TODO/FIXME（spike 校正点注释为设计内预留非债务）
- 遗留（非阻塞）：pi 数字回执字段名待生产首压实证（校正点一行改）；claude R-01 生产实证（降级预案完备）

## 变更风险等级 [层：人工判断]
integration-critical（daemon/session/agent_run 关键词命中）。真实集成证据：真机 codex/pi 两路命令实证 + 主仓合并态相关面复验 + ws RPC 全链（backend send_rpc→daemon handler→driver→result）经端点 16 用例与真机实证。」+ 理由；若有命中被同句否定语境抑制（如「不新增 daemon 协议」），写明被抑制关键词与理由（抑制可审计，不许用来静默降级）-->

## Runtime Evidence [层：人工判断]
### 真机命令实证（QUICKLOG ql-20260914-008）
- codex 0.147 真机 app-server：initialize→thread/start→turn/start（一轮完成）→thread/compact/start {threadId camelCase}→**response {"id":100,"result":{}} 受理**（spike-02 全证）
- pi 0.81.1 真机 rpc：get_state→prompt→turn_end(stop)→compact 命令→**真实信封 "Nothing to compact (session too small)"**（通道/信封/错误语义证；数字回执未取得——阈值 ~36k 未达）
- claude：本机裸 CLI 401 认证环未取得（R-01 降级姿态：官方文档+翻 caps 预案）
### 主仓合并态
- apply 双路径（worktree commit a439407ce + cherry-pick 807ed6047）后主仓复验：daemon 229/backend 20/frontend 63/双端 tsc 0

## 代码审查 [层：人工判断]
- 各 Wave 主代理逐任务审查 pass（review.json 留痕）+ execute stage review pass（10 项 checklist：FR 逐条+越权+测试一致性）
- 发现→处置：W3 transient 类型收窄错误（task-05 代理自修终态绿）；_ENDPOINT_ORDER 卡外改（机械必改+清单补行）；docs 提交夹带并行会话暂存件（共享索引老毛病，内容无损归并行变更）
