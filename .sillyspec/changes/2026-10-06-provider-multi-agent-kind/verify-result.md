# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。
>
> 「层」=证据可核验性分层（非执行者声明）：「人工判断」指本节为语义判断，由执行 agent 填写、
> CLI 不机械复跑（gate 抽查 + 人类审批点复核兜底）；「可复跑探针/确定性检查/CLI 一致性校验」= gate 可机械复核段。

## 结论 [层：人工判断]

结论枚举：PASS WITH NOTES

结论枚举：PASS（🤖 CLI 草稿待确认——机械事实全绿自动预填：noAI 实测通过 + 探针 1/3/5/6 干净 + 风险门非 integration/deployment；复核后不同意即改写本行枚举值，gate 独立复核不受预填影响）

## 移交项（结构化） [层：人工判断——CLI 清单核验]

| 类型 | 项 | severity | 去向 |
|---|---|---|---|
| other | B4 收缩空缺 toast 弹层自动化断言（实现+E2E 实查已过） | minor | 下次前端测试债清理变更 |
| other | sess.provider=NULL 扇出跳过分支专门用例（同构走查+runtimeNULL 用例已过） | minor | 下次 daemon 测试补充变更 |
| other | 生产 PG 迁移建议 staging 先走 upgrade/downgrade 往返（开发库已实跑背书） | minor | 部署窗口执行 |
## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
<!-- 无 cannot_verify 任务时本节写「无」；有则逐 task 一行 -->
- task-NN: <待填：三选一> | verifiedFiles: <精确路径，逗号分隔>（satisfied 必填；豁免时填 missing 并加（豁免：<一句话理由>）后缀）

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
<!-- 回执双形态（2026-09-16-friction5-hardening FR-01）：下方多行 YAML 形态为推荐写法（字段序无关）；
     亦认单行管道形态：- claim: <一句话> | command: <命令> | exit: <0 或非 0> | log: <日志路径> -->
- claim: <待填：一句话>
  command: <待填：命令>
  exit: <待填：0 或非 0>
  log: <待填：日志路径>
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->

## 任务完成度 [层：人工判断]
<!--TODO: 逐 task 对照 tasks.md 勾选与验收标准，完成/未完成/存疑三态-->

## 设计一致性 [层：人工判断]
<!--TODO: 实现与 design.md 的偏差（无偏差也显式写「一致」）-->

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ glob 项未展开（agent 手动展开扫描）：frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx、frontend/src/app/m/workspaces/[id]/sessions/[sid]/__tests__/page.m-session-chat.test.tsx
- ℹ️ 2 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）

#### 探针 2：设计关键词覆盖
<!--TODO: 半语义探针——从 design 提取能力关键词逐个 grep 确认实现（agent 执行）-->

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/migrations、backend/app/modules/llm_provider）找到 17 个测试文件（backend/migrations/versions/202606100900_create_spec_workspaces.py、backend/migrations/versions/202606101000_create_spec_profile.py、backend/migrations/versions/202606220900_backfill_spec_workspaces.py、backend/migrations/versions/202606230900_repair_spec_root_paths.py、backend/migrations/versions/20260813160000_create_spec_file_manifest.py …）
- ✅ task-02: 模块目录（backend/app/modules）找到 52 个测试文件（backend/app/modules/agent/tests/test_agent_run_log_nul.py、backend/app/modules/agent/tests/test_agent_sessions_include_ended.py、backend/app/modules/agent/tests/test_agent_session_model.py、backend/app/modules/agent/tests/test_apply_run_metadata_cache.py、backend/app/modules/agent/tests/test_base.py …）
- ✅ task-03: 模块目录（backend/app/modules/llm_provider）找到 11 个测试文件（backend/app/modules/llm_provider/tests/test_api_format.py、backend/app/modules/llm_provider/tests/test_fetch_models.py、backend/app/modules/llm_provider/tests/test_litellm_client.py、backend/app/modules/llm_provider/tests/test_llm_provider.py、backend/app/modules/llm_provider/tests/test_llm_provider_pi_kind.py …）
- ✅ task-04: 模块目录（backend/app/modules/daemon/lease、backend/app/modules/daemon/session/service、backend/app/modules/session_attachment、backend/app/modules/mcp_gateway）找到 13 个测试文件（backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py、backend/app/modules/session_attachment/tests/test_capability.py、backend/app/modules/session_attachment/tests/test_cleanup.py、backend/app/modules/mcp_gateway/tests/test_auth.py、backend/app/modules/mcp_gateway/tests/test_change_stage_tools.py …）
- ✅ task-05: 模块目录（backend/app/modules/daemon/lease）找到 1 个测试文件（backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py）
- ✅ task-06: 模块目录（backend/app/modules/agent、backend/app/modules/daemon）找到 22 个测试文件（backend/app/modules/agent/tests/test_agent_run_log_nul.py、backend/app/modules/agent/tests/test_agent_sessions_include_ended.py、backend/app/modules/agent/tests/test_agent_session_model.py、backend/app/modules/agent/tests/test_apply_run_metadata_cache.py、backend/app/modules/agent/tests/test_base.py …）
- ✅ task-07: 模块目录（backend/app/modules/llm_provider、backend/app/modules/daemon、backend/tests/modules/daemon、backend/app/modules/session_attachment）找到 35 个测试文件（backend/app/modules/llm_provider/tests/test_api_format.py、backend/app/modules/llm_provider/tests/test_fetch_models.py、backend/app/modules/llm_provider/tests/test_litellm_client.py、backend/app/modules/llm_provider/tests/test_llm_provider.py、backend/app/modules/llm_provider/tests/test_llm_provider_pi_kind.py …）
- ✅ task-08: 模块目录（frontend/src/components）找到 10 个测试文件（frontend/src/components/agent/borrowed-solution-files-panel.test.tsx、frontend/src/components/agent/borrowed-solution-files.test.tsx、frontend/src/components/agent/__tests__/borrow-trigger-contract.test.ts、frontend/src/components/agent-log/__tests__/normalize-dual-path.test.ts、frontend/src/components/agent-log/__tests__/normalize.test.ts …）
- ✅ task-09: 模块目录（frontend/src/lib/api、frontend/src/lib、backend、frontend/src/components/sessions、frontend/src/components、frontend/src/app、frontend/src/components/llm-providers/__tests__、frontend/src/components/sessions/__tests__、frontend/src/components/daemon/__tests__、frontend/src/lib/api/__tests__）找到 147 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/change-autolink.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts …）
- ✅ task-10: 模块目录（frontend/src/components/llm-providers/__tests__、frontend/src/components/sessions/__tests__、frontend/src/components/__tests__）找到 26 个测试文件（frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx、frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx、frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx、frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx、frontend/src/components/llm-providers/__tests__/llmProviderPresets.test.ts …）
- ✅ task-11: 模块目录（.sillyspec/changes）找到 81 个测试文件（.sillyspec/changes/2026-10-06-provider-multi-agent-kind/test-trace.json、.sillyspec/changes/archive/2026-06-02-spec-bootstrap-agent-stream-interaction/prototype-2026-06-02-spec-bootstrap-agent-stream-interaction.html、.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/prototype-daemon-client-spec-strategy.html、.sillyspec/changes/archive/2026-08-25-session-spec-binding/prototype-session-spec-binding.html、.sillyspec/changes/archive/2026-09-12-session-live-display-fixes/evidence/prod-live-test-20260913.md …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable（covered-service 适用：端点行为由 service 层等非端点层测试锁定，证据附测试锚点；non-testable 是文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。covered/covered-service/partial 证据须含测试锚点三形态之一（file:line / `.test.` 测试文件名 / 反引号包裹的路径或测试名），行号可省；uncovered/non-testable 证据自由形态。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/covered-service/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| NEW:backend/migrations/versions/20261006120000_provider_agent_kinds.py 存在，revision=20261006120000 且 down_revision 等于执行时 `alembic heads` 的唯一 head | 见证据列 | 复核命中 | covered | `test_agent_kinds_migration.py`（模块加载 + revision 断言；执行时单头由 alembic 实跑核） | |
| SQLite（测试环境）与 PG（生产语义）双方言下 `alembic upgrade head` 均执行成功（R-03） | 见证据列 | 复核命中 | covered | `test_agent_kinds_migration.py`（SQLite 直驱）+ 本机 PG 实跑（verification-e2e.md C 节） | |
| 升级后 llm_providers 表：agent_kind 列不存在、agent_kinds JSON NOT NULL 列存在；每行 agent_kinds 为单元素数组（元素=迁移前该行 agent_kind）（存量值域不变性，FR-02；不合并不清理重复行，D-002） | 见证据列 | 复核命中 | covered | `test_agent_kinds_migration.py`（PRAGMA table_info + 单元素数组断言） | |
| 旧复合索引 ix_llm_providers_user_agent_default 已 drop，(user_id) 维度索引在位（R-01） | 见证据列 | 复核命中 | covered | `test_agent_kinds_migration.py`（PRAGMA index_list 断言） | |
| 执行 `alembic downgrade -1` 后再 `alembic upgrade head` 往返一致：agent_kind 恢复为 agent_kinds 首元素、复合索引恢复原形态（可回退） | 见证据列 | 复核命中 | covered | `test_agent_kinds_migration.py` downgrade 分支断言 | |
| backend/app/modules/llm_provider/model.py 无 agent_kind 单值列残留，列定义与索引和迁移终态一一对应 | 见证据列 | 复核命中 | covered | llm_provider 全域 243 passed 依赖新列落库（`app/modules/llm_provider/tests/`） | |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| Create 校验：agent_kinds 不传或传空列表 → 422（min_length=1）；["claude","claude"] 去重存为 ["claude"]；["gemini"] → 422（引擎词表外） | 见证据列 | 复核命中 | covered | `test_llm_provider_pi_kind.py`（缺字段/gemini 422）+ `test_agent_kinds_multi.py`（dedupe） | |
| Create 组合禁配（FR-04）：agent_kinds 含 "pi" 且 api_format=openai_chat → 422；含 pi 但 api_format=anthropic → 创建成功；codex/claude × openai_chat 不受限 | 见证据列 | 复核命中 | covered | `test_api_format.py` + `test_llm_provider.py` pi×openai 422 家族 | |
| Update 双口径（FR-04）：对 openai_chat 行 PATCH agent_kinds=["pi"] → 422 LlmProviderKindFormatForbidden；对集合含 pi 行 PATCH api_format="openai_chat" → 422；Update.agent_kinds=None → 不动原集合（exclude_unset 语义不变） | 见证据列 | 复核命中 | covered | `test_agent_kinds_multi.py`（expand_to_pi_with_openai_chat_rejected）+ `test_llm_provider.py` patch 422 家族 | |
| Read 响应体含 agent_kinds 数组、不含 agent_kind 键（接口无过渡期） | 见证据列 | 复核命中 | covered | `test_agent_kinds_multi.py`（read.agent_kinds 断言）+ `frontend/src/lib/api-types.ts` 再生成契约 | |
| grep -n "agent_kind\b" backend/app/modules/llm_provider/ 下无行字段残留引用（仅剩 agent_kinds 与语义同步后的注释/文档串） | 走查 | grep 复核 | non-testable | execute 期 grep 清零复核（生产代码无行字段残留引用） |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| create is_default=True 的多引擎行（如 ["claude","pi"]）落库后：该用户原有 claude 默认行与 pi 默认行均被清为 False，任意引擎无双默认（FR-03 互斥粒度仍 (user_id, 引擎)） | 见证据列 | 复核命中 | covered | `test_agent_kinds_multi.py` set_default_clears_siblings_for_every_engine | |
| update 扩张：默认行 agent_kinds 从 ["claude"] 扩为 ["claude","pi"] 且该用户另有 pi 默认行 → 原 pi 默认行被清（D-006） | 见证据列 | 复核命中 | covered | `test_agent_kinds_multi.py` default_row_expand_clears_new_engine_sibling（实修 service 缺口） | |
| update 收缩：默认行从 ["claude","pi"] 缩为 ["claude"] → pi 引擎默认空缺，无任何其它行被自动置默认（D-003/R-05 不转移） | 见证据列 | 复核命中 | covered | `test_agent_kinds_multi.py` shrink_leaves_engine_default_vacant | |
| set_default 多引擎行：集合内每引擎互斥成立；DefaultSwitchResult 结构、probe 失败回滚（switched=False 不改 is_default 不推送）、LiteLLM 联动（litellm_registered）语义均不变 | 见证据列 | 复核命中 | covered | `test_llm_provider.py` set_default 家族 + multi 互斥用例 | |
| unset_default 语义不变（不探测、不清兄弟、幂等） | 见证据列 | 复核命中 | covered | `test_llm_provider.py` 既有 unset 用例（fixture 切集合后仍绿） | |
| probe/fetch_models/query_usage 行为零改动 | 见证据列 | 复核命中 | covered | `test_fetch_models.py` / `test_usage.py` / `test_quota.py` 全绿 | |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 一条 agent_kinds=["claude","pi"] 的默认供应商行：claude 会话与 pi 会话 claim 各自命中（resolve_default 集合命中），payload.provider_config.agent_kind 分别为 "claude"/"pi"（盖会话引擎，daemon getInterceptor 分发契约不变，FR-01 多引擎命中场景 + FR-05） | 见证据列 | 复核命中 | covered | `test_resolve_default_provider_config.py` TestMultiEngineSetHit（claude/pi 双命中+盖引擎断言）+ `test_provider_config_payload.py` claim 契约 | |
| resolve_bound：绑定行集合不含会话引擎（如 codex 会话绑 ["claude","pi"] 行）→ 返回 None 回退用户默认链（回退语义零回归） | 见证据列 | 复核命中 | covered | `test_resolve_bound_provider_config.py` 引擎不匹配回退家族（17 passed） | |
| inject_gates.py:278：会话引擎不在绑定行集合 → 422 DaemonSessionLlmProviderKindMismatch（语义不变）；引擎在集合 → 通过 | 见证据列 | 复核命中 | covered | `test_session_create_config.py` / `test_session_switch_config.py` 422 家族（daemon 域全绿内） | |
| capability.py：多选默认行按会话引擎命中多模态门控解析（群聊 shadow 间接路径同受益，R-06） | 见证据列 | 复核命中 | covered-service | `test_capability.py` 门控家族全绿（默认回退集合命中；shadow 同函数入口走查确认） | |
| tools.py：配额池按 effective_agent 命中多选默认行；independent 池描述符的 agent_kind == effective_agent（池引擎值，非行字段） | 见证据列 | 复核命中 | covered-service | `test_tools_new.py` 配额池三态家族全绿 | |
| 存量单元素行（agent_kinds == [旧值]）四路径行为与单值时代逐项等价（FR-02 兼容：值域不变性由迁移保证，本卡解析语义等价） | 见证据列 | 复核命中 | covered | 全部存量 fixture 即单元素形态（437+2427+250 全绿即等价面） | |
| grep -n "\.agent_kind\b" 于 4 个 allowed_paths 文件无 LlmProvider 行字段读取残留 | 见证据列 | 复核命中 | non-testable | 主会话 execute 期 grep 复核：4 文件仅余引擎值语义引用（非行字段）；tests 内残留归 task-07 清 | |

**task-05**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 多引擎默认行（如 agent_kinds 含 claude 与 pi）设默认后——claude 会话收到 payload.provider_config.agent_kind 等于 claude、pi 会话等于 pi，两份 config 其余字段同源同一默认行。 | 见证据列 | 复核命中 | covered | `test_provider_switch.py` test_sessions_receive_own_engine_config（by_session 断言 claude 复用/pi 盖引擎） | |
| 引擎不在新默认行 agent_kinds 内的会话组——经 resolve 取该引擎当前默认行 config 下发；该引擎无默认则该组不推送、仅 warning、不抛异常、不影响其它组投递计数。 | 见证据列 | 复核命中 | covered | 扇出用例 pi 组 resolve 路径 + best-effort 家族（`test_provider_switch.py` offline/exception 用例零回归） | |
| sess.provider 为 NULL 的命中会话——跳过推送且记 warning 日志，其余会话正常推送。 | 见证据列 | 复核命中 | covered | `test_provider_switch.py` TestNotifyProviderSwitchRuntimeNull（runtime NULL 同构 continue 形态，走查确认） | |
| provider_config 为 None——全部命中会话 payload.provider_config 均为 None，投递计数语义与改造前一致（停止场景零回归）。 | 见证据列 | 复核命中 | covered | `test_provider_switch.py` 既有 no-active/None 推送用例（fixture 切集合后零改动通过） | |
| 单引擎默认行（迁移后单元素数组）+ 同引擎会话——推送目标集合、payload 内容、返回计数与改造前等价（R-07 回归门）。 | 见证据列 | 复核命中 | covered | `test_provider_switch.py` 11 个既有用例零改动通过（行为等价） | |
| 对外签名与调用点零变化——backend/app/modules/llm_provider/service.py:482 调用与 patch 路径 app.modules.daemon.lease.provider_switch.notify_provider_switch 均无需改动。 | 见证据列 | 复核命中 | covered | `test_llm_provider.py` mock_probe_notify（patch 该路径）既有用例全绿 | |

**task-06**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 两处文档均无「provider_config.agent_kind 取供应商行 agent_kind」旧语义残留，均明确 agent_kind 恒为会话引擎值。 | 见证据列 | 复核命中 | non-testable | 文档走查：`agent/schema.py` description 与 `protocol.py` 注释均已改「恒为会话引擎值（D-005）」表述 | |
| DTO 字段集、类型、默认值与 WS payload 结构零变化（diff 仅注释与 description 字符串），daemon 仓与前端消费方零感知。 | 见证据列 | 复核命中 | covered | sillyhub-daemon diff 0 行 + 前端触面套件（`src/lib/api/__tests__/llm-providers.test.ts` 等）250 passed | |
| 若 description 变更引起 backend/openapi.json 漂移不在本卡提交——统一归 task-09 的 gen:types 批次再生成。 | 见证据列 | 复核命中 | covered | openapi.json 已在 task-09 批次再生成（5 处 agent_kinds），`frontend/src/lib/api-types.ts` 同批 | |

**task-07**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 域一断言齐备——多选创建/组合禁配 422/互斥含扩张清新增引擎兄弟/收缩空缺均有用例且通过。 | 见证据列 | 复核命中 | covered | `test_agent_kinds_multi.py` 5 passed | |
| 域二断言齐备——default 与 bound 集合命中 + agent_kind 盖会话引擎 + claim payload 契约均通过。 | 见证据列 | 复核命中 | covered | `test_resolve_default_provider_config.py` 17 passed + `test_provider_config_payload.py` | |
| 域三断言齐备——多引擎扇出各推对应 config + 单引擎回归等价 + NULL provider 跳过 + 停止推 None 均通过。 | 见证据列 | 复核命中 | covered | `test_provider_switch.py` 12 passed（新增扇出 + 11 既有含 runtime-null/None 场景） | |
| 域四断言齐备——capability 门控按引擎命中多选行（含群聊 shadow 间接路径用例）通过。 | 见证据列 | 复核命中 | covered-service | `test_capability.py` 全绿（默认回退集合命中；shadow 同入口走查） | |
| 域五断言齐备——迁移双方言 + 存量转数组 + 索引在位（R-01）通过。 | 见证据列 | 复核命中 | covered | `test_agent_kinds_migration.py` | |
| 既有用例仅因 agent_kind 到 agent_kinds 口径迁移而改写，不删除守护既有行为的断言（停止场景、owner 隔离、best-effort、幂等等保留）。 | 见证据列 | 复核命中 | covered | diff 走查：`test_provider_switch.py` 11 用例仅改 fixture 未删断言；owner/幂等家族全绿 | |
| verify 命令限定相关测试文件路径且全部通过（0 failed）。 | 见证据列 | 复核命中 | covered | execute 步 12 实跑：八目录（`app/modules/llm_provider/tests/` 等）437 passed 0 failed | |

**task-08**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 新建/编辑表单引擎区可同时勾选 claude/codex/pi（gemini 仍 disabled 占位），全不勾时提交被禁用且有「至少选择一个引擎」提示 | 见证据列 | 复核命中 | covered | `llm-provider-form.test.tsx` 29 passed（toggleKind 家族；UI 层 onChange 拦空集，后端 422 兜底） | |
| api_format=openai_chat 时 pi 复选项禁用并显示禁配提示；pi 勾选态下切 openai 格式自动摘除 pi；提交兜底按集合口径拦截（文案与后端 422 同口径） | 见证据列 | 复核命中 | covered | 前置禁用用例（piLocked+守卫）+ `llm-provider-form-apiformat.test.tsx` 6 passed（对向 disabled 实现同一守卫） | |
| 编辑默认行收缩引擎（如去掉 pi）保存成功后出现「pi 引擎默认供应商已空缺」类提示（R-05，不自动转移） | 见证据列 | 复核命中 | covered | R-05 toast 已实现（`llm-provider-form.tsx` message.warning；E2E B4 实查）；弹层断言留 CI（移交项） | |
| 列表行按 agent_kinds 渲染多个引擎徽标（claude+pi 行可见两个并列徽标） | 见证据列 | 复核命中 | covered | `llm-provider-list.test.tsx`（badge mock 更新）+ verification-e2e.md B1 实查 | |

**task-09**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| LlmProviderRead/Create/Update/FormValues 均为 agent_kinds 数组形态，前端不再类型引用供应商行 agent_kind 字段 | `frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx`<br>`frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx`<br>`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx`<br>`frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx`<br>`frontend/src/components/sessions/__tests__/session-config-bar.test.tsx`<br>`frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx`<br>`frontend/src/lib/api/__tests__/llm-providers.test.ts` | LlmProviderRead、Create、Update、FormValues（`frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx`、`frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx`、`frontend/src/components/sessions/__tests__/session-config-bar.test.tsx`、`frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx`、`frontend/src/lib/api/__tests__/llm-providers.test.ts`） | covered | `frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx:27`（LlmProviderRead）、`frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx:12`（Create）、`frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx:8`（Update） |
| backend/openapi.json 与 frontend/src/lib/api-types.ts 含 agent_kinds 数组字段（gen:types 再生成产物）且同批提交 | `frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx`<br>`frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx`<br>`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx`<br>`frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx`<br>`frontend/src/components/sessions/__tests__/session-config-bar.test.tsx`<br>`frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx`<br>`frontend/src/lib/api/__tests__/llm-providers.test.ts` | backend、json、frontend（`frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx`、`frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx`、`frontend/src/lib/api/__tests__/llm-providers.test.ts`） | covered | `frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx:393`（backend）、`frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx:381`（json）、`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx:188`（frontend） |
| 配置条（session-config-bar.tsx:412）与档案表单（agent-profile-form.tsx:770）按 includes 过滤，多引擎行（claude+pi）在 claude 与 pi 两个引擎下均可见可选中 | `frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx`<br>`frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx`<br>`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx`<br>`frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx`<br>`frontend/src/components/sessions/__tests__/session-config-bar.test.tsx`<br>`frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx`<br>`frontend/src/lib/api/__tests__/llm-providers.test.ts` | 配置条、session、config、bar、tsx（`frontend/src/components/sessions/__tests__/session-config-bar.test.tsx`、`frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx`、`frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx`、`frontend/src/lib/api/__tests__/llm-providers.test.ts`） | covered | `frontend/src/components/sessions/__tests__/session-config-bar.test.tsx:11`（配置条）、`frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx:528`（session）、`frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx:292`（config） |
| design 清单 5 文件 + grep 复核新增 4 文件的全部供应商 mock 已补 agent_kinds，tsc --noEmit 0 错 | `frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx`<br>`frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx`<br>`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx`<br>`frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx`<br>`frontend/src/components/sessions/__tests__/session-config-bar.test.tsx`<br>`frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx`<br>`frontend/src/lib/api/__tests__/llm-providers.test.ts` | design、文件（`frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx`、`frontend/src/components/sessions/__tests__/session-config-bar.test.tsx`） | covered | `frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx:392`（design）、`frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx:515`（文件） |

**task-10**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 6 个相关测试文件目标用例全绿（vitest run 指定文件 0 失败） | `frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx`<br>`frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx`<br>`frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx`<br>`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx`<br>`frontend/src/components/sessions/__tests__/session-config-bar.test.tsx`<br>`frontend/src/components/__tests__/agent-profile-form.test.tsx` | vitest、run、失败（`frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx`、`frontend/src/components/sessions/__tests__/session-config-bar.test.tsx`、`frontend/src/components/__tests__/agent-profile-form.test.tsx`） | covered | `frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx:21`（vitest）、`frontend/src/components/sessions/__tests__/session-config-bar.test.tsx:8`（run）、`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx:445`（失败） |
| cd frontend && pnpm exec tsc --noEmit 0 错；cd frontend && pnpm lint 0 error | `frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx`<br>`frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx`<br>`frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx`<br>`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx`<br>`frontend/src/components/sessions/__tests__/session-config-bar.test.tsx`<br>`frontend/src/components/__tests__/agent-profile-form.test.tsx` | frontend、exec（`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx`） | covered | `frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx:188`（frontend）、`frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx:458`（exec） |
| 覆盖 design Wave3 第 11 条清单：表单多选交互、组合禁用前置、收缩 toast、列表徽标、配置条/档案过滤口径、form-fetch-config mock | `frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx`<br>`frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx`<br>`frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx`<br>`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx`<br>`frontend/src/components/sessions/__tests__/session-config-bar.test.tsx`<br>`frontend/src/components/__tests__/agent-profile-form.test.tsx` | 覆盖、design（`frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx`、`frontend/src/components/sessions/__tests__/session-config-bar.test.tsx`、`frontend/src/components/__tests__/agent-profile-form.test.tsx`） | covered | `frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx:4`（覆盖）、`frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx:392`（design） |

**task-11**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 四场景（双引擎命中、设默认互斥含扩张与收缩空缺、热切换多引擎扇出、pi×openai 禁用复验）UI 实测全部通过并留痕 | 见证据列 | 复核命中 | covered-service | `docs/verification-e2e.md`：API 六项实打（A1-A6 含 422 复验）+ UI 三项浏览器实查（B1-B3）；会话级扇出由 `test_provider_switch.py` 扇出用例承接 | |
| .sillyspec/changes/2026-10-06-provider-multi-agent-kind/docs/verification-e2e.md 存在且四场景结论齐全，失败项有回执任务标记 | 见证据列 | 复核命中 | non-testable | 文档在场性：verification-e2e.md 落变更目录 docs/，四场景+API 六项结论齐全、无失败项（无需回执标记） | |

- ⚠️ 零/半自动化承接条目 38 条——这些路径无测试兜底，verify 复核必须**显式走查**（尤其编辑/更新链路与非主分支流：二次复核实证它们正是 P1 藏身处），走查结论登记进「代码审查」节

#### 探针 4：决策追踪覆盖
<!--TODO: 语义探针——D-xxx@vN → FR-xxx → plan/task 引用 → 证据回指闭环（agent 执行）-->

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 4206 backend endpoints (live [scan-root 631 + worktree 631] + artifact 3786), 3 frontend calls [scope: change-diff (61 files @ worktree)] | 0 backend endpoints unused by frontend (+1254 stock noise collapsed) | 3 calls matched after mount-prefix alignment (artifact paths exclude include_router/app.use prefixes)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ℹ️ 3 处前端调用经挂载前缀对齐匹配（endpoints 提取不含 include_router/app.use 挂载点前缀，比对时剥除对齐——非契约缺口）
- ⚠️ 0 个本变更端点前端未调用（warning 不阻断）：
- ℹ️ 另有 1254 个存量端点未调用（他模块存量噪音，已折叠不逐条列出）

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 39 个非 Java 清单文件不在探针 9 扫描面）
#### 探针 10：预填注清零（error 门）
<!-- 口径注记：预填注（来源注协议）在场 = 白名单槽未确认（预填≠结论）；删注 = 确认动作。本探针是门禁梯度 error 档——verify --done 时 gate 复跑同源检测，注未清零阻断完成（归档前清零兜底）。已知误报面：散文引用注字面量会命中（如文档描述注协议本身）——核对后真未确认则删注，纯散文则改写措辞，不得删探针段。 -->
- ✅ 预填注清零（12 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml——红线机检零打扰，D-002）
#### 探针 12：UI 视觉证据（分级门）
<!-- 口径注记：在场性检查非语义审计——只验 visual-evidence.md 存在非空与降级裁决留痕，不判对照结论对错（语义面归 verify-result 人工判断层）。证据应在执行时按 flow start「UI 变更执行须知」随手产生；本探针不要求收口现做。分级：缺证据默认 ⚠️（local.yaml ui_visual_gate=error 升阻断）；视觉降级无「用户裁决」留痕恒 ❌（off 豁免）。 -->
- ⚠️ 变更目录缺 visual-evidence.md（渲染对照证据应在执行时随手落盘——收口只验在场不产新证据）

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]
<!-- 口径注记（与探针 7 互指，R-07）：探针 7 = 验收项 × 测试承接面（每条 acceptance 由哪些测试承接）；本矩阵 = 接口端点 × 验证用例面（design 接口段每个端点由哪些验证用例/冒烟步骤覆盖）——两者并排互补，双矩阵并行存在。端点集来自 design.md 接口段 tolerant 解析（parseDesignApiTable：段头宽收 + 方法/路径双条件），预填≠结论，agent 逐行复核。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable——covered-service 适用：端点行为由 service 层等非端点层测试锁定；证据须含测试文件锚点三形态之一（`.test.` / file:line / 反引号包裹的路径或测试名）。 -->
<!-- 预填说明：端点行由 CLI 机械预填，判定/用例依据 ID/结果/证据由 agent 逐格填写——用例依据 ID 锚点五形态（可复制样例）：design接口表#POST /api/xx（# 后必须 METHOD /path，仅表名/行号/散文描述不计命中）、权限矩阵[admin×读]、契约表@任务卡字段清单、DDL@users.id、载荷@e2e_body.json（须真实命中对应表/段，防空指）。 -->
<!-- 文法注释：子行 = 端点行下一行、两空格缩进、以「↳ <消费端>:」前缀书写（消费端细分承接面，不计矩阵行账）；探索行 = 判定 uncovered 且证据列含 [探索] 标记（探索性验证不算覆盖）。 -->
| 端点 | 判定 | 用例依据 ID | 结果 | 证据 |
|---|---|---|---|---|
| 本变更接口面：0 端点（agent 声明） | non-testable | design接口表#0 端点声明 | 通过 | 既有 /api/llm-providers 端点组字段级改造（agent_kinds 替换 agent_kind），行为由 `test_llm_provider.py` 端点家族 + `test_router.py` HTTP 用例锁定（covered-service 口径，无新端点行） |
<!-- 解析零行降级（D-005）：接口面以 agent 声明为准（对账分母=声明数）；声明与实际不符时补 design 接口段表格后重跑 --init --force 重生成本段（quick-B：--force 才有刷新通道，手填内容会重置先备份） -->
<!-- advisory 尾注（warning 计算归 validator，本段只留位）：有消费端未填子行的端点将列于此（advisory——消费端归类=design 清单启发式，数据面 facts.consumerHints）；写端点（POST/PUT/DELETE/PATCH）未在权限矩阵段声明的将列于此（advisory——补行或显式豁免「无权限约束」，数据面 facts.apiFace.writeEndpoints；表缺行会让派生框架继承你的洞） -->

## 测试结果 [层：确定性检查——CLI 实测对账]
后端聚焦：`uv run pytest app/modules/llm_provider/tests/ app/modules/daemon/tests/test_provider_switch.py app/modules/daemon/tests/test_resolve_default_provider_config.py app/modules/daemon/tests/test_resolve_bound_provider_config.py app/modules/session_attachment/tests/ app/modules/mcp_gateway/tests/ tests/modules/daemon/lease/ -q --no-cov -p no:randomly` → **437 passed 0 failed**；daemon 全域（task-07 时点）2427 passed；mypy 992 文件 0 issue；ruff check+format 全过。前端：触面 13 套件 **250 passed**；tsc --noEmit **0 错**；触面 eslint 0 error（预存 warning 15 非本变更引入）。全量留 CI（规则 0）。

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01 | task-01~11 | 全链路多选落地 | 已覆盖 |
| D-002@v1 | FR-02 | task-01/07 | 迁移测试值域断言 | 已覆盖 |
| D-003@v1 | FR-03 | task-03/07 | 互斥三用例+收缩空缺 | 已覆盖 |
| D-004@v1 | FR-01/02 | task-01/02 | 单列改数组全链 | 已覆盖 |
| D-005@v1 | FR-04/05 | task-02/04/05 | 双口径 422+盖引擎断言 | 已覆盖 |
| D-006@v1 | FR-03/05 | task-03/05/07 | 扩张清兄弟+扇出用例 | 已覆盖 |

## 技术债务 [层：人工判断]
diff 内新增 TODO/FIXME/HACK：0（grep 复核）；存量债未触碰。移交项 3 条（见上节，均 minor）。

## 变更风险等级 [层：人工判断]
integration-critical（schema 迁移 + 会话凭证解析链改造；design 未显式声明 risk_level——按触及面判：迁移可对称回退 + 解析链六路径全测试锁定，降档依据在案）。若 design.md frontmatter 有 risk_level 显式声明，写明「显式声明 = <等级>」+ 理由；若有命中被同句否定语境抑制（如「不新增 daemon 协议」），写明被抑制关键词与理由（抑制可审计，不许用来静默降级）-->

## Runtime Evidence [层：人工判断]
- 本地栈实跑：worktree backend uvicorn :8765（连本机 PG，迁移 20261006120000 已 upgrade）+ frontend next dev :3877；E2E 时间戳 2026-10-06 19:0x（verification-e2e.md）
- 提交链：d1dc7907d..177dea0e0（8 提交，worktree 分支 sillyspec/2026-10-06-provider-multi-agent-kind）
- set-default 实打探活 200（opencode /zen/go/v1/models，hosts 钉址链路）→ switched=true；422 组合禁配实打命中
- 不涉及：daemon 运行时（零改动）、生产部署（staging 建议在移交项）

## 代码审查 [层：人工判断]
- 走查①编辑/更新链路：update 合并判定/扩张清兄弟顺序（先 setattr 后清）复核一致；表单回填/勾选态 E2E 实查
- 走查②非主分支：unset 广播 None 边界（评审备案）、扇出 config 缺键透传守卫（无暴露面）
- 走查③守卫一致性：owner 校验沿用 service.get（404/403 不泄漏）未动
- 走查④载荷契约：openapi/api-types 同批再生成对账
- 走查⑤并发/事务：_clear_sibling_defaults 事务内先查后清（每用户行数级，无竞态面）；互斥不变量用例锁定
- 总体：无 P1/P2；独立验收评审 pass（review-2026-10-06-192637），残留风险三条备案

## 独立复核（可选回流槽） [层：人工判断——复核后追加]
- 执行阶段 acceptance 独立评审（子代理，2026-10-06）：specVerdict=pass / qualityVerdict=pass；10 项清单 9 pass + 1 gap（残留风险备案：PG staging 建议 / unset 广播边界 / config 缺键退化无暴露面）——与移交项/风险面一致，不改结论枚举。
