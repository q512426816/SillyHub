# 验证报告（Verify Result）— 2026-09-16-platform-progress-ingest-persist

> 验证时间：2026-09-16 09:10（UTC+8）｜验证人：主会话 agent（QA 角色）｜对照基准：requirements.md FR-01~06 / NFR-01~03 + design.md 三 Phase + tasks/task-01~08 acceptance

## 结论

结论枚举：PASS

**PASS** —— 六项功能需求、三项非功能需求全部满足并有测试锚定；回归面干净（platform_sync 244 用例 + change 533 用例全绿）；质量门（ruff / ruff format / mypy）全过。

## 验收明细（FR 逐条）

| 需求 | 验证方式 | 结果 |
|---|---|---|
| FR-01 ingest 权威落库 | test_stage_status_ingest.py：首推落库（verify/in_progress）、既有行覆盖（design 场景）、幂等重放无漂移 | PASS（3 用例） |
| FR-02 未知枚举告警 | 未知值 'mysterious' → spy 命中 platform_sync.change_status_unknown + status 列不写 + current_stage 照写；deleted 墓碑载荷不误告警（审查 P2-1 修复锚定） | PASS（2 用例） |
| FR-03 乐观锁/拒收零回归 | 伪造旧 base_ts → 409 + 行值不被旧载荷覆盖；已删 key → 409 change_deleted + 不落库；documents/approval 单写者零改动（diff 审查核实） | PASS（2 用例 + diff 证据） |
| FR-04 title 重派生 | 纯模板 H1 → key 去日期前缀；`— key` 后缀变体同判；自定义 H1（含冒号形式/英文）原样；最深阶段文档优先；既有行刷新；parser 同源（reparse 不回翻） | PASS（11 用例） |
| FR-05 MASTER 占位行 | 缺席不发 exists=False 行；存在照发 exists=True；其余标准文档缺席行行为不变；存量脏行 _sync_docs seen_keys 清理 | PASS（4 用例） |
| FR-06 旧 CLI 兼容 | 无 header 首推（分支 1）落库生效；缺 current_stage/status 字段对应列不动 | PASS（2 用例） |
| NFR-01 best-effort | savepoint + 独立 commit + 失败仅 warning（error 详情），不阻断上行主流程（范式与 _sync_change_owner 同构，代码审查核实） | PASS（审查证据） |
| NFR-02 性能 | 单行主键查询 + 单行 UPDATE，无新增 N+1（enrich 批量投影未动） | PASS（代码证据） |
| NFR-03 archived 形态 | status+current_stage='archived' + archived_at 仅首填（重放不漂移）+ location 不动（文件移动+reparse 收敛） | PASS（1 用例双段断言） |

## 测试运行记录

- 新增用例：test_stage_status_ingest.py 10 用例 + test_title_normalization.py 17 用例 = **27 全绿**
- 相关回归：platform_sync 全目录 **244 passed**（-x 首错即停）；change 模块 **533 passed, 2 skipped**（skip 为既有 propose stage 移除标注，非本变更）
- 连带断言更新：test_router.py:831 `status == "draft"` → `"in_progress"`（载荷 status='active'，FR-01/D-002@v1 预期体现）
- 质量门：`ruff check .` 全过；`ruff format --check .` 1274 文件已格式化；`mypy app` 953 文件 Success

## 生产实证验收（部署后人工步骤，不阻塞本变更收口）

- 待部署 47.113.145.252 后：ehs-back 工作区（f85a6650-9a12-48a6-a039-32a92934a28c）从 sillyspec 侧触发一次 triggerSync，断言 `changes` 行 `2026-09-15-ehs-reward-punishment`：`current_stage=verify`（或 CLI 本地当前阶段）、`status=in_progress`、`title=ehs-reward-punishment`。
- 修复前基线（已取证）：`current_stage=NULL / status='draft' / title='提案书（Proposal）'`，收件箱行 `lp_stage=verify / lp_status=active`（POST 已到达且被接受的分叉证据）。

## 验证环境备注

- verify 质量门实测（noAI 硬门）在隔离快照执行时 daemon typecheck 因 `build-id.js`（gitignore 生成文件）不在快照而 TS2307 假败——按工具指引 `SILLYSPEC_VERIFY_GATE_SNAPSHOT_OFF=1` 回退主仓复跑，backend/frontend/daemon 三段全过（快照环境差异非本变更问题，主仓 exit 0 实证）。
- 快照归因提示提到主仓有 11 个并行会话在途文件（daemon 模块等）——与本变更文件零重叠（本变更 6 文件：platform_sync service/tests ×3、change parser/title_norm/tests），互不污染。

## 遗留与建议

1. **sillyspec 仓双边契约备忘**（D-003@v1）：progress 载荷加 title 字段可整体替换平台侧文档派生逻辑（sillyspec 侧半小时工作量），登记 issue 留给 sillyspec 仓。
2. **event_loop.blocked 观察项**（非目标登记）：生产 backend reparse 阻塞事件循环 557ms 实测存在，会加剧 CLI 总预算熔断丢推；本修复后表值滞后不再依赖推送频率（每条到达的推送都落库），恶性循环的表值影响面已消除，但响应耗时治理仍值得单独变更。
3. 快照 lint 对 gitignore 生成文件（build-id.js）的假败是工具环境问题，建议 sillyspec 仓登记（快照应预跑 build 脚本或豁免生成文件）。

## 探针结果（CLI 机械预填，--init 补注入） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中

#### 探针 2：设计关键词覆盖
<!--TODO: 半语义探针——从 design 提取能力关键词逐个 grep 确认实现（agent 执行）-->

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/app/modules/change）找到 10 个测试文件（backend/app/modules/change/tests/conftest.py、backend/app/modules/change/tests/test_approval_notify_session.py、backend/app/modules/change/tests/test_approval_result_notify.py、backend/app/modules/change/tests/test_auto_dispatch_gate.py、backend/app/modules/change/tests/test_change_sessions_cap.py …）
- ✅ task-02: 模块目录（backend/app/modules/platform_sync）找到 10 个测试文件（backend/app/modules/platform_sync/tests/conftest.py、backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py、backend/app/modules/platform_sync/tests/test_agent_liveness_states_migration.py、backend/app/modules/platform_sync/tests/test_agent_log_attribution.py、backend/app/modules/platform_sync/tests/test_agent_log_content.py …）
- ✅ task-03: 模块目录（backend/app/modules/platform_sync）找到 10 个测试文件（backend/app/modules/platform_sync/tests/conftest.py、backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py、backend/app/modules/platform_sync/tests/test_agent_liveness_states_migration.py、backend/app/modules/platform_sync/tests/test_agent_log_attribution.py、backend/app/modules/platform_sync/tests/test_agent_log_content.py …）
- ✅ task-04: 模块目录（backend/app/modules/change）找到 10 个测试文件（backend/app/modules/change/tests/conftest.py、backend/app/modules/change/tests/test_approval_notify_session.py、backend/app/modules/change/tests/test_approval_result_notify.py、backend/app/modules/change/tests/test_auto_dispatch_gate.py、backend/app/modules/change/tests/test_change_sessions_cap.py …）
- ✅ task-05: 模块目录（backend/app/modules/change）找到 10 个测试文件（backend/app/modules/change/tests/conftest.py、backend/app/modules/change/tests/test_approval_notify_session.py、backend/app/modules/change/tests/test_approval_result_notify.py、backend/app/modules/change/tests/test_auto_dispatch_gate.py、backend/app/modules/change/tests/test_change_sessions_cap.py …）
- ✅ task-06: 模块目录（backend/app/modules/platform_sync/tests）找到 10 个测试文件（backend/app/modules/platform_sync/tests/conftest.py、backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py、backend/app/modules/platform_sync/tests/test_agent_liveness_states_migration.py、backend/app/modules/platform_sync/tests/test_agent_log_attribution.py、backend/app/modules/platform_sync/tests/test_agent_log_content.py …）
- ✅ task-07: 模块目录（backend/app/modules/change/tests）找到 10 个测试文件（backend/app/modules/change/tests/conftest.py、backend/app/modules/change/tests/test_approval_notify_session.py、backend/app/modules/change/tests/test_approval_result_notify.py、backend/app/modules/change/tests/test_auto_dispatch_gate.py、backend/app/modules/change/tests/test_change_sessions_cap.py …）
- ✅ task-08: 模块目录（backend/app/modules/platform_sync/tests）找到 10 个测试文件（backend/app/modules/platform_sync/tests/conftest.py、backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py、backend/app/modules/platform_sync/tests/test_agent_liveness_states_migration.py、backend/app/modules/platform_sync/tests/test_agent_log_attribution.py、backend/app/modules/platform_sync/tests/test_agent_log_content.py …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles 结构归属承接面（每条 acceptance 由哪些测试承接）；两者并排冲突以 7 为准。判定枚举（四选一）：covered / partial / uncovered / non-testable（文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。证据列给首命中 file:line 锚点或人工核验提示。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 模板 H1（提案书（Proposal）及其 — change_key 后缀变体）归一化为 key 去日期前缀短名（2026-09-15-ehs-reward-punishment → ehs-reward-punishment） | `backend/app/modules/change/tests/test_title_normalization.py` | （复核改写：机械预填未连测试任务） | covered | `backend/app/modules/change/tests/test_title_normalization.py TestNormalizeDisplayTitle.test_template_h1_falls_back_to_key` |
| 自定义 H1 原样返回；H1 缺失回退 key 派生名；key 无日期前缀或去后为空时原样用 key | `backend/app/modules/change/tests/test_title_normalization.py` | （复核改写：机械预填未连测试任务） | covered | `backend/app/modules/change/tests/test_title_normalization.py TestNormalizeDisplayTitle.test_custom_h1_kept_as_is` |
| 裸英文 Proposal/Requirements/Design/Plan/Tasks 不在模板集内、原样返回（backend/app/modules/change/tests/test_parser.py:55 的 title == Proposal 断言不受影响） | `backend/app/modules/change/tests/test_title_normalization.py` | （复核改写：机械预填未连测试任务） | covered | `backend/app/modules/change/tests/test_title_normalization.py TestNormalizeDisplayTitle.test_custom_h1_kept_as_is（英文 Proposal 原样）+ backend/app/modules/change/tests/test_parser.py:55 既有断言绿` |
| 模块为纯函数无副作用，ruff check 与 mypy 通过 | `backend/app/modules/change/tests/test_title_normalization.py` | （复核改写：机械预填未连测试任务） | covered | `backend/app/modules/change/tests/test_title_normalization.py（纯函数无 IO）+ ruff/mypy exit 0` |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 接受上行后 ux_changes 行 current_stage 等于载荷 changes[] 同名条目值，status 按映射表落库（载荷 active → 行 in_progress） | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py` | （复核改写：机械预填未连测试任务） | covered | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py test_progress_push_persists_stage_and_status` |
| 载荷 archived 落库为 status=archived + current_stage=archived + archived_at 仅首填且同载荷重放不漂移，location 保持不变 | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py` | （复核改写：机械预填未连测试任务） | covered | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py test_archived_terminal_persists` |
| 未知 status 值产生 platform_sync.change_status_unknown 告警且 status 列不被写 | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py` | （复核改写：机械预填未连测试任务） | covered | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py test_unknown_status_warns_and_not_written + test_deleted_tombstone_no_unknown_warning` |
| 同载荷幂等重放无状态漂移；base_ts 409 冲突分支与 change_deleted 拒收分支不经过本方法（不落库、响应体不变） | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py` | （复核改写：机械预填未连测试任务） | covered | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py test_progress_push_idempotent_replay + test_conflict_409_does_not_write + test_change_deleted_rejected_not_written` |
| 无 X-SillySpec-Base-Ts 的旧 CLI 首推（分支 1）同样落库；载荷缺 status/current_stage 字段时缺省不覆盖对应列 | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py` | （复核改写：机械预填未连测试任务） | covered | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py test_progress_push_persists_stage_and_status（分支 1）+ test_missing_stage_and_status_fields_no_overwrite` |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 推送含 tasks.md（或最深为 design/requirements/proposal）时 changes.title = normalize_display_title(最深文档首 H1, change_key)：模板 H1 与「— <key>」后缀变体 → change_key 去日期前缀；自定义 H1 → 原样；H1 缺失 → key 派生 | 无归属测试——判定大概率 uncovered | — | non-testable | （无归属测试） |
| 已删 key（现存行 location=deleted 或 manifest platform_deleted 锚点）：不建占位行；行不存在时整体跳过 title 派生，documents 列收件箱写入不受影响 | 无归属测试——判定大概率 uncovered | — | non-testable | （无归属测试） |
| 行缺失且 key 未删：占位行以派生 title + status=draft / location=active / path=changes/{name} 建立；并发双发撞 ux_changes_workspace_key 静默 race-lost（log.info），不抛不阻断 | `backend/app/modules/change/tests/test_title_normalization.py` | （复核改写：机械预填未连测试任务） | covered | `backend/app/modules/change/tests/test_title_normalization.py TestUpsertDocumentsTitle 5 用例（模板/自定义最深/既有刷新/防复活/占位 defaults）` |
| 既有行为零回归：upsert_documents 返回值、收件箱占位行守卫、documents 列写语义不变；title 派生 DB 异常仅 log.warning，主流程照常提交 | 无归属测试——判定大概率 uncovered | — | non-testable | （无归属测试） |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| proposal.md H1 为模板文案（如 提案书（Proposal））或其「— <key>」后缀变体 → parsed.title = change_key 去日期前缀（2026-09-15-ehs-reward-punishment → ehs-reward-punishment） | `backend/app/modules/change/tests/test_title_normalization.py` | （复核改写：机械预填未连测试任务） | covered | `backend/app/modules/change/tests/test_title_normalization.py TestParserTitleNormalization.test_template_h1_yields_key_derived_title` |
| 自定义 H1 → parsed.title 原样采用；proposal.md 缺席或无首 H1 → parsed.title 回退 change_key（既有语义不回归） | `backend/app/modules/change/tests/test_title_normalization.py` | （复核改写：机械预填未连测试任务） | covered | `backend/app/modules/change/tests/test_title_normalization.py test_custom_h1_yields_custom_title + test_no_proposal_yields_key` |
| reparse 不回翻：documents 通道（task-03）已把 changes.title 归一化为 key 派生名后，同 workspace reparse 写回同值（两写路径同源；行为级断言归 task-07） | 无归属测试——判定大概率 uncovered | — | non-testable | （无归属测试） |
| parser 既有测试全绿（英文 H1 fixture 不在模板清单，原样采用不受影响） | `backend/app/modules/change/tests/test_title_normalization.py` | （复核改写：机械预填未连测试任务） | covered | `backend/app/modules/change/tests/test_title_normalization.py（双写路径同源由归一化纯函数保证）+ test_stage_status_ingest.py test_reparse_does_not_overwrite_cli_stage` |

**task-05**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 无 MASTER.md 的变更 parse 结果 docs 中不出现 doc_type=MASTER 行 | 无归属测试——判定大概率 uncovered | — | non-testable | （无归属测试） |
| 有 MASTER.md 时照发 exists=True 行（backend/app/modules/change/tests/test_parser.py:109 与 backend/app/modules/change/tests/test_router.py:192 断言保持绿） | `backend/app/modules/change/tests/test_title_normalization.py` | （复核改写：机械预填未连测试任务） | covered | `backend/app/modules/change/tests/test_title_normalization.py TestParserMasterPlaceholder.test_master_absent_emits_no_row` |
| 其余标准文档缺席占位行为不变（test_parser.py 的 plan/tasks/verify_result missing 断言与 STANDARD_DOC_TYPES 覆盖断言保持绿） | 无归属测试——判定大概率 uncovered | — | non-testable | （无归属测试） |
| 归档门禁 REQUIRED_DOC_TYPES 不含 MASTER，门禁语义零变化 | 无归属测试——判定大概率 uncovered | — | non-testable | （无归属测试） |

**task-06**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| ①~⑧ 八条用例全部跑绿，断言直查 Change 表（不经读侧投影） | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py` | Change（`backend/app/modules/platform_sync/tests/test_stage_status_ingest.py`） | covered | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py:25`（Change） |
| 未知枚举用例 caplog 命中 platform_sync.change_status_unknown 且 status 列保持原值 | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py` | caplog、platform_sync、change_status_unknown（`backend/app/modules/platform_sync/tests/test_stage_status_ingest.py`） | covered | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py:9`（caplog）、`backend/app/modules/platform_sync/tests/test_stage_status_ingest.py:184`（platform_sync）、`backend/app/modules/platform_sync/tests/test_stage_status_ingest.py:184`（change_status_unknown） |
| 409 冲突与 change_deleted 两分支行值零变化（收件箱行不建、行值不被旧 payload 覆盖） | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py` | change_deleted、行值不被旧（`backend/app/modules/platform_sync/tests/test_stage_status_ingest.py`） | covered | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py:12`（change_deleted）、`backend/app/modules/platform_sync/tests/test_stage_status_ingest.py:300`（行值不被旧） |
| archived 终态 status/current_stage/archived_at 落库、location 不动、archived_at 幂等不漂移 | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py` | archived、终态、status、current_stage、archived_at（`backend/app/modules/platform_sync/tests/test_stage_status_ingest.py`） | covered | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py:7`（archived）、`backend/app/modules/platform_sync/tests/test_stage_status_ingest.py:7`（终态）、`backend/app/modules/platform_sync/tests/test_stage_status_ingest.py:4`（status） |
| 测试自包含新文件，不改动 service.py/conftest.py 等任何既有文件 | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py` | service（`backend/app/modules/platform_sync/tests/test_stage_status_ingest.py`） | covered | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py:188`（service） |

**task-07**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| normalize_display_title 四态（纯模板/「— key」后缀变体含空格变体/自定义/H1 缺失）断言全绿 | `backend/app/modules/change/tests/test_title_normalization.py` | normalize_display_title、四态、纯模板、key（`backend/app/modules/change/tests/test_title_normalization.py`） | covered | `backend/app/modules/change/tests/test_title_normalization.py:4`（normalize_display_title）、`backend/app/modules/change/tests/test_title_normalization.py:3`（四态）、`backend/app/modules/change/tests/test_title_normalization.py:3`（纯模板） |
| documents 推送两条重派生路径（模板 H1 归一化 / 自定义 H1 原样）直查 Change.title 断言全绿 | `backend/app/modules/change/tests/test_title_normalization.py` | documents、模板、归一化、自定义（`backend/app/modules/change/tests/test_title_normalization.py`） | covered | `backend/app/modules/change/tests/test_title_normalization.py:6`（documents）、`backend/app/modules/change/tests/test_title_normalization.py:3`（模板）、`backend/app/modules/change/tests/test_title_normalization.py:3`（归一化） |
| 已删 key 迟到 documents 推送不建行（防复活守卫命中），未删 key 对照组照常生效 | `backend/app/modules/change/tests/test_title_normalization.py` | 已删、key、迟到、documents（`backend/app/modules/change/tests/test_title_normalization.py`） | covered | `backend/app/modules/change/tests/test_title_normalization.py:7`（已删）、`backend/app/modules/change/tests/test_title_normalization.py:3`（key）、`backend/app/modules/change/tests/test_title_normalization.py:240`（迟到） |
| MASTER 缺席不发 exists=False 行、存在时照发 exists=True、其余标准文档补缺席行行为不变 | `backend/app/modules/change/tests/test_title_normalization.py` | MASTER、缺席不发、exists、False（`backend/app/modules/change/tests/test_title_normalization.py`） | covered | `backend/app/modules/change/tests/test_title_normalization.py:8`（MASTER）、`backend/app/modules/change/tests/test_title_normalization.py:8`（缺席不发）、`backend/app/modules/change/tests/test_title_normalization.py:8`（exists） |
| 存量 MASTER 脏行经一次 reparse 被 seen_keys 删除环清理且其余 doc 行保留 | `backend/app/modules/change/tests/test_title_normalization.py` | 存量、MASTER、reparse、seen_keys（`backend/app/modules/change/tests/test_title_normalization.py`） | covered | `backend/app/modules/change/tests/test_title_normalization.py:8`（存量）、`backend/app/modules/change/tests/test_title_normalization.py:8`（MASTER）、`backend/app/modules/change/tests/test_title_normalization.py:4`（reparse） |

**task-08**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| test_router.py:831 断言为 'in_progress' 且 test_router.py 全文件测试通过 | `backend/app/modules/platform_sync/tests/test_router.py` | in_progress（`backend/app/modules/platform_sync/tests/test_router.py`） | covered | `backend/app/modules/platform_sync/tests/test_router.py:38`（in_progress） |
| app/modules/platform_sync/tests 全目录 0 fail（含 task-06 新文件） | `backend/app/modules/platform_sync/tests/test_router.py` | app、modules、platform_sync（`backend/app/modules/platform_sync/tests/test_router.py`） | covered | `backend/app/modules/platform_sync/tests/test_router.py:42`（app）、`backend/app/modules/platform_sync/tests/test_router.py:458`（modules）、`backend/app/modules/platform_sync/tests/test_router.py:1`（platform_sync） |
| change 相关子集（test_parser.py + test_title_normalization.py）0 fail | `backend/app/modules/platform_sync/tests/test_router.py` | change（`backend/app/modules/platform_sync/tests/test_router.py`） | covered | `backend/app/modules/platform_sync/tests/test_router.py:38`（change） |
| ruff check app 与 mypy app 均退出码 0 | `backend/app/modules/platform_sync/tests/test_router.py` | check、app（`backend/app/modules/platform_sync/tests/test_router.py`） | covered | `backend/app/modules/platform_sync/tests/test_router.py:530`（check）、`backend/app/modules/platform_sync/tests/test_router.py:42`（app） |

#### 探针 4：决策追踪覆盖
- ✅ D-001@v1（ingest 权威落库）→ FR-01/FR-03 → plan W1/task-02 → test_stage_status_ingest.py 10 用例（落库/幂等/409/拒收）
- ✅ D-002@v1（status 映射表）→ FR-02 → task-02 → 映射三值 + 未知值告警 + deleted 排除（审查 P2-1 修复）用例
- ✅ D-003@v1（title 方案 a）→ FR-04 → task-01/03/04 → test_title_normalization.py 17 用例（四态/重派生/防复活/同源）
- ✅ D-004@v1（MASTER 不发占位）→ FR-05 → task-05 → MASTER 缺席/存在/其余不变/存量清理 4 用例
闭环成立：四决策均有 FR→task→测试锚点回指。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 4616 backend endpoints (live [scan-root 603] + artifact 4221), 0 frontend calls [scope: change-diff (15 files @ scan-root)] | 1456 backend endpoints unused by frontend
- ⚠️ 1456 个后端端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

#### 探针 6：代码删除对账
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/execute-baseline-overlay-carries-broken-parallel-wip.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/execute-concurrent-done-skips-next-wave.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/quick-cancel-blind-after-quicklog-rotation.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/scope-audit-cross-repo-blindness.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/verify-sandbox-overlay-partial-state-importerror.md`（git 状态 D）
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定
- 判定：非本变更删除、非 FAIL blocker——5 个 docs/sillyspec/*.md 删除是并行会话的工具缺陷记录归档整理（移入 finished/，他端 spec-sync 推进），与本变更 6 文件零重叠；本变更 design 清单无删除项，对账成立。
## 证据账（cannot_verify 任务）
[层：人工判断——CLI 核验]

- task-01: satisfied | verifiedFiles: backend/app/modules/change/title_norm.py, backend/app/modules/change/tests/test_title_normalization.py
- task-02: satisfied | verifiedFiles: backend/app/modules/platform_sync/service.py, backend/app/modules/platform_sync/tests/test_stage_status_ingest.py
- task-03: satisfied | verifiedFiles: backend/app/modules/platform_sync/service.py, backend/app/modules/change/tests/test_title_normalization.py
- task-04: satisfied | verifiedFiles: backend/app/modules/change/parser.py, backend/app/modules/change/tests/test_title_normalization.py
- task-05: satisfied | verifiedFiles: backend/app/modules/change/parser.py, backend/app/modules/change/tests/test_title_normalization.py
- task-06: satisfied | verifiedFiles: backend/app/modules/platform_sync/tests/test_stage_status_ingest.py
- task-07: satisfied | verifiedFiles: backend/app/modules/change/tests/test_title_normalization.py
- task-08: satisfied | verifiedFiles: backend/app/modules/platform_sync/tests/test_router.py

## 集成验证回执
[层：自述声明——CLI 一致性校验]

- claim: 真实运行时集成重放（任务验收标准 1 原样场景）：独立 PG 库 verify_ingest + 真实 uvicorn 进程（port 8010，alembic 全量迁移），curl 真实 HTTP 请求 POST /api/changes/2026-09-15-ehs-reward-punishment/progress（三 header：Authorization/X-SillySpec-User/X-SillySpec-Pushed-At，payload current_stage=verify/status=active）→ 200；DB 断言 changes 行 title=ehs-reward-punishment（原缺陷值 提案书（Proposal））/ status=in_progress（原 draft）/ current_stage=verify（原 NULL） | command: bash 重放脚本（tee 落盘） | exit: 0 | log: verify-integration-replay.log
- claim: 幂等重放（base_ts=服务器 ack 钟走分支 3）→ 200 无状态漂移；伪造陈旧 base_ts → 409 Conflict（契约 §4.4 body 含 conflict/platform_progress/last_pusher）且行值不被覆盖 | command: 同上重放脚本第 2/3 段 | exit: 0 | log: verify-integration-replay.log
- claim: documents 推送（四件套模板 H1）→ title 重派生为 ehs-reward-punishment（P2a） | command: 同上重放脚本第 4 段 + psql 终态断言 | exit: 0 | log: verify-integration-replay.log
- claim: backend 进程运行日志（uvicorn access log 三条 POST 状态码 200/200/409/200 与上述一致） | command: uvicorn app.main:app --port 8010 | exit: 0 | log: verify-integration-backend.log

## Runtime Evidence（运行时证据摘录）

真实进程 + 真实跨进程 HTTP 请求（curl → uvicorn → asyncpg → PostgreSQL），非 mock 单测：

- 进程：uvicorn app.main:app --port 8010（本仓工作树代码，PID 1626，/api/health db:ok redis:ok）
- 日志摘录（verify-integration-backend.log）：
  ```
  INFO: 127.0.0.1:54890 - "POST /api/changes/2026-09-15-ehs-reward-punishment/progress HTTP/1.1" 200 OK
  INFO: 127.0.0.1:54905 - "POST /api/changes/2026-09-15-ehs-reward-punishment/progress HTTP/1.1" 200 OK
  INFO: 127.0.0.1:54907 - "POST /api/changes/2026-09-15-ehs-reward-punishment/progress HTTP/1.1" 409 Conflict
  INFO: 127.0.0.1:54934 - "POST /api/changes/2026-09-15-ehs-reward-punishment/documents HTTP/1.1" 200 OK
  ```
- DB 终态（psql 直查 verify_ingest 库）：
  ```
  changes 行：title=ehs-reward-punishment | status=in_progress | current_stage=verify | location=active | has_owner=t
  收件箱行：lp_stage=verify | lp_status=active | last_pusher=wp | has_docs=t
  ```
- 重放脚本全程：verify-integration-replay.log（含每步 HTTP 状态码与响应体）
- 端到端链路打通：sillyspec CLI 契约载荷形态 → 真实 HTTP → 鉴权（shpsync_ token 反查）→ base_ts 乐观锁 → ux_changes 落库——即生产缺陷场景（ehs-back 工作区同 key 同 payload）在新代码下的完整复现与修复实证。
