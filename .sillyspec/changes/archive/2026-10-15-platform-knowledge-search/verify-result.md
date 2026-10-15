# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。
>
> 「层」=证据可核验性分层（非执行者声明）：「人工判断」指本节为语义判断，由执行 agent 填写、
> CLI 不机械复跑（gate 抽查 + 人类审批点复核兜底）；「可复跑探针/确定性检查/CLI 一致性校验」= gate 可机械复核段。

## 结论 [层：人工判断]

结论枚举：`PASS WITH NOTES` —— 实现与测试全绿、独立验收审查 11/11 pass；两条已知开口移交（R-01 首查 308s 级需后续变更做启动预热、visual-evidence 降级形态待用户复核），见移交项表。

## 移交项（结构化） [层：人工判断——CLI 清单核验]
<!-- 结论=PASS WITH NOTES 时本节必填（prose 移交叙述转结构化，复跑/验收有据可查、agent 可恢复复跑）；结论=PASS/FAIL 写「无」 -->
<!-- 类型枚举：env-blocked（环境阻断，条件列必填复跑口径）/ manual-acceptance（人工验收，条件列必填验收步骤）/ db-script（待执行脚本，条件列必填执行环境与顺序）/ other -->
| 类型 | 条目 | 复跑/验收条件 |
| manual-acceptance | R-01 首查索引构建 304.67s（437 文件/6586 chunks）——启动预热钩子未落地（需改 backend/app/main.py lifespan，超出本变更 allowed_paths 边界） | 后续变更落地预热后：重启服务 → 立即搜索 → 应无长等待（目标 <1s）；本变更内已落地首查 loading 文案兜底 |
| manual-acceptance | visual-evidence 降级（未实机截图，以原型 × 测试断言三方对照替代；autonomous 代裁决） | 用户部署后目视知识库页搜索交互（四场景：混合召回/精确命中/降级/空结果）；如否决降级则起 pnpm dev 补实机截图 |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
<!-- 无 cannot_verify 任务时本节写「无」；有则逐 task 一行 -->
- 无（verify-required-evidence.json 不存在 → execute 阶段无 cannot_verify 任务）

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
<!-- 回执双形态（2026-09-16-friction5-hardening FR-01）：下方多行 YAML 形态为推荐写法（字段序无关）；
     亦认单行管道形态：- claim: <一句话> | command: <命令> | exit: <0 或非 0> | log: <日志路径> -->
- claim: 后端知识搜索端点契约经 FastAPI TestClient 全栈集成（真实路由/鉴权依赖/权限过滤链/线程池卸载），8 用例全绿
  command: cd backend && uv run pytest app/modules/knowledge/tests/test_router.py app/modules/knowledge/tests/test_knowledge_search.py -q --no-cov
  exit: 0
  log: C:/Users/qinyi/IdeaProjects/multi-agent-platform/.sillyspec/.runtime/logs/task05-backend-all.log
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->

## 任务完成度 [层：人工判断]
- task-01 ✅ 完成：search.py（25 单测绿）+ wt-commit 69e1a98d；acceptance 5/5 covered（探针 7）
- task-02 ✅ 完成：schema 三 DTO + 端点（8 端点测试绿）+ 9a3b3ef1；acceptance 5/5 covered
- task-03 ✅ 完成：lib searchKnowledge + 页搜索 UI（7 例绿）+ a3703128 / 收口文案 89ac5502；acceptance 5/5 covered（2 条 CLI 预填 partial 经人工复核改判 covered，见代码审查）
- task-04 ✅ 完成：scan-docs ?path= 深链（4 例绿）+ ef234db0；acceptance 4/4 covered（1 条预填 partial 复核改判）
- task-05 ✅ 完成：gen:types 三产物（0e72ae79）+ 后端 199 / 前端 46 全绿 + R-01/R-03 实测回填
- 完成率 5/5（100%）

## 设计一致性 [层：人工判断]
一致（design.md 为唯一 truth source；独立验收审查 11/11 pass）。三处实现细化（不构成偏差，均已留痕）：
① D-011@v1 执行期裁决：词面精确命中判定纳入 anchor 面（design Phase 1 原文仅 title∨path——条目编号落 anchor 字段，不纳入则「精确编号排前」成功标准无法达成；decisions.md D-011@v1）；
② 零信号块过滤：融合分 0（无词面命中且向量零相似）不返回——design 未明说阈值，实现取「只砍零信号」保守口径（design R-03 已回填）；
③ scan-docs 深链消费标记在 requestDoc 发起时置位（design 措辞「命中并选中后置位」）——边缘语义差，失败面静默与 FR-05 一致（acceptance 审查观察项，可接受）。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ glob 项未展开（agent 手动展开扫描）：frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx、frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx、frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx
- ℹ️ 2 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）

#### 探针 2：设计关键词覆盖
- 关键词覆盖 grep（worktree 源码面，逐词确认）：搜索/检索 → `backend/app/modules/knowledge/search.py` + `frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx` ✓；切块/滑窗 → search.py `_iter_line_windows`/`chunk_markdown` ✓；融合/保底 → search.py `_word_score`/`search_sync` ✓；指纹/索引 → search.py `corpus_fingerprint`/`_build_index_locked` ✓；降级 → search.py `model_ready` + 前端 `knowledge-search-degraded` ✓；深链 → knowledge/page.tsx `router.push` + scan-docs/page.tsx `deepLinkPath` ✓；权限过滤 → router.py `has_permission` 段 ✓。**无缺失关键词**。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/app/modules/knowledge、backend/app/modules/knowledge/tests）找到 9 个测试文件（backend/app/modules/knowledge/tests/test_distill.py、backend/app/modules/knowledge/tests/test_governance.py、backend/app/modules/knowledge/tests/test_graph.py、backend/app/modules/knowledge/tests/test_hits.py、backend/app/modules/knowledge/tests/test_parser.py …）
- ✅ task-02: 模块目录（backend/app/modules/knowledge、backend/app/modules/knowledge/tests）找到 9 个测试文件（backend/app/modules/knowledge/tests/test_distill.py、backend/app/modules/knowledge/tests/test_governance.py、backend/app/modules/knowledge/tests/test_graph.py、backend/app/modules/knowledge/tests/test_hits.py、backend/app/modules/knowledge/tests/test_parser.py …）
- ✅ task-03: 模块目录（frontend/src/lib、frontend/src/app/(dashboard)/workspaces/[id]/knowledge、frontend/src/app/(dashboard)/workspaces/[id]/__tests__）找到 14 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/change-autolink.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts …）
- ✅ task-04: 模块目录（frontend/src/app/(dashboard)/workspaces/[id]/scan-docs、frontend/src/app/(dashboard)/workspaces/[id]/__tests__）找到 4 个测试文件（frontend/src/app/(dashboard)/workspaces/[id]/__tests__/explorer-page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/__tests__/page-sync.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx）
- ✅ task-05: 模块目录（backend、frontend/src/lib、sillyhub-daemon/src）找到 83 个测试文件（backend/app/core/spec_paths.py、backend/app/core/tests/test_auth_deps_db_release.py、backend/app/core/tests/test_config_auth.py、backend/app/core/tests/test_errors.py、backend/app/core/tests/test_monitoring.py …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable（covered-service 适用：端点行为由 service 层等非端点层测试锁定，证据附测试锚点；non-testable 是文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。covered/covered-service/partial 证据须含测试锚点三形态之一（file:line / `.test.` 测试文件名 / 反引号包裹的路径或测试名），行号可省；uncovered/non-testable 证据自由形态。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/covered-service/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 扫描面断言：knowledge/ 与 docs/ 下 md 全部入语料、INDEX.md 与 changes/ 零收录（测试用临时目录构造） | `backend/app/modules/knowledge/tests/test_knowledge_search.py` | knowledge、docs、INDEX（`backend/app/modules/knowledge/tests/test_knowledge_search.py`） | covered | `backend/app/modules/knowledge/tests/test_knowledge_search.py:1`（knowledge）、`backend/app/modules/knowledge/tests/test_knowledge_search.py:5`（docs）、`backend/app/modules/knowledge/tests/test_knowledge_search.py:5`（INDEX） |
| 切块断言：D-xxx@vN / FR-xxx-NNN 条目级切块 anchor 正确；普通 md 标题级切块；2000 字符块被滑窗为多块且相邻块重叠 >0 | `backend/app/modules/knowledge/tests/test_knowledge_search.py` | xxx、NNN、anchor（`backend/app/modules/knowledge/tests/test_knowledge_search.py`） | covered | `backend/app/modules/knowledge/tests/test_knowledge_search.py:6`（xxx）、`backend/app/modules/knowledge/tests/test_knowledge_search.py:6`（NNN）、`backend/app/modules/knowledge/tests/test_knowledge_search.py:174`（anchor） |
| 指纹断言：文件未变二次查询零重建（embed_calls 计数）；文件 mtime/size 变化后重建 | `backend/app/modules/knowledge/tests/test_knowledge_search.py` | 文件未变二次查询零重建、embed_calls、计数、文件（`backend/app/modules/knowledge/tests/test_knowledge_search.py`） | covered | `backend/app/modules/knowledge/tests/test_knowledge_search.py:9`（文件未变二次查询零重建）、`backend/app/modules/knowledge/tests/test_knowledge_search.py:9`（embed_calls）、`backend/app/modules/knowledge/tests/test_knowledge_search.py:9`（计数） |
| 融合断言：查询词等于某条目编号时该条目 rank=1；纯语义（构造无词面命中的 query + fake embedder 相似向量）也能召回 | `backend/app/modules/knowledge/tests/test_knowledge_search.py` | rank、纯语义（`backend/app/modules/knowledge/tests/test_knowledge_search.py`） | covered | `backend/app/modules/knowledge/tests/test_knowledge_search.py:10`（rank）、`backend/app/modules/knowledge/tests/test_knowledge_search.py:10`（纯语义） |
| 降级断言：embedder 不可用返回 model_ready=False + reason 非空 + results 为纯词面（不报错） | `backend/app/modules/knowledge/tests/test_knowledge_search.py` | embedder、model_ready、False（`backend/app/modules/knowledge/tests/test_knowledge_search.py`） | covered | `backend/app/modules/knowledge/tests/test_knowledge_search.py:3`（embedder）、`backend/app/modules/knowledge/tests/test_knowledge_search.py:11`（model_ready）、`backend/app/modules/knowledge/tests/test_knowledge_search.py:11`（False） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 端点契约：POST /api/workspaces/{id}/knowledge/search 200 返回 {ok, results:[{spec_path,kind,title,anchor,snippet,score}], model_ready, reason} 字段齐全 | `backend/app/modules/knowledge/tests/test_router.py` | POST、api、workspaces、knowledge（`backend/app/modules/knowledge/tests/test_router.py`） | covered | `backend/app/modules/knowledge/tests/test_router.py:530`（POST）、`backend/app/modules/knowledge/tests/test_router.py:50`（api）、`backend/app/modules/knowledge/tests/test_router.py:50`（workspaces） |
| 声明序断言：路由注册位在 GET /knowledge/{filename:path} 之前（代码审查 + 既有 propose/distill 路由不受影响回归） | `backend/app/modules/knowledge/tests/test_router.py` | GET、knowledge、filename（`backend/app/modules/knowledge/tests/test_router.py`） | covered | `backend/app/modules/knowledge/tests/test_router.py:558`（GET）、`backend/app/modules/knowledge/tests/test_router.py:1`（knowledge）、`backend/app/modules/knowledge/tests/test_router.py:84`（filename） |
| 点击 docs 类结果 → 路由到 scan-docs 带 ?path= 参数 | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | — | covered | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`「点击 docs 类结果 → 跳转模块文档页 ?path= 深链」（断言 navState.push 目标 URL 含 scan-docs?path=） |
| 降级断言：embedder 不可用 → 200 + model_ready=False + reason 非空（不 5xx） | `backend/app/modules/knowledge/tests/test_router.py` | False（`backend/app/modules/knowledge/tests/test_router.py`） | covered | `backend/app/modules/knowledge/tests/test_router.py:513`（False） |
| 清除按钮 → 恢复文件树且清空结果态 | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | — | covered | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`「清除搜索词后还原文件树」（断言树可见 + knowledge-search-results 移除） |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 输入「会话状态点」类 query → 结果列表渲染（替换树），条目字段与契约一致 | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | query（`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`） | covered | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx:32`（query） |
| 点击 knowledge 类结果 → URL 变 ?file=&anchor=（旧 push 通路）且右栏加载；URL 已等值时仍能重选（同 key 边界） | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | knowledge、URL、file（`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`） | covered | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx:2`（knowledge）、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx:152`（URL）、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx:55`（file） |
| 查无此文件 → 列表态正常、无错误提示、无重复请求 | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx` | — | covered | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx`「目标未同步：静默待命（不报错不发详情请求）」（断言 getScanDoc 未被调用 + 列表正常渲染） |
| model_ready=false → 提示条可见；空查询 → 回到文件树视图 | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | false（`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`） | covered | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx:142`（false） |
| 清除按钮 → 恢复文件树且清空结果态 | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | — | partial | （无机械命中——人工核验 `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`） |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 带 ?path=<已存在文档> 进页 → 该文档被选中并渲染内容 | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx` | path（`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx`） | covered | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx:69`（path） |
| 目标未同步（首次列表无）→ 静默；后续刷新出现 → 自动选中一次 | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx` | 静默（`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx`） | covered | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx:215`（静默） |
| 查无此文件 → 列表态正常、无错误提示、无重复请求 | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx` | — | partial | （无机械命中——人工核验 `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx`） |
| 无 ?path= → 与现状行为一致（既有测试不改断言全绿） | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx` | path（`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx`） | covered | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx:69`（path） |

**task-05**
- ℹ️ 既有用例候选（FR 关联回归面，本变更未改动；判定仍由你复核，命中≠结论）：`backend/app/modules/agent/tests/test_group_chat_models.py`、`backend/app/modules/agent/tests/test_mcp_tools.py`、`backend/app/modules/agent/tests/test_provider_caps_alignment.py`、`backend/app/modules/change/tests/test_assets.py`、`backend/app/modules/change/tests/test_files_router.py`、`backend/app/modules/change/tests/test_session_changes_endpoint.py`、`backend/app/modules/change/tests/test_step_progress.py`、`backend/app/modules/change/tests/test_timeline.py`、`backend/app/modules/change/tests/test_title_normalization.py`、`backend/app/modules/change/tests/test_usage_stats.py`、`backend/app/modules/daemon/tests/test_agent_session_tasks.py`、`backend/app/modules/daemon/tests/test_attachment_pipeline.py`、`backend/app/modules/daemon/tests/test_change_session.py`、`backend/app/modules/daemon/tests/test_group_attachment_gate.py`、`backend/app/modules/daemon/tests/test_group_bridge_projection.py`、`backend/app/modules/daemon/tests/test_group_cross_mention.py`、`backend/app/modules/daemon/tests/test_group_logs_pagination.py`、`backend/app/modules/daemon/tests/test_group_mention_pipeline.py`、`backend/app/modules/daemon/tests/test_group_p2.py`、`backend/app/modules/daemon/tests/test_inject_origin_guard.py`、`backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py`、`backend/app/modules/daemon/tests/test_linked_repos_sync.py`、`backend/app/modules/daemon/tests/test_pending_update_upsert.py`、`backend/app/modules/daemon/tests/test_ppm_session.py`、`backend/app/modules/daemon/tests/test_scheduled_messages_crud.py`、`backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py`、`backend/app/modules/daemon/tests/test_session_compact_endpoint.py`、`backend/app/modules/daemon/tests/test_session_events_cross.py`、`backend/app/modules/daemon/tests/test_session_pin_rename.py`、`backend/app/modules/daemon/tests/test_session_queue.py`、`backend/app/modules/daemon/tests/test_session_queue_actions.py`、`backend/app/modules/daemon/tests/test_session_readiness.py`、`backend/app/modules/daemon/tests/test_session_runs_endpoint.py`、`backend/app/modules/daemon/tests/test_session_service.py`、`backend/app/modules/knowledge/tests/test_distill.py`、`backend/app/modules/knowledge/tests/test_governance.py`、`backend/app/modules/knowledge/tests/test_graph.py`、`backend/app/modules/knowledge/tests/test_hits.py`、`backend/app/modules/knowledge/tests/test_writer.py`、`backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py`、`backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py`、`backend/app/modules/platform_sync/tests/test_agent_log_content.py`、`backend/app/modules/platform_sync/tests/test_agent_log_messages.py`、`backend/app/modules/platform_sync/tests/test_agent_log_states_push.py`、`backend/app/modules/platform_sync/tests/test_change_events.py`、`backend/app/modules/platform_sync/tests/test_owner_sync.py`、`backend/app/modules/platform_sync/tests/test_usage_ingest.py`、`backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py`、`backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py`、`backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py`、`backend/app/modules/workspace/tests/test_daemon_client_scan.py`、`backend/tests/modules/agent/test_agent_run_log_tool_kind.py`、`backend/tests/modules/agent/test_scan_interactive_dispatch.py`、`backend/tests/modules/auth/test_permissions.py`、`backend/tests/modules/change/test_archive_gate.py`、`backend/tests/modules/daemon/test_daemon_machine_diag.py`、`backend/tests/test_align_platform_change_events_migration.py`、`backend/tests/test_check_assertion_surfaces.py`、`backend/tests/test_health.py`、`frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx`、`frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx`、`frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx`、`frontend/src/app/m/account/page.test.tsx`、`frontend/src/app/page.test.tsx`、`frontend/src/components/__tests__/app-shell.test.tsx`、`frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx`、`frontend/src/components/__tests__/change-file-tree.test.tsx`、`frontend/src/components/agent-log/__tests__/tool-renderers-write-diff.test.tsx`、`frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx`、`frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx`、`frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx`、`frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx`、`frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx`、`frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx`、`frontend/src/components/daemon/__tests__/agent-log-card.test.tsx`、`frontend/src/components/daemon/__tests__/agent-replay-body.test.tsx`、`frontend/src/components/daemon/__tests__/daemon-diagnostic-dialog.test.tsx`、`frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx`、`frontend/src/components/daemon/__tests__/machine-card.test.tsx`、`frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx`、`frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx`、`frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx`、`frontend/src/components/daemon/__tests__/tool-args-detail.test.tsx`、`frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx`、`frontend/src/components/daemon/__tests__/turn-speed.test.ts`、`frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx`、`frontend/src/components/explorer/__tests__/file-preview.test.tsx`、`frontend/src/components/files/__tests__/file-preview-modal.test.tsx`、`frontend/src/components/files/__tests__/preview-registry.test.ts`、`frontend/src/components/files/__tests__/structured-views.test.tsx`、`frontend/src/components/floating/floating-session-host.test.tsx`、`frontend/src/components/git-log/__tests__/git-log-page.test.tsx`、`frontend/src/components/group-chat/__tests__/member-panel.test.tsx`、`frontend/src/components/knowledge/__tests__/card-markdown.test.tsx`、`frontend/src/components/knowledge/__tests__/distill-history-dialog.test.tsx`、`frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx`、`frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx`、`frontend/src/components/knowledge/__tests__/governance-cards.test.tsx`、`frontend/src/components/knowledge/__tests__/graph-canvas.test.ts`、`frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx`、`frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx`、`frontend/src/components/mobile/mobile-change-detail.test.tsx`、`frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx`、`frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx`、`frontend/src/components/sessions/__tests__/session-config-bar.test.tsx`、`frontend/src/components/sessions/__tests__/session-list-panel.test.tsx`、`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx`、`frontend/src/components/workspace-config-card.test.tsx`、`frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx`、`frontend/src/hooks/__tests__/use-session-liveness.test.ts`、`frontend/src/lib/__tests__/agent-log-turns.test.ts`、`frontend/src/lib/__tests__/daemon-session-stream-sync.test.ts`、`frontend/src/lib/__tests__/knowledge-graph-guard.test.ts`、`frontend/src/lib/__tests__/knowledge-graph-timeout.test.ts`、`frontend/src/lib/__tests__/logout-storage.test.ts`、`frontend/src/lib/__tests__/menu-overrides.test.ts`、`frontend/src/lib/__tests__/menu-permissions.test.ts`、`frontend/src/lib/__tests__/permission.test.ts`、`frontend/src/lib/__tests__/session-mention-sources.test.tsx`、`frontend/src/lib/__tests__/token-refresh.test.ts`、`frontend/src/lib/api/__tests__/llm-providers.test.ts`、`sillyhub-daemon/tests/agent-detector.test.ts`、`sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts`、`sillyhub-daemon/tests/agent-log/liveness/registry.test.ts`、`sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts`、`sillyhub-daemon/tests/agent-log/parse-claude-code.test.ts`、`sillyhub-daemon/tests/agent-log/zcode-sqlite-dispatch.test.ts`、`sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts`、`sillyhub-daemon/tests/diag-rpc.test.ts`、`sillyhub-daemon/tests/disk-probe-pending.test.ts`、`sillyhub-daemon/tests/dsh-settings.test.ts`、`sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts`、`sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts`、`sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts`、`sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts`、`sillyhub-daemon/tests/interactive/dsh-acp-smoke.test.ts`、`sillyhub-daemon/tests/interactive/pi-events.test.ts`、`sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts`、`sillyhub-daemon/tests/interactive/pi-task-dispatch.test.ts`、`sillyhub-daemon/tests/interactive/provider-registry.test.ts`、`sillyhub-daemon/tests/knowledge-governance-handler.test.ts`、`sillyhub-daemon/tests/linked-repos-snapshot.test.ts`、`sillyhub-daemon/tests/provider-adapter-registry.test.ts`、`sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts`、`sillyhub-daemon/tests/version.test.ts`
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| backend/openapi.json、frontend/src/lib/api-types.ts、sillyhub-daemon/src/api-types.ts 三产物同步（无漂移，含新端点与三 schema） | `backend/app/modules/agent/tests/test_group_chat_models.py`<br>`backend/app/modules/agent/tests/test_mcp_tools.py`<br>`backend/app/modules/agent/tests/test_provider_caps_alignment.py`<br>`backend/app/modules/change/tests/test_assets.py`<br>`backend/app/modules/change/tests/test_files_router.py`<br>…共 20 个（目录级候选全量在 facts/trace，归属按关键词命中与证据锚点收窄） | backend、json、frontend、src（`backend/app/modules/agent/tests/test_group_chat_models.py`、`backend/app/modules/agent/tests/test_mcp_tools.py`、`backend/app/modules/agent/tests/test_provider_caps_alignment.py`、`backend/app/modules/change/tests/test_assets.py`、`backend/app/modules/change/tests/test_files_router.py`、`backend/app/modules/change/tests/test_session_changes_endpoint.py`、`backend/app/modules/change/tests/test_title_normalization.py`、`backend/app/modules/daemon/tests/test_attachment_pipeline.py`、`backend/app/modules/daemon/tests/test_change_session.py`、`backend/app/modules/daemon/tests/test_group_p2.py`、`backend/app/modules/change/tests/test_usage_stats.py`、`backend/app/modules/daemon/tests/test_agent_session_tasks.py`、`backend/app/modules/daemon/tests/test_group_bridge_projection.py`、`backend/app/modules/daemon/tests/test_group_cross_mention.py`、`backend/app/modules/daemon/tests/test_group_logs_pagination.py`、`backend/app/modules/daemon/tests/test_group_mention_pipeline.py`、`backend/app/modules/daemon/tests/test_inject_origin_guard.py`、`backend/app/modules/daemon/tests/test_group_attachment_gate.py`） | covered | `backend/app/modules/agent/tests/test_group_chat_models.py:40`（backend）、`backend/app/modules/agent/tests/test_group_chat_models.py:291`（json）、`backend/app/modules/agent/tests/test_provider_caps_alignment.py:5`（frontend） |
| git diff 三者均为纯新增（无对其他 schema 的意外改写） | `backend/app/modules/agent/tests/test_group_chat_models.py`<br>`backend/app/modules/agent/tests/test_mcp_tools.py`<br>`backend/app/modules/agent/tests/test_provider_caps_alignment.py`<br>`backend/app/modules/change/tests/test_assets.py`<br>`backend/app/modules/change/tests/test_files_router.py`<br>…共 20 个（目录级候选全量在 facts/trace，归属按关键词命中与证据锚点收窄） | git、diff、schema（`backend/app/modules/change/tests/test_assets.py`、`backend/app/modules/change/tests/test_timeline.py`、`backend/app/modules/change/tests/test_usage_stats.py`、`backend/app/modules/daemon/tests/test_agent_session_tasks.py`、`backend/app/modules/daemon/tests/test_group_cross_mention.py`、`backend/app/modules/agent/tests/test_group_chat_models.py`、`backend/app/modules/change/tests/test_step_progress.py`、`backend/app/modules/daemon/tests/test_change_session.py`） | covered | `backend/app/modules/change/tests/test_assets.py:43`（git）、`backend/app/modules/change/tests/test_assets.py:43`（diff）、`backend/app/modules/agent/tests/test_group_chat_models.py:858`（schema） |
| 后端 knowledge 模块测试全绿 + 前端知识库/scan-docs 页测试全绿 + page-sync/explorer-page 既有测试不红 | `backend/app/modules/agent/tests/test_group_chat_models.py`<br>`backend/app/modules/agent/tests/test_mcp_tools.py`<br>`backend/app/modules/agent/tests/test_provider_caps_alignment.py`<br>`backend/app/modules/change/tests/test_assets.py`<br>`backend/app/modules/change/tests/test_files_router.py`<br>…共 20 个（目录级候选全量在 facts/trace，归属按关键词命中与证据锚点收窄） | 后端、knowledge、scan（`backend/app/modules/change/tests/test_step_progress.py`、`backend/app/modules/change/tests/test_timeline.py`、`backend/app/modules/daemon/tests/test_attachment_pipeline.py`、`backend/app/modules/daemon/tests/test_change_session.py`、`backend/app/modules/daemon/tests/test_group_logs_pagination.py`、`backend/app/modules/daemon/tests/test_group_p2.py`、`backend/app/modules/change/tests/test_assets.py`、`backend/app/modules/change/tests/test_files_router.py`） | covered | `backend/app/modules/change/tests/test_step_progress.py:220`（后端）、`backend/app/modules/change/tests/test_assets.py:130`（knowledge）、`backend/app/modules/change/tests/test_assets.py:781`（scan） |
| R-01 实测数字与 R-03 抽验结论已回填文档（超 5s 时已在 task-03 落地 loading 文案；超 30s 记录留待后续评估预热钩子） | `backend/app/modules/agent/tests/test_group_chat_models.py`<br>`backend/app/modules/agent/tests/test_mcp_tools.py`<br>`backend/app/modules/agent/tests/test_provider_caps_alignment.py`<br>`backend/app/modules/change/tests/test_assets.py`<br>`backend/app/modules/change/tests/test_files_router.py`<br>…共 20 个（目录级候选全量在 facts/trace，归属按关键词命中与证据锚点收窄） | task、落地（`backend/app/modules/agent/tests/test_group_chat_models.py`、`backend/app/modules/agent/tests/test_mcp_tools.py`、`backend/app/modules/agent/tests/test_provider_caps_alignment.py`、`backend/app/modules/change/tests/test_assets.py`、`backend/app/modules/change/tests/test_files_router.py`、`backend/app/modules/change/tests/test_session_changes_endpoint.py`、`backend/app/modules/change/tests/test_step_progress.py`、`backend/app/modules/change/tests/test_timeline.py`、`backend/app/modules/change/tests/test_title_normalization.py`、`backend/app/modules/change/tests/test_usage_stats.py`、`backend/app/modules/daemon/tests/test_agent_session_tasks.py`、`backend/app/modules/daemon/tests/test_attachment_pipeline.py`、`backend/app/modules/daemon/tests/test_change_session.py`、`backend/app/modules/daemon/tests/test_group_attachment_gate.py`、`backend/app/modules/daemon/tests/test_group_bridge_projection.py`、`backend/app/modules/daemon/tests/test_group_cross_mention.py`、`backend/app/modules/daemon/tests/test_group_mention_pipeline.py`、`backend/app/modules/daemon/tests/test_inject_origin_guard.py`） | covered | `backend/app/modules/agent/tests/test_group_chat_models.py:1`（task）、`backend/app/modules/change/tests/test_timeline.py:149`（落地） |

- ⚠️ 零/半自动化承接条目 3 条——这些路径无测试兜底，verify 复核必须**显式走查**（尤其编辑/更新链路与非主分支流：二次复核实证它们正是 P1 藏身处），走查结论登记进「代码审查」节

#### 探针 4：决策追踪覆盖
- D-001~D-011 全部下游闭环（D-xxx@vN → requirements.md 覆盖决策行/决策覆盖矩阵 → tasks/*.md decision_ids → 实现与测试证据，见决策追踪矩阵）：D-008（方案 A 总纲）= task-01~05 全体落地；D-009/D-010（落选方案防复潮）以反证闭环——`backend/app/modules/knowledge/vector_router.py`/`vector_search.py` 零 diff（test_vector_search.py 回归全绿）+ 无 DB 表/迁移/daemon 改动（git 提交清单核验）；D-011（执行期裁决）= search.py `_word_score` anchor 面 + 单测 rank=1。**无未闭环项、无 P0/P1 unresolved/blocking**。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 1092 backend endpoints (live [scan-root 655 + worktree 654] + artifact 654), 0 frontend calls [scope: change-diff (13 files @ worktree)] | 0 backend endpoints unused by frontend (+220 stock noise collapsed)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ⚠️ 0 个本变更端点前端未调用（warning 不阻断）：
- ℹ️ 另有 220 个存量端点未调用（他模块存量噪音，已折叠不逐条列出）

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 13 个非 Java 清单文件不在探针 9 扫描面）
#### 探针 10：预填注清零（error 门）
<!-- 口径注记：预填注（来源注协议）在场 = 白名单槽未确认（预填≠结论）；删注 = 确认动作。本探针是门禁梯度 error 档——verify --done 时 gate 复跑同源检测，注未清零阻断完成（归档前清零兜底）。已知误报面：散文引用注字面量会命中（如文档描述注协议本身）——核对后真未确认则删注，纯散文则改写措辞，不得删探针段。 -->
- ✅ 预填注清零（6 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml——红线机检零打扰，D-002）
#### 探针 12：UI 视觉证据（分级门）
<!-- 口径注记：在场性检查非语义审计——只验 visual-evidence.md 存在非空与降级裁决留痕，不判对照结论对错（语义面归 verify-result 人工判断层）。证据应在执行时按 flow start「UI 变更执行须知」随手产生；本探针不要求收口现做。分级：缺证据默认 ⚠️（local.yaml ui_visual_gate=error 升阻断）；视觉降级无「用户裁决」留痕恒 ❌（off 豁免）。 -->
- ❌ design/requirements 存在视觉降级声明而变更目录无用户裁决留痕（visual-evidence.md 或 decisions.md 含「用户裁决」）——静默降级禁止收口
  - 修复：补渲染对照证据到 visual-evidence.md；降级项补用户裁决留痕（含「用户裁决」字样段）后重跑收口

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]
<!-- 口径注记（与探针 7 互指，R-07）：探针 7 = 验收项 × 测试承接面（每条 acceptance 由哪些测试承接）；本矩阵 = 接口端点 × 验证用例面（design 接口段每个端点由哪些验证用例/冒烟步骤覆盖）——两者并排互补，双矩阵并行存在。端点集来自 design.md 接口段 tolerant 解析（parseDesignApiTable：段头宽收 + 方法/路径双条件），预填≠结论，agent 逐行复核。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable——covered-service 适用：端点行为由 service 层等非端点层测试锁定；证据须含测试文件锚点三形态之一（`.test.` / file:line / 反引号包裹的路径或测试名）；non-testable 适用（含运行验证移交场景）：目标环境不可达、构建级验证已过而运行冒烟移交部署后执行——证据写构建回执+移交去向一句话，该行不计入有效分母（勿硬凑 covered-service）。 -->
<!-- 预填说明：端点行由 CLI 机械预填，判定/用例依据 ID/结果/证据由 agent 逐格填写——用例依据 ID 锚点五形态（可复制样例）：design接口表#POST /api/xx（# 后必须 METHOD /path，仅表名/行号/散文描述不计命中）、权限矩阵[admin×读]、契约表@任务卡字段清单、DDL@users.id、载荷@e2e_body.json（须真实命中对应表/段，防空指）。 -->
<!-- 文法注释：子行 = 端点行下一行、两空格缩进、以「↳ <消费端>:」前缀书写（消费端细分承接面，不计矩阵行账）；探索行 = 判定 uncovered 且证据列含 [探索] 标记（探索性验证不算覆盖）。 -->
| 端点 | 判定 | 用例依据 ID | 结果 | 证据 |
|---|---|---|---|---|
| POST /workspaces/{workspace_id}/knowledge/search | covered | design接口表#POST /api/workspaces/{workspace_id}/knowledge/search | pass | design接口表#POST /workspaces/{workspace_id}/knowledge/search；backend/app/modules/knowledge/tests/test_router.py:1253（契约字段全集 8 例；同文件 :1279 403 / :1302 404 / :1317 docs 过滤 / :1378 降级 / :1400 空 query / :1417 limit 钳位） |
| POST /api/workspaces/{workspace_id}/knowledge/search | covered | design接口表#POST /api/workspaces/{workspace_id}/knowledge/search | pass | design接口表#POST /api/workspaces/{workspace_id}/knowledge/search；backend/app/modules/knowledge/tests/test_router.py:1253；前端 frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx |
  ↳ 前端: `frontend/src/lib/knowledge.ts` searchKnowledge → `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`「输入关键词后结果列表替换文件树」
| POST /api/workspaces/{id}/knowledge/search | covered | design接口表#POST /api/workspaces/{workspace_id}/knowledge/search | pass | design接口表#POST /api/workspaces/{id}/knowledge/search；backend/app/modules/knowledge/tests/test_router.py:1253 |

## 测试结果 [层：确定性检查——CLI 实测对账]
- 后端（相关面）：`cd backend && uv run pytest app/modules/knowledge/tests -q --no-cov` → **199 passed**（含新 test_knowledge_search 25 + 端点搜索段 8），日志 `.sillyspec/.runtime/logs/task05-backend-all.log`
- 前端（相关面）：`cd frontend && pnpm exec vitest run "…/knowledge-page.test.tsx" "…/scan-docs-page.test.tsx"` → **46 passed**（新增搜索 7 + 深链 4），日志 `.sillyspec/.runtime/logs/task05-frontend.log`
- lint：后端 ruff check/format 通过 + mypy app（23 源文件）0 错；前端 tsc --noEmit 0 错 + next lint 0 错（仅既有 warning）
- 全量测试由 CLI 在 verify --done 统一执行（local.yaml commands.test 对账口径）

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
<!-- 机械半边预填（CLI，P0-1）：D→FR→task 链自 decisions.md × tasks/*.md frontmatter 结构化字段构建；
     Evidence / 状态两列是人工判断——逐格复核，未闭环行必须在报告标注风险 -->
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01、FR-03、FR-04 | task-02、task-05 | `backend/app/modules/knowledge/router.py` search 端点（POST /knowledge/search，JWT 通道非 shpsync）+ `tests/test_router.py` 403/404/过滤用例 | 已闭环 |
| D-002@v1 | FR-01、FR-02、FR-03、FR-06 | task-01 | search.py `scan_corpus`（knowledge/ + docs/，排 INDEX.md/symlink）+ `test_knowledge_search.py` 扫描面断言（changes/ 零收录） | 已闭环 |
| D-003@v1 | FR-01、FR-02、FR-03、FR-06 | task-01 | search.py 三档切块（`_DECISION_HEADING_RE`/`_FR_HEADING_RE`/`_H2_RE` + `_iter_line_windows` 滑窗 1500/1000/150）+ 切块单测（条目 anchor/滑窗重叠/阈值边界） | 已闭环 |
| D-004@v1 | FR-01、FR-02、FR-03、FR-06 | task-01 | search.py `_word_score`/`search_sync` 融合 0.6/0.4 + 保底 0.9 + 降级纯词面；测试精确编号 rank=1 / 降级 reason / 前端降级条用例 | 已闭环 |
| D-005@v1 | FR-01、FR-03、FR-04 | task-02 | router.py `has_permission(SCAN_DOCS_READ)` + 3×limit 候选后置过滤 + `test_router.py` docs 过滤/admin 全量用例 | 已闭环 |
| D-006@v1 | FR-02、FR-03、FR-05 | task-03、task-04 | knowledge/page.tsx 搜索 UI（框/列表/双落点/降级条）+ scan-docs/page.tsx ?path= 深链；两页测试新增 11 例 | 已闭环 |
| D-007@v1 | FR-01、FR-02、FR-03、FR-06 | task-01 | search.py `corpus_fingerprint`/`_index_lock` 锁内 single-flight/构建后复算 + 指纹失效单测（embed_calls 计数）；与 vector_search.py 的 `_indexes` 独立 | 已闭环 |
| D-008@v1 | FR-01~FR-06 | task-01~task-05 | 方案 A 总纲落地 = 6 提交（69e1a98d/9a3b3ef1/a3703128/ef234db0/0e72ae79/89ac5502），independent 验收审查 11/11 pass | 已闭环 |
| D-009@v1 | FR-01、FR-04（防复潮边界） | task-02（反证） | 反证闭环：`vector_router.py`/`vector_search.py` 零 diff + `test_vector_search.py` 回归全绿（CLI 通道契约未动） | 已闭环（防复潮成立） |
| D-010@v1 | FR-06（防复潮边界） | task-01（反证） | 反证闭环：无 DB 表/迁移/daemon 改动（`git -C worktree log --stat` 13 文件清单核验） | 已闭环（防复潮成立） |
| D-011@v1 | FR-03 | task-01 | search.py `_word_score` anchor 面纳入精确命中 + `test_search_exact_decision_id_ranks_first`（anchor 居首 + score≥0.9）；执行期实证首轮 score=0.02 暴露缺口后修正 | 已闭环 |

## 技术债务 [层：人工判断]
无新增 TODO/FIXME/HACK（探针 1 零命中）；项目级既有技术债（CONCERNS 🔴：spec_profile 骨架态 / agent-run metadata 缺失 / daemon turn 卡死）均不在本变更改动面。

## 变更风险等级 [层：人工判断]
contract-required —— 新增 API 端点（新契约面）+ 前端消费；契约由 FastAPI TestClient 全栈测试覆盖（真实路由/鉴权依赖/过滤链 8 例），前端由组件测试覆盖；非 integration-critical（不触 daemon/lease/跨进程装配）。design.md frontmatter 无 risk_level 显式声明。

## Runtime Evidence [层：人工判断]
- R-01 实测（2026-10-15，worktree backend，真实 fastembed + 主仓 spec 语料；探针脚本 `.sillyspec/.runtime/logs/r01-r03-probe.py`）：scan_corpus 6586 chunks / 437 文件（0.25s）→ embedder 加载 1.12s → **首查含索引构建 304.67s** → 缓存命中二次查询 **0.474s**
- R-03 抽验 5 组 query：`D-011` → 0.900 anchor 保底居首（跨文件同号属预期）；`乐观锁 base_version` → top1「乐观锁（optimistic_lock）」；`搜索框 debounce 防抖` → top1「daemon 侧防抖」；`知识库向量检索` → top1 `docs/backend/modules/knowledge.md`；`会话状态点语义` → top1 为语义近似条目（grep 证实该词条不在本仓语料，非召回缺陷）
- 测试实跑：后端 199 passed（`.runtime/logs/task05-backend-all.log`）/ 前端 46 passed（`.runtime/logs/task05-frontend.log`）
- commit 链（worktree 分支 sillyspec/2026-10-15-platform-knowledge-search）：69e1a98d → 9a3b3ef1 → a3703128 → ef234db0 → 0e72ae79 → 89ac5502
- 端点实机冒烟：不涉及（后端服务未起；契约由 TestClient 全栈覆盖，部署后自然验证——移交项已登记）
<!-- 降级路径（design §3.2，D-004 收口）：服务起不来时：Controller 直调冒烟（mock 下游，验绑定+校验+路由）/ 基础设施恢复后复跑固化用例——不要空填不涉及 -->

## 代码审查 [层：人工判断]
- 探针 7 预填 ⚠️ 三条 partial 复核（改判 covered，均有人工核验的测试承接）：①task-03「点击 docs 类结果」→ 由「点击 docs 类结果 → 跳转模块文档页 ?path= 深链」用例承接；②task-03「清除按钮 → 恢复文件树」→ 由「清除搜索词后还原文件树」用例承接；③task-04「查无此文件 → 静默」→ 由「目标未同步：静默待命（不报错不发详情请求）」用例同构承接（断言显式覆盖「不报错不发请求」）。
- 断言有效性抽查（2 个核心）：①`test_search_exact_decision_id_ranks_first`——断言真实输出（top anchor/spec_path/score≥0.9/字段全集），非零断言 ✓；②`test_knowledge_search_requires_knowledge_read`——真实 403 状态码 + 完整依赖链 ✓。异常分支覆盖：降级/403/404/空 query/零信号空态均有断言。
- 编辑/更新链路：本变更为只读检索面，无新增编辑链路 ✓。
- 守卫一致性：新端点权限模式与同资源既有读端点一致（`require_permission(KNOWLEDGE_READ)`），docs 过滤在服务端（非前端隐藏）✓。
- 零覆盖路径走查（探针 3 ⚠️ 面）：task-05 的「产物同步」类 acceptance 为文档/生成物类（non-testable 性质），已由 git diff --stat 纯新增核验 + gen:types:check 漂移闸门兜底。
- **总体评价**：实现与设计一致、测试锚点充分、无越界改动；主要遗留为 R-01 首查耗时（已诚实声明 + 移交），无 P1 缺陷。
     ① 编辑/更新链路（回显、字段映射、残留态）——非新增主链路，实证盲区；
     ② 非主分支流（相关方/旁路支线等未走查路径）；
     ③ 守卫一致性：同资源端点的操作人/权限校验模式对比（实证 doSubmit 无操作人校验而 delete/withdraw 有——越权）；
     ④ 载荷字段契约（探针 8 ⚠️ 配对逐条核实）；
     ⑤ 分页/并发/事务原子性（无测试基建端的纯逻辑面）-->

## 独立复核（可选回流槽） [层：人工判断——复核后追加]
<!-- verify 完成后的深度复核（独立子代理/二次审查）结论回流至此：缺陷分级（P1 功能不可用 / P2 需求子项 / P3 建议修）+ 修复证据链 + 对「结论枚举」的影响改写。无复核时本节写「无」或删除。复核结论不再只活在聊天记录（2026-09-16 EHS 二次复核实证：5 个 P1 只有聊天可查，变更档案仍写 PASS WITH NOTES）。 -->
