# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成；语义槽由 verify 阶段填写）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号。

> 探针结果已机械预填；其余章节为真实内容。结论只认「结论枚举：」槽行。

## 结论 [层：人工判断]

结论枚举：PASS WITH NOTES——三端实现与设计一致、三端模块测试全绿（164+1339+64）、execute QA acceptance review pass；遗留两点移交：①跨进程真机集成冒烟（起 daemon+backend+frontend 走通弹窗全链路）移交人工验收（本机开发环境三服务未同时在线）；②探针 5 的 3 条 missing 经实证为提取器前缀口径噪音（router 相对路径未拼 `/api/daemon` 前缀），非真实契约缺口。

## 移交项（结构化） [层：人工判断——CLI 清单核验]

| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| manual-acceptance | 跨进程集成冒烟：/runtimes 机器卡 →「日志」弹窗（行数切换/刷新/下载/truncated 提示）→「配置」弹窗（掩码展示/明文切换/恒脱敏下载）；边界态至少各验一条（老 daemon 422 / daemon.log 不存在 / 机器离线按钮禁用） | 本机起 daemon（新版，需重新构建分发）+ backend + frontend 三服务在线后按 proposal.md 成功标准逐条走查；daemon 侧新 RPC 需 daemon 重新构建后生效 |
| other | 探针 5 前缀口径噪音（3 missing + 6 unused）——endpoints.json 提取为 router 相对路径（`/machines`），前端调用为全路径（`/api/daemon/machines`），两侧口径错配 | 建议工具侧修复 sillyspec endpoints extract 拼 router prefix（记录到 docs/sillyspec/ 观察项可选）；本变更不阻断 |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]

无（execute 阶段无 cannot_verify 任务——verify-required-evidence.json 不存在）。

## 集成验证回执 [层：自述声明——CLI 一致性校验]

- claim: backend daemon 域 164 用例全绿（含新端点 11 用例：转发成功/参数透传/四类错误映射/鉴权）
  command: cd backend && uv run pytest tests/modules/daemon -q --no-cov
  exit: 0
  log: /tmp/s8-backend.log（164 passed, 2026-10-13 20:0x）
- claim: frontend daemon 组件域+lib+runtimes 页 1339 用例全绿（含新弹窗 8 用例与既有 machine-card/runtimes 页零回归）
  command: cd frontend && pnpm exec vitest run src/components/daemon src/lib/daemon "src/app/(dashboard)/runtimes"
  exit: 0
  log: /tmp/s8-frontend.log（94 files / 1339 passed）
- claim: daemon 诊断 RPC 相关 64 用例全绿 + typecheck 零错误（diag-rpc 12 用例含字节上限/UTF-8 边界/掩码六档）
  command: cd sillyhub-daemon && pnpm exec vitest run tests/diag-rpc.test.ts tests/daemon-kind-dispatch.test.ts tests/cli.test.ts && pnpm typecheck
  exit: 0
  log: /tmp/s8-daemon.log（64 passed / 8 skipped）+ /tmp/s8-daemon-tsc.log（exit 0）
- claim: 跨进程数据契约三跳逐字一致（daemon result 键 ↔ backend DTO ↔ api-types ↔ 前端消费），由 execute QA 独立审查核验（11 次调用预算）
  command: sillyspec register-stage-review --stage execute（review.json adopted，reviewType=acceptance，specVerdict/qualityVerdict=pass）
  exit: 0
  log: .sillyspec/.runtime/stage-reviews/execute-review-2026-10-13-201447/review.json
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->

## 任务完成度 [层：人工判断]

- task-01 ✅ 已完成：diag-rpc.ts（readLogTail/getMaskedConfig/SENSITIVE_CONFIG_FIELDS）+ daemon.ts `_registerDiagRpcHandler`（sillyhub-daemon/src/daemon.ts:6781-6810）+ 12/12 单测绿 + typecheck 0 错（commit bef6fbf0）。
- task-02 ✅ 已完成：schema.py 两 DTO（backend/app/modules/daemon/schema.py:1684-1711）+ machines.py 两端点与 _send_diag_rpc（backend/app/modules/daemon/router/machines.py:656-748）+ _ENDPOINT_ORDER 两行 + pytest 11/11 + openapi.json/api-types.ts 产物（commit a21f1be9 + 70b926db docstring 对齐）。
- task-03 ✅ 已完成：machines.ts 两 client 函数 + daemon-diagnostic-dialog.tsx（双 Tab/五边界态/下载恒脱敏）+ machine-card.tsx 可选 prop 入口 + page.tsx diagTarget 串联 + 组件测试 8/8 + 既有 1339 回归绿 + tsc 0 错 + lint 过（commit 21948f14）。
- 完成率 3/3 = 100%。

## 设计一致性 [层：人工判断]

实现与 design.md 一致（QA 逐项核验 8 个设计要点 + 三项必查全 pass，见 execute review.json checklist）。两处已声明的合理偏差：
1. 明文态下载取数：design 文字写「重新以 reveal=false 拉取」，实现复用首次掩码缓存（frontend/src/components/daemon/daemon-diagnostic-dialog.tsx:86,170-177）——安全语义等价（同为 reveal=false 口径、不复用明文 state），D-007 测试锁定产物掩码（daemon-diagnostic-dialog.test.tsx:253-277）。
2. design 文件清单的 backend 测试路径：执行期 D-008 裁决对齐仓库实际结构 tests/modules/daemon/（design.md 已同步）。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中

#### 探针 2：设计关键词覆盖
能力关键词逐个核验（全部命中实现代码）：
- 「尾部/尾部行」→ readLogTail（sillyhub-daemon/src/diag-rpc.ts:84）
- 「字节上限/截断/truncated」→ LOG_TAIL_MAX_BYTES + truncated（sillyhub-daemon/src/diag-rpc.ts:27,140）
- 「掩码/脱敏」→ maskValue/getMaskedConfig/SENSITIVE_CONFIG_FIELDS（sillyhub-daemon/src/diag-rpc.ts:36,54,152）
- 「明文/reveal」→ reveal 参数链（sillyhub-daemon/src/diag-rpc.ts:163；backend/app/modules/daemon/router/machines.py:704；frontend/src/components/daemon/daemon-diagnostic-dialog.tsx:231）
- 「下载」→ downloadText + 两个下载按钮（frontend/src/components/daemon/daemon-diagnostic-dialog.tsx:56-64,169-183）
- 「刷新」→ loadLogs 刷新按钮（frontend/src/components/daemon/daemon-diagnostic-dialog.tsx:211）
- 「版本过旧/升级提示」→ HTTP_422_DAEMON_DIAG_UNSUPPORTED + unsupportedAlert（backend/app/modules/daemon/router/machines.py:731；frontend/src/components/daemon/daemon-diagnostic-dialog.tsx:185）
- 「不存在/前台运行」→ exists:false 分支（sillyhub-daemon/src/diag-rpc.ts:89-101；frontend/src/components/daemon/daemon-diagnostic-dialog.tsx:202-210）
无 ⚠️ 未实现关键词。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录找到测试文件（核心承接 sillyhub-daemon/tests/diag-rpc.test.ts 12 用例）
- ✅ task-02: 承接 backend/tests/modules/daemon/test_daemon_machine_diag.py 11 用例
- ✅ task-03: 承接 frontend/src/components/daemon/__tests__/daemon-diagnostic-dialog.test.tsx 8 用例
- 集成盲区标注 ⚠️：跨进程真机链路（daemon RPC ↔ backend WS ↔ 前端弹窗）组件单测不可覆盖——已列移交项 manual-acceptance（起三服务走查）；类型装配面（openapi→api-types→前端 import）已由 tsc 0 错 + 探针 5 前缀修正后对账闭环。
- 断言有效性抽查（3 个核心测试）：①diag-rpc.test.ts 字节上限用例断言真实行内容/行数区间/末行一致（非空断言）✅；②test_daemon_machine_diag.py 断言 resp.json() 全字段 == fixture 与 send_rpc params 精确值（走公开 HTTP 行为）✅；③daemon-diagnostic-dialog.test.tsx 断言下载 Blob 实际内容（掩码值在场/明文值不在场——真副作用断言）✅。达标。

#### 探针 7：验收×测试覆盖矩阵
（机械预填已复核，两处 partial 改写为 covered——见下表改写行）

**task-01**
| acceptance 条目 | 归属测试文件 | 判定 | 证据 |
|---|---|---|---|
| diag-rpc.test.ts 全绿 | `sillyhub-daemon/tests/diag-rpc.test.ts` | covered | sillyhub-daemon/tests/diag-rpc.test.ts:33-130（12 用例实测绿） |
| daemon 全量 vitest + typecheck 零错误 | `sillyhub-daemon/tests/diag-rpc.test.ts` | covered | 全量实测 4721 passed（/tmp/diag-all.log）+ tsc exit 0（/tmp/s8-daemon-tsc.log） |
| handler 注册同模式、无 CLI/日志写入行为改动 | `sillyhub-daemon/tests/diag-rpc.test.ts` | covered | 人工核验：sillyhub-daemon/src/daemon.ts:6789 与 _registerListDirRpcHandler:6808 同模式（QA 核验锚点）；diff 无 cli.ts/attachConsoleToLogFile 改动 |

**task-02**
| acceptance 条目 | 归属测试文件 | 判定 | 证据 |
|---|---|---|---|
| test_daemon_machine_diag.py 全绿 | `backend/tests/modules/daemon/test_daemon_machine_diag.py` | covered | backend/tests/modules/daemon/test_daemon_machine_diag.py:113-292（11 用例实测绿） |
| backend daemon 域不回归 | 同上 | covered | tests/modules/daemon 全域 164 passed（/tmp/s8-backend.log） |
| openapi/api-types 产物 | 同上 | covered | backend/tests/modules/daemon/test_daemon_machine_diag.py:286-292（openapi 可见性断言）+ api-types.ts:15155,15526 两 schema 实测生成 |

**task-03**
| acceptance 条目 | 归属测试文件 | 判定 | 证据 |
|---|---|---|---|
| daemon-diagnostic-dialog.test.tsx 全绿 | `frontend/src/components/daemon/__tests__/daemon-diagnostic-dialog.test.tsx` | covered | :58-208 + :213-277（8 用例实测绿，含 D-007 明文态下载脱敏断言） |
| frontend 全量（含既有 machine-card/runtimes 用例）+ tsc 0 错 | 同上 + machine-card.test.tsx | covered | 1339 passed 94 文件（/tmp/s8-frontend.log）+ tsc exit 0 |
| UI 全中文、只读标注在场、无配置编辑入口 | 同上 | covered | 「只读」Tag 断言在 daemon-diagnostic-dialog.test.tsx:236；弹窗无任何写回调用（组件仅 fetchMachineLogTail/fetchMachineConfig 两只读 GET，代码审查走查确认） |

（原「零/半自动化承接条目 2 条」经复核均有承接与走查证据，无 ⚠️ 残留。）

#### 探针 4：决策追踪覆盖
闭环判定（D → FR → task → 证据）：
- D-001@v2（掩码公式/清单）→ FR-03/04 → task-01/03 → diag-rpc.ts:36,54-57 + 测试 :139-162 ✅ 闭环
- D-002@v1（拉取式+双上限）→ FR-01/02 → task-01/02/03 → diag-rpc.ts:24-27 + 弹窗刷新/行数 ✅ 闭环
- D-003@v1（查看+下载只读）→ FR-01~05 → task-03 → 只读 Tag + 下载按钮 ✅ 闭环（下载口径由 D-007 细化）
- D-004@v1（方案 B 三端链路）→ 全 FR → task-01/02 → 三端实现即证据 ✅ 闭环
- D-005@v1 / D-006@v1（rejected 防复潮）→ 无 FR/task 映射 = 设计使然（否决登记非功能需求），无闭环缺口 ✅
- D-007@v1（下载恒脱敏）→ FR-05 → task-03 → dialog.tsx:170-177 maskedCfg + 测试 :253-277 ✅ 闭环
- D-008@v1（测试路径对齐）→ task-02 → backend/tests/modules/daemon/test_daemon_machine_diag.py 实际落地 ✅ 闭环
- D-001@v1 已被 D-001@v2 superseded——无下游引用 v1（requirements/plan 均引用 @v2）✅ 无 stale 引用
- 无 P0/P1 unresolved/blocking 决策 ✅

#### 探针 5：API Contract Parity
- ❌ API parity check failed: 3 frontend calls have no matching backend endpoint [scope: change-diff]

| 状态 | 前端调用 | 后端端点 | 文件 |
|---|---|---|---|
| ❌ missing | GET /api/daemon/instances | — | frontend/src/lib/daemon/machines.ts:42 |
| ❌ missing | GET /api/daemon/machines | — | frontend/src/lib/daemon/machines.ts:197 |
| ❌ missing | DELETE /api/daemon/machines/{param} | — | frontend/src/lib/daemon/machines.ts:342 |

**人工终审：三条均为提取器前缀口径噪音，非真实 contract gap**。实证：endpoints.json（contract-artifacts/task-02）提取的是 router 相对路径——`GET /machines`、`GET /instances`、`DELETE /machines/{param}` 均在集合内（本报告生成时逐条核对提取产物），与前端全路径 `/api/daemon/machines`（= prefix `/api/daemon` + router 路径）错配；同一路径同时出现在「missing（前端侧）」与「unused（后端侧）」两侧即口径错配的自证。三条全为**既有端点的既有调用**（/runtimes 页存量功能，非本变更引入）；本变更新增的前端两调用（/logs、/config）未出现在 missing 列表（真实命中）。判 PASS，不构成 FAIL。
「6 个本变更端点未调用」warning 同源（prefix 错配致字面不匹配），同判噪音。

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录（+1919/-4，-4 全为行级修改）

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面）——字段契约由 QA 三跳核验覆盖（diag-rpc.ts ↔ schema.py ↔ api-types.ts 逐字一致）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件）——权限守卫由 pytest 验证（admin 放行/非 admin 403/参数校验 Query ge/le）
#### 探针 10：预填注清零（error 门）
- ✅ 预填注清零（4 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml）
#### 探针 12：UI 视觉证据（分级门）
- ⚠️ 变更目录缺 visual-evidence.md → 已补落盘（visual-evidence.md：UI 面=机器卡两按钮+诊断弹窗双 Tab，对照原型 prototype-daemon-log-config-view.html 的实现说明与人工验收步骤；真机渲染截图随移交项人工验收时补充）

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]

| 端点 | 判定 | 用例依据 ID | 结果 | 证据 |
|---|---|---|---|---|
| GET /api/daemon/machines/{instance_id}/logs | covered-service | design接口表#GET /api/daemon/machines/{instance_id}/logs | 200/504×2/422/502/403 全映射验证通过 | design接口表#GET /api/daemon/machines/{instance_id}/logs；`backend/tests/modules/daemon/test_daemon_machine_diag.py:113-160`（成功+参数透传）、`:195-246`（错误映射） |
| GET /api/daemon/machines/{instance_id}/config | covered-service | design接口表#GET /api/daemon/machines/{instance_id}/config | 同上 | design接口表#GET /api/daemon/machines/{instance_id}/config；`backend/tests/modules/daemon/test_daemon_machine_diag.py:162-193`（成功+reveal 透传）、`:222-234`（422） |
| GET /api/daemon/machines/{instance_id}/logs（重复行） | covered-service | design接口表#GET /api/daemon/machines/{instance_id}/logs | 同上（CLI 解析重复，同端点同证据） | design接口表#GET /api/daemon/machines/{instance_id}/logs；`backend/tests/modules/daemon/test_daemon_machine_diag.py:113-160`、`:195-246` |
| GET /api/daemon/machines/{instance_id}/config（重复行） | covered-service | design接口表#GET /api/daemon/machines/{instance_id}/config | 同上（CLI 解析重复） | design接口表#GET /api/daemon/machines/{instance_id}/config；`backend/tests/modules/daemon/test_daemon_machine_diag.py:162-193`、`:222-234` |

↳ 前端消费端：`frontend/src/components/daemon/__tests__/daemon-diagnostic-dialog.test.tsx`（mock 网络层承接 UI 消费行为）；真机调用面移交项 manual-acceptance。

## 测试结果 [层：确定性检查——CLI 实测对账]

| 套件 | 命令 | 结果 |
|---|---|---|
| backend daemon 域 | `cd backend && uv run pytest tests/modules/daemon -q --no-cov` | 164 passed（含新 11 用例） |
| frontend daemon 组件域+lib+runtimes 页 | `pnpm exec vitest run src/components/daemon src/lib/daemon "src/app/(dashboard)/runtimes"` | 94 文件 1339 passed（含新 8 用例） |
| daemon 诊断 RPC 相关 | `pnpm exec vitest run tests/diag-rpc.test.ts tests/daemon-kind-dispatch.test.ts tests/cli.test.ts` | 64 passed / 8 skipped（含新 12 用例） |
| daemon 全量（task-01 验证期） | `pnpm exec vitest run`（sillyhub-daemon） | 4721 passed / 9 skipped / 2 failed——2 失败与本变更无因果（provider-injection-smoke 主仓同败预存在环境失败；daemon-provider-session-dir-lifecycle 时序 flaky 重跑 3/3 过，A/B 对照实证与 daemon.ts 改动无因果） |
| 类型/静态 | `pnpm typecheck`（daemon）+ `pnpm exec tsc --noEmit`（frontend）+ `ruff check`（backend） | 全部 0 错误/通过 |

known_failures 豁免：daemon 全量 2 失败属既有环境性/flaky（上表已注明证据），非本变更引入。

## 决策追踪矩阵 [层：人工判断]

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | （superseded） | — | 被 D-001@v2 取代，无下游引用 | superseded（非风险） |
| D-002@v1 | FR-01、FR-02 | task-01、task-02、task-03 | sillyhub-daemon/src/diag-rpc.ts:24-27（双上限）+ 弹窗行数/刷新 | 已闭环 |
| D-003@v1 | FR-01~FR-05 | task-03 | 只读 Tag + 下载按钮（无编辑入口） | 已闭环（下载口径 D-007 细化） |
| D-004@v1 | FR-01~FR-08 | task-01、task-02 | 三端链路实现（daemon RPC→backend 转发→前端弹窗） | 已闭环 |
| D-005@v1 | （rejected 防复潮） | — | decisions.md 否决登记（复潮条件在档） | 防复潮记录（无闭环义务） |
| D-006@v1 | （rejected 防复潮） | — | 同上 | 防复潮记录（无闭环义务） |
| D-001@v2 | FR-03、FR-04 | task-01、task-03 | diag-rpc.ts:36,54-57 + 测试 :139-162；弹窗掩码/明文切换 | 已闭环 |
| D-007@v1 | FR-05 | task-03 | dialog.tsx:170-177（maskedCfg）+ 测试 :253-277（明文态下载断言脱敏） | 已闭环 |
| D-008@v1 | （执行期路径裁决） | task-02 | backend/tests/modules/daemon/test_daemon_machine_diag.py 实际路径 | 已闭环 |

## 技术债务 [层：人工判断]

无新增 TODO/FIXME/HACK（探针 1 ✅ 零命中）。无测试债（探针 7 矩阵无 uncovered）。留债说明：401/403/404 前端无独立用例（与 504 共用 classifyError→error 通用条代码路径，504 用例已覆盖该分支——QA 认定可接受留白）。

## 变更风险等级 [层：人工判断]

integration-critical——跨进程三端链路（daemon WS RPC ↔ backend FastAPI ↔ 前端弹窗），组件级单测全绿 ≠ 跨进程组装正确；真机冒烟移交项已列。design.md frontmatter 无显式 risk_level 声明。非 deployment-critical（不触碰部署编排/基础设施）。

## Runtime Evidence [层：人工判断]

- commit 链：worktree 分支 4 提交（bef6fbf0 daemon / a21f1be9 backend / 21948f14 frontend / 70b926db docstring）→ assess SAFE 自动 apply → 主仓 b73b18adf（2026-10-13，hook 检查通过）。
- 端点装配：backend/app/modules/daemon/router/__init__.py:173-174 两条目 + 启动集合相等校验（backend 测试 import app 即验证，pytest 164 绿含此面）。
- 类型装配：backend/openapi.json（dump_openapi.py 541 paths 含新两路径）→ pnpm gen:types → frontend/src/lib/api-types.ts:15149-15531 两 schema → 弹窗 import（tsc 0 错）。
- daemon 运行分支：daemon_log_tail 文件不存在分支（exists:false 五字段兜底，单测 sillyhub-daemon/tests/diag-rpc.test.ts:66-77 锁定）；老 daemon method_not_found→422（backend pytest :222-234 锁定）；RPC 注册经 ws.registerRpcHandler 与既有 84 端点同通道（daemon.ts:6789）。
- 失败模式排除：日志正被写入读到半行（tail 语义接受，R-05）；UTF-8 块边界残缺（丢不完整首行，单测 :90-105 中文用例）；大文件超时（字节上限+30s RPC 超时+504 前端提示）。
- 不涉及：DB 迁移、Redis、部署编排、心跳协议（零改动）。
- 真机跨进程运行（起三服务走弹窗）——移交项 manual-acceptance（daemon 需重新构建分发后新 RPC 生效）。

## 代码审查 [层：人工判断]

走查清单（零覆盖路径定向走查）：
① 编辑/更新链路：本变更全只读（两 GET + 弹窗展示），无编辑链路 N/A。
② 非主分支流：reveal 切换的「隐藏明文」恢复分支用掩码缓存（QA 偏差①已核）；truncated/exists:false/422 分支均有测试。
③ 守卫一致性：两端点与既有 machines 端点（cleanup/self-update 等）同 RuntimeAdminUser + _get_owned_instance 模式（QA 锚点 machines.py:673,691,716），无越权面。
④ 载荷字段契约：三跳逐字一致（QA 必查 1，file:line 锚点在 execute review.json）。
⑤ 分页/并发/事务：无分页无事务；并发写日志半行场景 R-05 接受；前端弹窗并发拉取（切 Tab 快速点击）由 loading 状态与幂等 GET 天然安全。
总体评价：无 P1/P2 问题；P3 级建议 0 项（docstring 不同步已在 execute step 9 修复 70b926db）。

## 独立复核（可选回流槽） [层：人工判断——复核后追加]

execute 阶段 QA 独立子代理审查（reviewType=acceptance，11 次调用预算）已回流：12 项 checklist 全 pass、2 处合理偏差、无 P1/P2/P3 修复项（docstring 修正已执行）。无二次复核。
