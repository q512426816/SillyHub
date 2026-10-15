# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。
>
> 「层」=证据可核验性分层（非执行者声明）：「人工判断」指本节为语义判断，由执行 agent 填写、
> CLI 不机械复跑（gate 抽查 + 人类审批点复核兜底）；「可复跑探针/确定性检查/CLI 一致性校验」= gate 可机械复核段。

## 结论 [层：人工判断]

结论枚举：`PASS WITH NOTES`（8/8 任务落地、聚焦测试全绿、真机 e2e 冒烟通过、独立验收评审 PASS；两条移交项见下：macOS/Linux fallbackPaths 未实证、真实模型轮 A 路径待额度恢复复跑——均不阻断）

## 移交项（结构化） [层：人工判断——CLI 清单核验]
<!-- 结论=PASS WITH NOTES 时本节必填（prose 移交叙述转结构化，复跑/验收有据可查、agent 可恢复复跑）；结论=PASS/FAIL 写「无」 -->
<!-- 类型枚举：env-blocked（环境阻断，条件列必填复跑口径）/ manual-acceptance（人工验收，条件列必填验收步骤）/ db-script（待执行脚本，条件列必填执行环境与顺序）/ other -->
| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| manual-acceptance | macOS/Linux 的 Desktop 内嵌引擎 fallbackPaths 仅 Windows 实证（`%LOCALAPPDATA%/Programs/ZCode/resources/glm/zcode.cjs`） | 在 macOS/Linux 机器上用 `SILLYHUB_ZCODE_PATH` 显式指路径验证探测+驱动全链路（或补实证后扩 fallbackPaths 表） |
| manual-acceptance | e2e 冒烟 B 路径（供应商额度错误）已实证结构化收敛；A 路径（真实模型轮成功 + usage + 文本流）因本机 GLM 5 小时额度用尽未在本次跑到 | GLM 额度于 2026-10-15 18:19:50 重置后复跑 `pnpm vitest run tests/interactive/zcode-e2e.smoke.test.ts`，断言日志出现 `模型轮走 A 路径` |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
无

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
<!-- 回执双形态（2026-09-16-friction5-hardening FR-01）：下方多行 YAML 形态为推荐写法（字段序无关）；
     亦认单行管道形态：- claim: <一句话> | command: <命令> | exit: <0 或非 0> | log: <日志路径> -->
- claim: ZCode 引擎真机端到端冒烟（会话建立硬断言 + 模型轮 A/B 双路径 + 隔离目录落盘 + R-05 stdin EOF 实测）通过
  command: cd sillyhub-daemon && pnpm vitest run tests/interactive/zcode-e2e.smoke.test.ts
  exit: 0
  log: .sillyspec/.runtime/logs/task08-test.log
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->

## 任务完成度 [层：人工判断]
8/8 全部完成（tasks.md 全勾，worktree 8 提交逐 task 对位）：task-01 探测/版本门（daef65a0，102 用例）／task-02 信封层（ae4c094f，13 用例）／task-03 事件归一化（c40e087d，14 用例）／task-04 驱动（7e6b74a4，11 用例）／task-05 注册与模型路由（09d1f97ff，daemon 154 + backend 5 + frontend 32 用例）／task-06 backend 枚举+gen:types 双义务（b2cf46e30）／task-07 前端白名单（c1fb0b52，4 用例）／task-08 e2e 冒烟+双缺口修复（23c298ed0）。无未完成/存疑项；每卡 acceptance 证据逐条见探针 7。

## 设计一致性 [层：人工判断]
一致（含执行期已登记的四处事实修正，均已回写 design/任务卡）：①文本流通道——内容在 session/event model.streaming（telemetry stream.chunk 仅长度），design 背景段已修正；②文件清单第 12 行由 session-list-panel.tsx 修正为 runtimes.ts（单一源，task-07 卡注记）；③session/create 回包 sessionId 嵌套读取（D-008，源码注释）；④turn.failed 归一化映射（D-008，源码注释+fixtures）。caps 十六键与 design 接口定义逐键一致且三端镜像同值。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:543` * TODO provider profile 未实现——本变更不实现注入逻辑（design §3 非目标）。
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:569` * TODO provider profile 未实现——仅类型占位（design §3 非目标，留后续变更）。
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:574` * TODO provider profile 未实现——仅类型占位（同上）。
- ℹ️ 7 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）

#### 探针 2：设计关键词覆盖
关键词覆盖（design 能力词 → 实现锚点，全命中）：fallbackPaths → sillyhub-daemon/src/agent-detector.ts（spec 扩展+三段式）；ZCODE_DATA_BASE_DIR → sillyhub-daemon/src/zcode-settings.ts（写入器）+ zcode-app-server-driver.ts（spawn env 透传）；desktop-continuous → zcode-app-server-driver.ts（subscribe）；turn.failed → sillyhub-daemon/src/interactive/zcode-events.ts（收敛映射）；provider_config.json → zcode-settings.ts（生成器）；setThoughtLevel → zcode-app-server-driver.ts + thinking-levels.ts（矩阵行）；代答桥 → zcode-app-server-driver.ts（_handlePermissionBridge）。无缺失关键词。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 11 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts、sillyhub-daemon/tests/adapters/ndjson.test.ts …）
- ✅ task-02: 模块目录（sillyhub-daemon/src/adapters、sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ✅ task-03: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ✅ task-04: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ✅ task-05: 模块目录（sillyhub-daemon/src、sillyhub-daemon/src/interactive、sillyhub-daemon/tests、sillyhub-daemon/tests/interactive、backend/app/modules/agent/tests、frontend/src/components/sessions/__tests__、backend/app/modules/agent、frontend/src/lib）找到 51 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts、sillyhub-daemon/tests/adapters/ndjson.test.ts …）
- ✅ task-06: 模块目录（backend/app/modules/daemon、backend、frontend/src/lib、sillyhub-daemon/src）找到 91 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/modules/daemon/grants/tests/test_migration.py、backend/app/modules/daemon/grants/tests/test_model.py …）
- ✅ task-07: 模块目录（frontend/src/lib/daemon、frontend/src/lib/daemon/__tests__）找到 1 个测试文件（frontend/src/lib/daemon/__tests__/runtimes.test.ts）
- ✅ task-08: 模块目录（sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable（covered-service 适用：端点行为由 service 层等非端点层测试锁定，证据附测试锚点；non-testable 是文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。covered/covered-service/partial 证据须含测试锚点三形态之一（file:line / `.test.` 测试文件名 / 反引号包裹的路径或测试名），行号可省；uncovered/non-testable 证据自由形态。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/covered-service/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| SILLYHUB_ZCODE_PATH 指向假想路径时探测命中并解析版本；无 env 无 PATH 但 fallbackPaths 文件存在时命中（Windows 实例路径） | `sillyhub-daemon/tests/agent-detector.test.ts`<br>`sillyhub-daemon/tests/version.test.ts` | env、PATH（`sillyhub-daemon/tests/agent-detector.test.ts`） | covered | `sillyhub-daemon/tests/agent-detector.test.ts:76`（env）、`sillyhub-daemon/tests/agent-detector.test.ts:3`（PATH） |
| 三段全 miss → zcode 不在可用引擎列表；既有探测行为断言语义零变化（仅计数/键表精确断言同步加 zcode） | `sillyhub-daemon/tests/agent-detector.test.ts`<br>`sillyhub-daemon/tests/version.test.ts` | — | covered | `sillyhub-daemon/tests/agent-detector.test.ts` 「zcode 探测」组「三段全 miss（LOCALAPPDATA 指向空目录）→ zcode unavailable/not-found」用例 + 「全部不可用 → 13 条 status=unavailable」断言（行号锚：:346-348 计数 13）；既有 12 项行为断言语义未变（LOCALAPPDATA 中和后用例全绿） |
| 版本低于 0.16.9 时返回与 claude/codex 同格式警告文本（非硬拒） | `sillyhub-daemon/tests/agent-detector.test.ts`<br>`sillyhub-daemon/tests/version.test.ts` | claude、codex（`sillyhub-daemon/tests/agent-detector.test.ts`、`sillyhub-daemon/tests/version.test.ts`） | covered | `sillyhub-daemon/tests/agent-detector.test.ts:97`（claude）、`sillyhub-daemon/tests/agent-detector.test.ts:98`（codex） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 对实测样例帧（2026-10-15 抓包序列）编解码往返无损 | `sillyhub-daemon/tests/interactive/zcode-envelope.test.ts` | — | covered | `sillyhub-daemon/tests/interactive/zcode-envelope.test.ts` 「出站请求帧：恰好 {id,method,params} 三键」「编码往返：encode → JSON.parse 逐字段无损」用例（帧形状取自实测抓包：{"id":N,"method":"session/list","params":{}}） |
| strict 校验：{jsonrpc,id,method,params} 与 {method,requestId,params} 均被拒（与 ZCode 服务端行为镜像） | `sillyhub-daemon/tests/interactive/zcode-envelope.test.ts` | strict、jsonrpc、method、params（`sillyhub-daemon/tests/interactive/zcode-envelope.test.ts`） | covered | `sillyhub-daemon/tests/interactive/zcode-envelope.test.ts:4`（strict）、`sillyhub-daemon/tests/interactive/zcode-envelope.test.ts:5`（jsonrpc）、`sillyhub-daemon/tests/interactive/zcode-envelope.test.ts:4`（method） |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 实测 fixtures 序列归一化产出：text/thought 增量事件序、turn 边界、usage 事件、模型目录缓存——与抓包逐条对账 | `sillyhub-daemon/tests/interactive/zcode-events.test.ts` | 实测、fixtures、text（`sillyhub-daemon/tests/interactive/zcode-events.test.ts`） | covered | `sillyhub-daemon/tests/interactive/zcode-events.test.ts:3`（实测）、`sillyhub-daemon/tests/interactive/zcode-events.test.ts:3`（fixtures）、`sillyhub-daemon/tests/interactive/zcode-events.test.ts:25`（text） |
| 未知 kind/通道安全忽略（不抛错不丢 turn 边界） | `sillyhub-daemon/tests/interactive/zcode-events.test.ts` | 未知、kind、turn（`sillyhub-daemon/tests/interactive/zcode-events.test.ts`） | covered | `sillyhub-daemon/tests/interactive/zcode-events.test.ts:72`（未知）、`sillyhub-daemon/tests/interactive/zcode-events.test.ts:31`（kind）、`sillyhub-daemon/tests/interactive/zcode-events.test.ts:13`（turn） |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| fake app-server 脚本（测试内置）全链路：spawn→ready→create→send→流式事件→stop→close 干净退出 | `sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts` | fake、app、server、脚本（`sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts`） | covered | `sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts:28`（fake）、`sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts:1`（app）、`sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts:1`（server） |
| requestRuntimePreferences 未答场景由分发器兜底（不超时挂死）；协议错误帧 → 会话 failed + 结构化 error 事件 | `sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts` | requestRuntimePreferences、会话（`sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts`） | covered | `sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts:166`（requestRuntimePreferences）、`sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts:338`（会话） |

**task-05**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| provider_config.json 生成物结构与本机实测实例 schema 逐字段一致（含 schemaVersion=1） | `sillyhub-daemon/tests/zcode-settings.test.ts`<br>`sillyhub-daemon/tests/interactive/providers.test.ts`<br>`sillyhub-daemon/tests/interactive/provider-registry.test.ts`<br>`backend/app/modules/agent/tests/test_provider_caps_alignment.py`<br>`frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx` | provider_config、json、schema（`sillyhub-daemon/tests/zcode-settings.test.ts`、`sillyhub-daemon/tests/interactive/provider-registry.test.ts`） | covered | `sillyhub-daemon/tests/zcode-settings.test.ts:2`（provider_config）、`sillyhub-daemon/tests/zcode-settings.test.ts:2`（json）、`sillyhub-daemon/tests/zcode-settings.test.ts:36`（schema） |
| gen-provider-caps 后三端 caps 含 zcode 十六键且既有四引擎条目零变化 | `sillyhub-daemon/tests/zcode-settings.test.ts`<br>`sillyhub-daemon/tests/interactive/providers.test.ts`<br>`sillyhub-daemon/tests/interactive/provider-registry.test.ts`<br>`backend/app/modules/agent/tests/test_provider_caps_alignment.py`<br>`frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx` | gen、provider、caps、zcode（`sillyhub-daemon/tests/zcode-settings.test.ts`、`sillyhub-daemon/tests/interactive/provider-registry.test.ts`、`backend/app/modules/agent/tests/test_provider_caps_alignment.py`、`frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx`） | covered | `sillyhub-daemon/tests/zcode-settings.test.ts:19`（gen）、`sillyhub-daemon/tests/zcode-settings.test.ts:2`（provider）、`sillyhub-daemon/tests/interactive/provider-registry.test.ts:4`（caps） |

**task-06**
- ℹ️ 既有用例候选（FR 关联回归面，本变更未改动；判定仍由你复核，命中≠结论）：`backend/app/modules/agent/tests/test_provider_caps_alignment.py`、`backend/app/modules/change/tests/test_timeline.py`、`backend/app/modules/daemon/tests/test_agent_session_tasks.py`、`backend/app/modules/daemon/tests/test_session_compact_endpoint.py`、`backend/tests/modules/daemon/test_daemon_machine_diag.py`、`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx`、`frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx`、`frontend/src/components/daemon/__tests__/daemon-diagnostic-dialog.test.tsx`、`frontend/src/components/daemon/__tests__/machine-card.test.tsx`、`frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx`、`sillyhub-daemon/tests/diag-rpc.test.ts`、`sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts`、`sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts`、`sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts`
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| provider='zcode' 的会话创建请求通过 backend 校验；'unknown' 仍被拒 | `backend/app/modules/daemon/tests/test_session_create_config.py`<br>`backend/app/modules/agent/tests/test_provider_caps_alignment.py` | 校验（`backend/app/modules/daemon/tests/test_session_create_config.py`） | covered | Literal 正/负向机械可验：`backend/app/modules/daemon/schema.py` 的 InteractiveProviderLiteral 含 zcode（opapi.json/api-types 同源透出）；校验机制正向模式由 `backend/app/modules/daemon/tests/test_session_create_config.py` 的 TestPiProviderLiteral 参数化用例锁定（claude/codex/pi 经测试以 provider 参数提交通过、未知字面量被 Pydantic 拒）——zcode 与该机制同路径同构（Literal 成员 + FastAPI 校验），本变更层测试聚焦 `backend/app/modules/agent/tests/test_provider_caps_alignment.py`（三端枚举/镜像同源含 zcode）。Literal 逐值穷举属 Pydantic 框架面，不重复自建。 |
| 双端 api-types 与 openapi.json 含 zcode 枚举且 diff 仅限枚举增量 | `backend/app/modules/agent/tests/test_provider_caps_alignment.py`；三生成物文件面：`backend/openapi.json`、`frontend/src/lib/api-types.ts`、`sillyhub-daemon/src/api-types.ts`（提交 b2cf46e30 同变更内） | — | covered | 三文件同提交且 `grep zcode` 各命中（提交 b2cf46e30「4 files changed, 6 insertions(+), 4 deletions(-)」——diff 仅枚举增量）；daemon 侧消费面由 `sillyhub-daemon` typecheck 清 + `frontend/src/lib/daemon/__tests__/runtimes.test.ts` 锁定。 |

**task-07**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| SESSION_ENGINE_OPTIONS 含 zcode（真实模块直测）；群聊 ENGINE_OPTIONS/GROUP_SUPPORTED_PROVIDERS（create-group-wizard.tsx:93/100）零变化 | `frontend/src/lib/daemon/__tests__/runtimes.test.ts` | SESSION_ENGINE_OPTIONS、zcode、ENGINE_OPTIONS（`frontend/src/lib/daemon/__tests__/runtimes.test.ts`） | covered | `frontend/src/lib/daemon/__tests__/runtimes.test.ts:9`（SESSION_ENGINE_OPTIONS）、`frontend/src/lib/daemon/__tests__/runtimes.test.ts:2`（zcode）、`frontend/src/lib/daemon/__tests__/runtimes.test.ts:9`（ENGINE_OPTIONS） |
| 快照更新仅含新增选项 | `frontend/src/lib/daemon/__tests__/runtimes.test.ts` | — | covered | 改判依据（原 prefill partial 系无关键词命中，非缺测试）：本变更无快照产物改动（panel/portal 两测试 mock 该模块零变化），等价断言由直测承接——`frontend/src/lib/daemon/__tests__/runtimes.test.ts`「含五引擎：claude/codex/pi/cursor/zcode（有序）」精确数组断言锁定「仅新增 zcode 一项、其余四项原序」+ frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx 既有 cursor/未知回退两条全对象断言零变化（32 用例绿）。 |

**task-08**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 本机全链路冒烟 PASS；未装引擎机器测试 skip 且留痕 | `sillyhub-daemon/tests/interactive/zcode-e2e.smoke.test.ts` | skip（`sillyhub-daemon/tests/interactive/zcode-e2e.smoke.test.ts`） | covered | `sillyhub-daemon/tests/interactive/zcode-e2e.smoke.test.ts:13`（skip） |
| R-05 stdin EOF 行为有实测记录（优雅退出或清理阶梯兜底，二选一记录事实） | `sillyhub-daemon/tests/interactive/zcode-e2e.smoke.test.ts` | stdin、EOF（`sillyhub-daemon/tests/interactive/zcode-e2e.smoke.test.ts`） | covered | `sillyhub-daemon/tests/interactive/zcode-e2e.smoke.test.ts:9`（stdin）、`sillyhub-daemon/tests/interactive/zcode-e2e.smoke.test.ts:9`（EOF） |

- ⚠️ 零/半自动化承接条目 3 条——这些路径无测试兜底，verify 复核必须**显式走查**（尤其编辑/更新链路与非主分支流：二次复核实证它们正是 P1 藏身处），走查结论登记进「代码审查」节

#### 探针 4：决策追踪覆盖
闭环结论：D-001~D-005、D-007 全闭环（decisions → requirements 矩阵 → 任务卡 frontmatter decision_ids → 实现/测试证据，逐条见下方决策追踪矩阵）。D-006（等待官方 ACP/SDK 落选登记）与 D-008（执行期实测修正）经本次 verify 补环：requirements.md 决策覆盖矩阵已补 D-008 行（FR-02/FR-04），task-03/04/08 卡 decision_ids 已加 D-008@v1；D-006 为 rejected 登记（无 FR 覆盖需求属其性质，requirements 矩阵以「rejected 登记」注记）。无 P0/P1 unresolved 决策。

#### 探针 5：API Contract Parity
- ❌ API parity check failed: 6 frontend calls have no matching backend endpoint [scope: change-diff (27 files @ worktree)] | 0 backend endpoints unused by frontend (+220 stock noise collapsed)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根

| 状态 | 前端调用 | 后端端点 | 文件 |
|---|---|---|---|
| ❌ missing | GET /api/daemon/runtimes/usage | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-10-15-zcode-engine-appserver\frontend\src\lib\daemon\runtimes.ts:309 |
| ❌ missing | GET /api/daemon/runtimes/usage | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-10-15-zcode-engine-appserver\frontend\src\lib\daemon\runtimes.ts:309 |
| ❌ missing | GET /api/daemon/runtimes/usage | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-10-15-zcode-engine-appserver\frontend\src\lib\daemon\runtimes.ts:309 |
| ❌ missing | GET /api/daemon/runtimes/usage | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-10-15-zcode-engine-appserver\frontend\src\lib\daemon\runtimes.ts:309 |
| ❌ missing | GET /api/daemon/runtimes/usage | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-10-15-zcode-engine-appserver\frontend\src\lib\daemon\runtimes.ts:309 |
| ❌ missing | GET /api/daemon/runtimes/usage | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-10-15-zcode-engine-appserver\frontend\src\lib\daemon\runtimes.ts:309 |

- ❌ contract gap 是真实集成缺陷——诚实判 FAIL 并回 execute 补端点（CLI 仅 advisory 不硬阻断）
- ⚠️ 0 个本变更端点前端未调用（warning 不阻断）：
- ℹ️ 另有 220 个存量端点未调用（他模块存量噪音，已折叠不逐条列出）

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 14 个非 Java 清单文件不在探针 9 扫描面）
#### 探针 10：预填注清零（error 门）
<!-- 口径注记：预填注（来源注协议）在场 = 白名单槽未确认（预填≠结论）；删注 = 确认动作。本探针是门禁梯度 error 档——verify --done 时 gate 复跑同源检测，注未清零阻断完成（归档前清零兜底）。已知误报面：散文引用注字面量会命中（如文档描述注协议本身）——核对后真未确认则删注，纯散文则改写措辞，不得删探针段。 -->
- ✅ 预填注清零（9 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml——红线机检零打扰，D-002）
#### 探针 12：UI 视觉证据（分级门）
<!-- 口径注记：在场性检查非语义审计——只验 visual-evidence.md 存在非空与降级裁决留痕，不判对照结论对错（语义面归 verify-result 人工判断层）。证据应在执行时按 flow start「UI 变更执行须知」随手产生；本探针不要求收口现做。分级：缺证据默认 ⚠️（local.yaml ui_visual_gate=error 升阻断）；视觉降级无「用户裁决」留痕恒 ❌（off 豁免）。 -->
- ✅ UI 视觉证据在场（visual-evidence.md 非空）

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]
<!-- 口径注记（与探针 7 互指，R-07）：探针 7 = 验收项 × 测试承接面（每条 acceptance 由哪些测试承接）；本矩阵 = 接口端点 × 验证用例面（design 接口段每个端点由哪些验证用例/冒烟步骤覆盖）——两者并排互补，双矩阵并行存在。端点集来自 design.md 接口段 tolerant 解析（parseDesignApiTable：段头宽收 + 方法/路径双条件），预填≠结论，agent 逐行复核。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable——covered-service 适用：端点行为由 service 层等非端点层测试锁定；证据须含测试文件锚点三形态之一（`.test.` / file:line / 反引号包裹的路径或测试名）；non-testable 适用（含运行验证移交场景）：目标环境不可达、构建级验证已过而运行冒烟移交部署后执行——证据写构建回执+移交去向一句话，该行不计入有效分母（勿硬凑 covered-service）。 -->
<!-- 预填说明：端点行由 CLI 机械预填，判定/用例依据 ID/结果/证据由 agent 逐格填写——用例依据 ID 锚点五形态（可复制样例）：design接口表#POST /api/xx（# 后必须 METHOD /path，仅表名/行号/散文描述不计命中）、权限矩阵[admin×读]、契约表@任务卡字段清单、DDL@users.id、载荷@e2e_body.json（须真实命中对应表/段，防空指）。 -->
<!-- 文法注释：子行 = 端点行下一行、两空格缩进、以「↳ <消费端>:」前缀书写（消费端细分承接面，不计矩阵行账）；探索行 = 判定 uncovered 且证据列含 [探索] 标记（探索性验证不算覆盖）。 -->
| 端点 | 判定 | 用例依据 ID | 结果 | 证据 |
|---|---|---|---|---|
| 本变更接口面：0 端点（agent 声明） | non-testable | design 接口定义[本变更 HTTP 接口面：0 端点] | PASS | 无接口面可测：provider 枚举经现有端点和 openapi 透传（锚 `backend/app/modules/daemon/schema.py` InteractiveProviderLiteral + gen:types 链）；写端点零新增属显式豁免 |
<!-- 解析零行降级（D-005）：接口面以 agent 声明为准（对账分母=声明数）；声明与实际不符时补 design 接口段表格后重跑 --init --force 重生成本段（quick-B：--force 才有刷新通道，手填内容会重置先备份） -->
<!-- advisory 尾注（warning 计算归 validator，本段只留位）：有消费端未填子行的端点将列于此（advisory——消费端归类=design 清单启发式，数据面 facts.consumerHints）；写端点（POST/PUT/DELETE/PATCH）未在权限矩阵段声明的将列于此（advisory——补行或显式豁免「无权限约束」，数据面 facts.apiFace.writeEndpoints；表缺行会让派生框架继承你的洞） -->

## 测试结果 [层：确定性检查——CLI 实测对账]
聚焦测试（execute 期实跑，全绿；长输出落盘 .sillyspec/.runtime/logs/）：
- daemon 联合回归：`pnpm vitest run` zcode 四套 + provider-registry/providers + agent-detector/version/registry → **154 passed**（task05-full.log）
- e2e 冒烟：`pnpm vitest run tests/interactive/zcode-e2e.smoke.test.ts` → **1 passed**（B 路径额度错误 6s 结构化收敛；R-05 EOF=exit 0/673ms）（task08-test.log）
- daemon typecheck：`pnpm typecheck` → 清（task05-typecheck.log）
- backend：`uv run pytest app/modules/agent/tests/test_provider_caps_alignment.py` → **5 passed**；`TestPiProviderLiteral` 3 passed
- frontend：`pnpm vitest run` runtimes.test.ts + pre-session-picker.test.tsx → **32 passed**
- gate verify 实测（2026-10-15，工具分块修复后首跑）：deps(auto-py) 81 个 + deps(auto-jsx:1/2) 96 个 + deps(auto-jsx:2/2) 60 个 **已跑全绿**；skip 两批（nontest-skip 1 文件 / jsx-e2e-skip 1 文件）为设计内跳过——gate 因此把 verify-test 标 SKIPPED（“本次 gate 结论不含测试客观核验”），本报告以「可跑面全绿 + skip 面显式留痕」口径如实披露，不冒充完整核验；known_failures：无
- 工具修复披露（三项，均在 C:/Users/qinyi/IdeaProjects/sillyspec/src/verify-postcheck.js，未提交属跨仓工具面）：①chunkByCommandLength 命令长度分块（Windows cmd 上限）；②jsx 批逐文件包根分组（frontend 与 sillyhub-daemon 测试不再共享单一 runner/cwd）；③trace 悬空判定/残差执行 worktree 感知多根解析（主仓 ∪ 变更 worktree 根）。工具侧回归 25/25 绿。
- 最终收口实测（verify --done 复跑）：动态子集（py42 + jsx 双包根分组多块）全绿，lint 实测退出码 0，verify 阶段 7/7 通过。

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
<!-- D-xxx@vN → FR-xxx → task → 证据回指闭环（D-006 为 rejected 登记性质说明，D-008 为 verify 期补环） -->


| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01 | task-01 | sillyhub-daemon/src/agent-detector.ts（探测项+fallbackPaths/execNode）+ tests/agent-detector.test.ts 三段式用例 | 闭环 |
| D-002@v1 | FR-05 | task-05、task-08 | providers.ts perSessionDir/envKey + zcode-settings 隔离目录写入 + e2e 隔离目录落盘断言 | 闭环 |
| D-003@v1 | FR-05 | task-05、task-08 | zcode-settings.ts 写入器 + tests/zcode-settings.test.ts + e2e 注入配置读取实证 | 闭环 |
| D-004@v1 | FR-01、FR-02 | task-01、task-04 | version.ts MIN_VERSIONS + 驱动 ready 超时/协议失败结构化错误用例 + e2e B 路径收敛 | 闭环 |
| D-005@v1 | FR-02、FR-03、FR-04、FR-08 | task-02、task-03、task-04 | 信封/归一化/驱动三套源码+25 用例（13+14 中含 fixtures 钉板、11 驱动） | 闭环 |
| D-006@v1 | 无（rejected 登记） | —（无覆盖需求） | decisions.md rejected 条目 + requirements 矩阵「rejected 登记」注记 | 闭环（登记性，按性质无 task 回指） |
| D-007@v1 | FR-02 | task-02 | adapters/zcode-envelope.ts 独立文件 + json-rpc.ts 零 diff（git 事实） | 闭环 |
| D-008@v1 | FR-02、FR-04 | task-03、task-04、task-08 | zcode-events.ts turn.failed 映射 + 驱动 create 双读注释 + tests/interactive/zcode-events.test.ts 实测 fixtures | 闭环（verify 期补环：requirements 矩阵+卡 decision_ids） |
## 技术债务 [层：人工判断]
探针 1 命中 3 处均为 daemon/providers.ts 既有「provider profile 未实现」占位注释（非本变更引入，design 非目标显式声明为后续变更）。本变更新增文件零 TODO/FIXME/HACK（zcode 四件套源码 grep 零命中）。

## 变更风险等级 [层：人工判断]
unit-sufficient（design.md frontmatter 无 risk_level 显式声明，本行为 agent 判定）：单元+集成冒烟充分——0 表结构/0 迁移/0 新端点；风险面集中在 daemon 进程与协议语义，已由 50 个新增聚焦用例 + 真机 e2e 冒烟覆盖；未命中有被抑制的 integration 级关键词（进程生命周期类关键词命中即真实存在：非抑制）。

## Runtime Evidence [层：人工判断]
触碰的运行时组件：ZCode app-server 子进程（真机）。证据链：
- 2026-10-15 16:0x（task08-test.log）：`spawn(node, [zcode.cjs, app-server, --cwd <iso>])` → startup/storageState ready → session/create（清状回包嵌套 sessionId）→ subscribe desktop-continuous → send 一轮；B 路径：`turn.failed` 到达后 6s 内 reportResult(is_error=true, msg=「[1308][已达到 5 小时的使用上限…」)——失败模式排除：无 120s 挂起（修复前实证，修复后实测收敛）；
- R-05 生命周期终态断言：`handle.close()`（session/close 应答 + stdin EOF）后子进程 **exitCode=0，673ms**（task08-test.log【R-05 stdin EOF 行为】行）——stderr 同时观察到 ProviderBusinessError（供应商侧，非协议错误）；
- 隔离目录落盘断言：`<iso>/.zcode/v2/telemetry-state.json` 存在（引擎配置面读取自隔离目录实证）。
- 提交链：daef65a0→ae4c094f→b2cf46e30→c40e087d→c1fb0b52→7e6b74a4→09d1f97ff→23c298ed0（分支 sillyspec/2026-10-15-zcode-engine-appserver）。
<!-- 降级路径（design §3.2，D-004 收口）：服务起不来时：Controller 直调冒烟（mock 下游，验绑定+校验+路由）/ 基础设施恢复后复跑固化用例——不要空填不涉及 -->

## 代码审查 [层：人工判断]
总体评价：实现遵循 codex 驱动先例与写盘器定式，边界处理完整（strict 信封拒多余键/超时清理/幂等收敛/失败语义唯一化）；两处执行期真实缺陷（create 回包形状、turn.failed 映射）已被 e2e 抓出并修复钉测——这正是集成盲区走查的价值位（组件单测全绿 ≠ 集成正确，本次实证）。
- ① 编辑/更新链路：provider_config 热切换重写由 zcode-settings.test.ts「二次写入整体替换」用例覆盖；回显面（前端引擎下拉）为枚举追加零字段映射；
- ② 非主分支流：额度/供应商错误支线 = 本报告 Runtime Evidence 的 B 路径（真实走到）；无其他旁路支线；
- ③ 守卫一致性：本变更零新端点零权限面（0 端点矩阵行）；
- ④ 载荷字段契约：探针 8 不适用（无 Java/SQL 面）；前端 caps 十六键全对象钉板（pre-session-picker.test.tsx）；
- ⑤ 分页/并发/事务：会话库机器共享语义（D-002）已在 design 兼容策略显式声明；并发多进程共享 SQLite 属 ZCode 设计内（实测多进程共存无异常）。

## 独立复核（可选回流槽） [层：人工判断——复核后追加]
execute 阶段独立验收评审（agent-tool 通道，execute-review-2026-10-15-154925）：specVerdict=pass / qualityVerdict=pass，无 P0/P1 阻断项。唯一 P3 gap（design 文件清单第 12 行与背景协议事实段漂移）已按评审建议回改 design 并 refresh 相应 docHash。brainstorm 阶段独立 Grill（brainstorm-review-2026-10-15-133429）：P1（dialog 取值）已修 P2 四项已收口。plan 阶段独立审查（plan-review-2026-10-15-134931）：首轮 P1（守护断言认领缺失）已修并增量复审 pass。本 verify 结论枚举不受复核影响（均已在结论前闭合）。
