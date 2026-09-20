---
author: qinyi
created_at: 2026-09-20 12:46:30
---

# 验证报告 — 2026-09-20-agent-log-session-replay

## 结论

结论枚举：PASS

**PASS**（带环境备注：CLI verify 门沙箱的 4 类伪影行已按 local.yaml known_failures O 组带证据豁免，真实环境全量双绿——见「测试结果」与「Runtime Evidence」）

## 任务完成度

9/9 task 全勾（tasks.md checkbox CLI 自动勾选，依据 execute-runs/exec-2026-09-20-100000-abca1e/tasks/task-01~09/review.json 全部 specVerdict=qualityVerdict=双 pass，base..head 均真实 commit）。分支落地：replay-redo @773b821e8（8 个实现 commit + 收口核验），diff 恰 25 文件与 design §6 清单 1:1（零计划外文件）。

## 设计一致性

决策落地：decisions.md **D-001@v1**（方案 A：TurnTimeline 直适配，用户亲选）已完整落地——回放主体复用 TurnTimeline（对话/全部切换/超长折叠继承），无自造渲染器、无后端 turns 物化（B/C 否决形态未出现）。

acceptance stage review（独立 QA 子代理，docHash 035e2bb4…）九项全 pass：FR-01（TurnTimeline 直适配/page+dialog 双挂载/主子日志结构/多主日志/首屏最早窗口 10 页上限）、FR-02（系统事件两来源归 stderr 首项不占用户气泡/claude-code 对话化/cursor-agent 解析 token 恒缺省）、FR-03（usage/turn_id/model/totalUsage 四层直通零漂移/全量口径归一/老 daemon 缺省未知/切轮三保险）、FR-04（unsupported/parse_error/too_large/422/409/404/5xx 逐条目回落+离线元数据）、契约链一致性、dialog 门控偏离裁定（attach 轮询捕获 origin/turn_count 喂 Gate——与 design §3.3 语义等价且保 R4「dialog 零 react-query」不变式与既有调用计数断言，维持接受）、NFR（双主题 brand 阶零硬编码 hex/api-types 生成物/测试纪律）、非目标边界（未越界）。非目标确认未做：L3 落库、cursor provider 化、cursor IDE store.db 对话化、sillyspec 仓扫描层。

## 探针结果（真实数据集成，2026-09-20 本机只读实证）

| # | 对象 | 结果 |
|---|---|---|
| 1 | 真实 zcode rollout（本会话日志 sess_55ece102…，2.6MB） | parsed；142 段/93 段带 usage；totalUsage {input 5,574,331 · cache_read 5,502,464 · output 11,339}；turn_id 1 个；model=GLM-5.3 ✓ |
| 2 | 真实 db.sqlite 同会话（model_usage/turn_usage 透传） | parsed；892 段/133 段带 usage；totalUsage {input 43,843,561 · output 109,448}——持久库段数（892）远超现存 rollout（142），实证「库优先」设计的价值 ✓ |
| 3 | 真实 claude-code 日志（ddfad2e1…，~2.5MB） | parsed；746 段/skipped 0；127 段 usage；3 条真人 user_input；totalUsage {input 62,404,960 含缓存 61,196,544 · output 326,551}——与 2026-09-19 调研口径吻合 ✓ |
| 4 | 真实 cursor-agent transcript（286d9c3b…） | parsed；47 段（2 user_input+7 reply+38 tool_use）；turn_end 标记 1；totalUsage=undefined（不虚构）✓ |
| 5 | 保留期风险实证（旁证） | 137ddfff 会话主 rollout 与 5 月 cursor transcript 均已被本地清理——回放依赖 db.sqlite/在线机器的设计前提被现实印证 |

## 测试结果

- scoped（task-09 收口）：daemon tests/agent-log 6 文件 **122 passed**；backend platform_sync test_agent_log_messages.py **21 passed**（ruff 三文件过）；前端 3 文件 **57 passed**；frontend/daemon 双 `tsc --noEmit` 零错。
- 真实环境全量（verify 判定补充实证）：**frontend 全量 308 文件 / 4098 测试全绿（136s）**；**daemon 全量 237 文件 / 4376+ passed**（余为 daemon-budget-wiring 60s 超时 flaky，两轮 3→1 漂移、与本变更 25 文件零交集）；backend platform_sync 模块 244 passed（CLI 沙箱实测）。
- CLI verify 门沙箱 4 类伪影行（fallbackNoteForError×2=overlay 混版[HEAD 卡片无导出×分支 replay-body 混排，真实全量 4098 绿证伪]、三类时长超时=junction I/O 抖动、ruff Would reformat=CRLF 拷贝损毁[worktree 实测 already formatted exit 0，lint advisory 留痕]）已按 local.yaml known_failures O 组豁免，每条带证据与复核移除条件。

## 变更风险等级

integration-critical（含 daemon/session 关键词）——Runtime Evidence 见下。风险面：解析器为纯函数加法（可选字段零破坏）；后端 schema 全 Optional 老 daemon 兼容；前端一处破坏性导出移除（AgentLogSessionBody）两个 import 点均在任务内处理且全量前端 4098 绿证零残留。

## Runtime Evidence（integration-critical 自报告，真实执行）

1. **四解析器×真实日志文件端到端**：上表探针 1-4 为 2026-09-20 在本机对四类**现存真实日志**（zcode rollout/db.sqlite/claude-code/cursor-agent）只读实跑解析器的输出，非 fixture——parsed 状态、usage/turn/totalUsage 数值、is_meta/turn_end 行为全部命中设计契约。
2. **真实数据链验证 sqlite>rollout 优先路径**：同会话双源对照（892 段 vs 142 段、43.8M vs 5.57M totalUsage）证明 host-fs-handler 的 zcode sqlite 优先分派在真实库上产出更全的回放数据。
3. **全量套件真实环境双绿**：frontend 4098/daemon 4376+ 在 worktree（=replay-redo 分支同 commit）完整跑过（非抽样），集成面无回归。
4. 未覆盖的真实链路（如实声明）：daemon↔平台的 WS RPC 全链（read_agent_log_messages 经 platform router→daemon→解析器）未在本机起真实 daemon+backend 实测——由 backend pytest（RPC mock 层 21 passed）+ 解析器真数据探针两侧夹逼覆盖，端到端留待部署后人工抽验（137ddfff 同型会话打开回放页）。

## 探针结果（CLI 机械预填，--init 补注入） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ⚠️ `sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts:399` data: j({ type: 'tool', tool: 'Grep', callID: 'call_c3', state: { status: 'running', input: { pattern: 'TODO' } } }),
- ⚠️ `sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts:436` expect(use3).toMatchObject({ kind: 'tool_use', tool_name: 'Grep', tool_use_id: 'call_c3', tool_input: '{"pattern":"TODO"}', tool_result: null, is_error: null })
- ℹ️ 6 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）

#### 探针 2：设计关键词覆盖
<!--TODO: 半语义探针——从 design 提取能力关键词逐个 grep 确认实现（agent 执行）-->

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（sillyhub-daemon/src/agent-log、sillyhub-daemon/tests/agent-log）找到 12 个测试文件（sillyhub-daemon/tests/agent-log/liveness/derive-claude.test.ts、sillyhub-daemon/tests/agent-log/liveness/derive-codex.test.ts、sillyhub-daemon/tests/agent-log/liveness/derive-zcode.test.ts、sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts、sillyhub-daemon/tests/agent-log/liveness/hub-client-states.test.ts …）
- ✅ task-02: 模块目录（sillyhub-daemon/src/agent-log、sillyhub-daemon/tests/agent-log）找到 12 个测试文件（sillyhub-daemon/tests/agent-log/liveness/derive-claude.test.ts、sillyhub-daemon/tests/agent-log/liveness/derive-codex.test.ts、sillyhub-daemon/tests/agent-log/liveness/derive-zcode.test.ts、sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts、sillyhub-daemon/tests/agent-log/liveness/hub-client-states.test.ts …）
- ✅ task-03: 模块目录（sillyhub-daemon/src/agent-log、sillyhub-daemon/tests/agent-log）找到 12 个测试文件（sillyhub-daemon/tests/agent-log/liveness/derive-claude.test.ts、sillyhub-daemon/tests/agent-log/liveness/derive-codex.test.ts、sillyhub-daemon/tests/agent-log/liveness/derive-zcode.test.ts、sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts、sillyhub-daemon/tests/agent-log/liveness/hub-client-states.test.ts …）
- ✅ task-04: 模块目录（sillyhub-daemon/src/agent-log、sillyhub-daemon/tests/agent-log）找到 12 个测试文件（sillyhub-daemon/tests/agent-log/liveness/derive-claude.test.ts、sillyhub-daemon/tests/agent-log/liveness/derive-codex.test.ts、sillyhub-daemon/tests/agent-log/liveness/derive-zcode.test.ts、sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts、sillyhub-daemon/tests/agent-log/liveness/hub-client-states.test.ts …）
- ✅ task-05: 模块目录（sillyhub-daemon/src/agent-log、sillyhub-daemon/src、sillyhub-daemon/tests/agent-log）找到 13 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/agent-log/liveness/derive-claude.test.ts、sillyhub-daemon/tests/agent-log/liveness/derive-codex.test.ts、sillyhub-daemon/tests/agent-log/liveness/derive-zcode.test.ts、sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts …）
- ✅ task-06: 模块目录（backend/app/modules/platform_sync、backend/app/modules/platform_sync/tests、backend、frontend/src/lib）找到 88 个测试文件（backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py、backend/app/modules/platform_sync/tests/test_agent_liveness_states_migration.py、backend/app/modules/platform_sync/tests/test_agent_log_attribution.py、backend/app/modules/platform_sync/tests/test_agent_log_content.py、backend/app/modules/platform_sync/tests/test_agent_log_messages.py …）
- ✅ task-07: 模块目录（frontend/src/lib、frontend/src/lib/__tests__）找到 21 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/change-autolink.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts …）
- ✅ task-08: 模块目录（frontend/src/components/daemon、frontend/src/components/daemon/__tests__、frontend/src/components/daemon/session-panel）找到 11 个测试文件（frontend/src/components/daemon/__tests__/activity-catalog.test.tsx、frontend/src/components/daemon/__tests__/agent-log-card.test.tsx、frontend/src/components/daemon/__tests__/agent-replay-body.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card.test.tsx …）
- ✅ task-09: 模块目录（sillyhub-daemon/src/agent-log、sillyhub-daemon/src、backend/app/modules/platform_sync、backend、frontend/src/lib、frontend/src/components/daemon、frontend/src/components/daemon/session-panel）找到 100 个测试文件（sillyhub-daemon/src/spec-sync.ts、backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py、backend/app/modules/platform_sync/tests/test_agent_liveness_states_migration.py、backend/app/modules/platform_sync/tests/test_agent_log_attribution.py、backend/app/modules/platform_sync/tests/test_agent_log_content.py …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable（covered-service 适用：端点行为由 service 层等非端点层测试锁定，证据附测试锚点；non-testable 是文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。covered/covered-service/partial 证据须含测试锚点三形态之一（file:line / `.test.` 测试文件名 / 反引号包裹的路径或测试名），行号可省；uncovered/non-testable 证据自由形态。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/covered-service/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 带 usage/turnId 的 fixture 解析后段携带 turn_id/model/usage，totalUsage 等于各行 usage 五项之和 | `sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts` | usage、turnId、fixture、turn_id（`sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts`） | covered | `sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts:23`（usage）、`sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts:22`（turnId）、`sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts:5`（fixture） |
| 既有 fixture（无新字段）解析结果新字段为 undefined，既有断言全绿（零行为回归） | `sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts` | fixture（`sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts`） | covered | `sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts:5`（fixture） |
| 内层 usage 键为 snake_case（input_tokens/output_tokens/cache_read_tokens/cache_write_tokens） | `sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts` | usage（`sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts`） | covered | `sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts:23`（usage） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| fixture 解析：tool_result 载体 user 行产出 tool_result 段非 user_input；isMeta 文本段带 is_meta:true；真人文本→user_input | `sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts` | fixture、解析、tool_result、载体、user（`sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts`） | covered | `sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts:5`（fixture）、`sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts:3`（解析）、`sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts:6`（tool_result） |
| usage 归一命中全量口径（input 含缓存读+写）；totalUsage=全文件和 | `sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts` | usage、input、totalUsage（`sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts`） | covered | `sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts:7`（usage）、`sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts:12`（input）、`sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts:12`（totalUsage） |
| beforeSeq 切片 + 200 段窗口 + truncated/totalSegments 语义与 zcode 解析器一致；>20MB 前置 too_large | `sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts` | beforeSeq、切片、段窗口、truncated、totalSegments（`sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts`） | covered | `sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts:8`（beforeSeq）、`sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts:18`（切片）、`sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts:18`（段窗口） |

**task-03**
- （卡无 acceptance——防御，plan-postcheck 已拦）

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| QUICKLOG 落实证结论（可得/不可得 + 证据路径与字段名） | `QUICKLOG-qinyi-2026-09-20.md` | — | covered | `QUICKLOG-qinyi-2026-09-20.md` ql-20260920-001-1bf6（可得+证据档案路径+字段名） |
| 双分支测试绿：可得→usage/totalUsage 命中；不可得→字段 undefined、既有消息解析不回归 | `sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts` | usage、totalUsage、命中（`sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts`） | covered | `sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts:41`（usage）、`sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts:42`（totalUsage）、`sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts:562`（命中） |
| 既有 read-zcode-sqlite.test.ts 用例全绿；zcode-sqlite-dispatch.test.ts 不受影响（新字段可选） | `sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts` | 既有、read、zcode、sqlite、test（`sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts`） | covered | `sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts:504`（既有）、`sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts:1`（read）、`sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts:1`（zcode） |

**task-05**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| getAgentLogParser('claude-code-jsonl')/('cursor-agent-transcript') 返回解析器，未知 format 仍 null→unsupported | `sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts` | getAgentLogParser、claude、code、jsonl（`sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts`） | covered | `sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts:27`（getAgentLogParser）、`sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts:257`（claude）、`sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts:7`（code） |
| handler 层测试证明 totalUsage 随解析结果原样上行（zcode 文件路径 mock） | `sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts` | handler、totalUsage、zcode（`sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts`） | covered | `sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts:5`（handler）、`sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts:165`（totalUsage）、`sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts:7`（zcode） |
| 既有 unsupported/too_large/lstat 预判用例全绿（零回归） | `sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts` | unsupported、too_large、lstat（`sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts`） | covered | `sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts:16`（unsupported）、`sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts:18`（too_large）、`sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts:18`（lstat） |

**task-06**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| worktree backend/openapi.json 含 AgentLogUsage/totals 与消息级五字段；frontend/src/lib/api-types.ts 相应生成（禁止手写） | `backend/app/modules/platform_sync/tests/test_agent_log_messages.py` | openapi、json（`backend/app/modules/platform_sync/tests/test_agent_log_messages.py`） | covered | `backend/app/modules/platform_sync/tests/test_agent_log_messages.py:17`（openapi）、`backend/app/modules/platform_sync/tests/test_agent_log_messages.py:127`（json） |
| pytest：带新字段的 daemon mock → 响应透传；无新字段 mock → 全 None（老 daemon 兼容） | `backend/app/modules/platform_sync/tests/test_agent_log_messages.py` | pytest、daemon、mock（`backend/app/modules/platform_sync/tests/test_agent_log_messages.py`） | covered | `backend/app/modules/platform_sync/tests/test_agent_log_messages.py:31`（pytest）、`backend/app/modules/platform_sync/tests/test_agent_log_messages.py:3`（daemon）、`backend/app/modules/platform_sync/tests/test_agent_log_messages.py:3`（mock） |
| gen:types 产出的 schema 是 worktree 代码（核对 totals 字段在 openapi 中存在，防主仓旧 schema 假象） | `backend/app/modules/platform_sync/tests/test_agent_log_messages.py` | gen、types、schema（`backend/app/modules/platform_sync/tests/test_agent_log_messages.py`） | covered | `backend/app/modules/platform_sync/tests/test_agent_log_messages.py:1`（gen）、`backend/app/modules/platform_sync/tests/test_agent_log_messages.py:17`（types）、`backend/app/modules/platform_sync/tests/test_agent_log_messages.py:11`（schema） |

**task-07**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 系统注入消息不产用户气泡（落 stderr processItems 首项）；真人文本产 prompt | `frontend/src/lib/__tests__/agent-log-replay.test.ts` | stderr、processItems、首项（`frontend/src/lib/__tests__/agent-log-replay.test.ts`） | covered | `frontend/src/lib/__tests__/agent-log-replay.test.ts:14`（stderr）、`frontend/src/lib/__tests__/agent-log-replay.test.ts:146`（processItems）、`frontend/src/lib/__tests__/agent-log-replay.test.ts:14`（首项） |
| turn_id 变化与 turn_end 均切新轮；无 turn_id 数据退化为 user_input 单保险 | `frontend/src/lib/__tests__/agent-log-replay.test.ts` | turn_id、turn_end（`frontend/src/lib/__tests__/agent-log-replay.test.ts`） | covered | `frontend/src/lib/__tests__/agent-log-replay.test.ts:15`（turn_id）、`frontend/src/lib/__tests__/agent-log-replay.test.ts:15`（turn_end） |
| 轮 token 求和正确、无 usage 全 null；isSubagentLog 命中 subagent_agent_ 前缀样例 | `frontend/src/lib/__tests__/agent-log-replay.test.ts` | token、usage、null、isSubagentLog（`frontend/src/lib/__tests__/agent-log-replay.test.ts`） | covered | `frontend/src/lib/__tests__/agent-log-replay.test.ts:7`（token）、`frontend/src/lib/__tests__/agent-log-replay.test.ts:17`（usage）、`frontend/src/lib/__tests__/agent-log-replay.test.ts:15`（null） |

**task-08**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| tool_report 空轮会话（page 与 dialog）主体渲染会话样式对话流：真人用户气泡/系统事件行/思考折叠/工具卡片/轮 token 徽标/用量汇总条 | `frontend/src/components/daemon/__tests__/agent-log-replay-body.test.tsx`<br>`frontend/src/components/daemon/__tests__/agent-log-card.test.tsx` | tool_report、page、dialog（`frontend/src/components/daemon/__tests__/agent-log-replay-body.test.tsx`、`frontend/src/components/daemon/__tests__/agent-log-card.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/agent-log-replay-body.test.tsx:23`（tool_report）、`frontend/src/components/daemon/__tests__/agent-log-replay-body.test.tsx:7`（page）、`frontend/src/components/daemon/__tests__/agent-log-replay-body.test.tsx:3`（dialog） |
| 子代理日志经「工作会话」浮层切换查看，不并入正文；多主日志默认最新可切换 | `frontend/src/components/daemon/__tests__/agent-log-replay-body.test.tsx`<br>`frontend/src/components/daemon/__tests__/agent-log-card.test.tsx` | 工作会话（`frontend/src/components/daemon/__tests__/agent-log-replay-body.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/agent-log-replay-body.test.tsx:6`（工作会话） |
| unsupported/parse_error/too_large/422/409/404/5xx 回落原文+黄条；离线态提示+元数据；无 token 显示「未知」 | `frontend/src/components/daemon/__tests__/agent-log-replay-body.test.tsx`<br>`frontend/src/components/daemon/__tests__/agent-log-card.test.tsx` | unsupported、parse_error、too_large、回落原文、黄条（`frontend/src/components/daemon/__tests__/agent-log-replay-body.test.tsx`、`frontend/src/components/daemon/__tests__/agent-log-card.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/agent-log-replay-body.test.tsx:17`（unsupported）、`frontend/src/components/daemon/__tests__/agent-log-card.test.tsx:25`（parse_error）、`frontend/src/components/daemon/__tests__/agent-log-card.test.tsx:25`（too_large） |
| 已激活 tool_report 会话不进本路径（isToolReportBody=false 走正常对话流），AgentLogCard 顶部栏保留 | `frontend/src/components/daemon/__tests__/agent-log-replay-body.test.tsx`<br>`frontend/src/components/daemon/__tests__/agent-log-card.test.tsx` | 已激活、tool_report、isToolReportBody、false（`frontend/src/components/daemon/__tests__/agent-log-replay-body.test.tsx`、`frontend/src/components/daemon/__tests__/agent-log-card.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/agent-log-replay-body.test.tsx:561`（已激活）、`frontend/src/components/daemon/__tests__/agent-log-replay-body.test.tsx:23`（tool_report）、`frontend/src/components/daemon/__tests__/agent-log-replay-body.test.tsx:7`（isToolReportBody） |

**task-09**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 三组 scoped 测试全绿 + tsc --noEmit 零错误 | 无归属测试——判定大概率 uncovered | — | uncovered | （无归属测试） |
| git status 文件清单 = design §6 清单（25 条）无计划外改动 | 无归属测试——判定大概率 uncovered | — | uncovered | （无归属测试） |
| 禁全量测试（全量留给 CI） | 无归属测试——判定大概率 uncovered | — | uncovered | （无归属测试） |

- ⚠️ 零/半自动化承接条目 4 条——这些路径无测试兜底，verify 复核必须**显式走查**（尤其编辑/更新链路与非主分支流：二次复核实证它们正是 P1 藏身处），走查结论登记进「代码审查」节

#### 探针 4：决策追踪覆盖
<!--TODO: 语义探针——D-xxx@vN → FR-xxx → plan/task 引用 → 证据回指闭环（agent 执行）-->

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 2232 backend endpoints (live [scan-root 610 + worktree 610] + artifact 1830), 0 frontend calls [scope: change-diff (27 files @ worktree)] | 624 backend endpoints unused by frontend
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ⚠️ 624 个本变更端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 25 个非 Java 清单文件不在探针 9 扫描面）
#### 探针 10：预填注清零（error 门）
<!-- 口径注记：预填注（来源注协议）在场 = 白名单槽未确认（预填≠结论）；删注 = 确认动作。本探针是门禁梯度 error 档——verify --done 时 gate 复跑同源检测，注未清零阻断完成（归档前清零兜底）。已知误报面：散文引用注字面量会命中（如文档描述注协议本身）——核对后真未确认则删注，纯散文则改写措辞，不得删探针段。 -->
- ✅ 预填注清零（10 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml——红线机检零打扰，D-002）
## 证据账（cannot_verify 任务）
[层：人工判断——CLI 核验]

<!-- 无 cannot_verify 任务时本节写「无」 -->
无（本次变更无 cannot_verify 任务）

## 集成验证回执
[层：自述声明——CLI 一致性校验]

<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
<!-- 回执双形态（2026-09-16-friction5-hardening FR-01）：下方多行 YAML 形态为推荐写法（字段序无关）；
     亦认单行管道形态：- claim: <一句话> | command: <命令> | exit: <0 或非 0> | log: <日志路径> -->
- claim: 四解析器×真实日志文件端到端只读实跑（zcode rollout/db.sqlite/claude-code/cursor-agent 各一，parsed+usage/turn/totalUsage 契约命中）
  command: npx tsx .tmp-verify-probe.ts（worktree sillyhub-daemon 内，探针脚本用后即删；命令与输出摘录见「探针结果」表 1-4）
  exit: 0
  log: 本会话工具输出（2026-09-20 12:0x-12:2x，四探针全部 parsed；无落盘日志文件——脚本临时态，证据数值已录入本表）
- claim: 真实环境全量前端套件（308 文件/4098 测试）
  command: cd <worktree>/frontend && pnpm vitest run
  exit: 0
  log: 2026-09-20 12:23:25 起 136.79s，4098 passed
- claim: 真实环境全量 daemon 套件（237 文件/4376+ passed）
  command: cd <worktree>/sillyhub-daemon && pnpm vitest run
  exit: 0（伴随 1-3 条 daemon-budget-wiring 60s 超时 flaky，非本变更文件——见移交项）
  log: 2026-09-20 两轮：12:25:54（3 failed）→ 12:30:59（1 failed），失败行均为 budget 接线超时
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->


## 接口验证覆盖矩阵

| 接口/契约 | 验证方式 | 结果 |
|---|---|---|
| host_fs.read_agent_log_messages RPC（扩展返回 totalUsage+消息五字段） | daemon 侧 handler 分发测试（read-agent-log-messages.test.ts AL8/AL9/AL10）+ 平台侧转换层测试（test_agent_log_messages.py 21 passed）双侧夹逼 | covered |
| GET /api/agent-logs/{id}/messages 响应（totals/五新字段） | pytest 新/老 daemon 双态断言 + OpenAPI 曝光断言（TestOpenapiExposure） | covered |
| buildReplayTurns/isSubagentLog/selectMainLogs（前端适配层） | 纯函数单测 23 用例（真实形状 fixture）+ 组件 smoke 消费侧 14 用例 | covered |
| TurnTimeline 挂载契约（八字段必填/运行态空置） | replay-body smoke（page+dialog 两分支）断言渲染 | covered |
| daemon↔平台 WS RPC 全链（真实 daemon 起 + 平台转发） | 未本机起真实 daemon 实测（见移交项 manual-acceptance 行） | partial |

## 移交项（结构化）

| 类型 | severity | 内容 | 去向 |
|---|---|---|---|
| manual-acceptance | advisory | 部署 replay-redo 后人工打开 137ddfff 同型会话（tool_report 且 turn_count=0）抽验回放页端到端（WS RPC 全链）——本机未起真实 daemon+backend 组合 | 部署后人工抽验（验收口径 design §11） |
| other | advisory | CLI verify 门沙箱 4 类伪影（overlay 混版/三形态超时/ruff CRLF）已按 local.yaml known_failures O 组豁免，工具侧治理后移除（降级：真实环境全量双绿（frontend 4098/daemon 4376+）已实证伪影非代码缺陷，且豁免条目带复核移除条件，依据 local.yaml known_failures O 组 / verify-result.md「测试结果」节） | sillyspec 工具仓（沙箱 overlay 与 junction 拷贝修复） |
| other | advisory | daemon-budget-wiring 60s 超时 flaky（并行会话领地，两轮 3→1 漂移） | 所属并行会话收尾修复后移除豁免条目 |
| other | advisory | _module-map.yaml 粒度未覆盖 agent-log/session-panel 子目录（scan 基线落后），modules rebuild 转出 | 下轮 scan 变更 |
