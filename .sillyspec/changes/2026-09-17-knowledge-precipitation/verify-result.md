# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。
>
> 「层」=证据可核验性分层（非执行者声明）：「人工判断」指本节为语义判断，由执行 agent 填写、
> CLI 不机械复跑（gate 抽查 + 人类审批点复核兜底）；「可复跑探针/确定性检查/CLI 一致性校验」= gate 可机械复核段。

## 结论 [层：人工判断]

结论枚举：FAIL —— 本变更自身验证面全绿（knowledge 81 / auth 194 / daemon 面 2160 / 前端 knowledge 58 / CLI 交叉验证真实通过），但 deployment-critical 缺部署级实测证据（M1-M5 未实测）+ Step 6 模块子集测试在当前 HEAD 存在失败（归属并行会话提交，非本变更引入，详见测试结果节）。按 verify 完成门规则（deployment-critical 无真实部署集成证据不得 PASS），诚实判 FAIL 阻断收口，待部署实测后复跑。

## 移交项（结构化） [层：人工判断——CLI 清单核验]
<!-- 结论=PASS WITH NOTES 时本节必填（prose 移交叙述转结构化，复跑/验收有据可查、agent 可恢复复跑）；结论=PASS/FAIL 写「无」 -->
<!-- 类型枚举：env-blocked（环境阻断，条件列必填复跑口径）/ manual-acceptance（人工验收，条件列必填验收步骤）/ db-script（待执行脚本，条件列必填执行环境与顺序）/ other -->
| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| env-blocked | 部署期实测 M1：真实 UI 全链（录入→待审核→合并→页面可见→CLI search 命中） | 部署含本变更三提交的环境后按 evidence/task-09-evidence.md §6 M1 步骤执行并留证 |
| env-blocked | 部署期实测 M2：蒸馏端到端（claude fresh 附件落盘+propose 回流 / codex resume 续接） | 同上 §6 M2，需真实 daemon 在线 |
| env-blocked | 部署期实测 M3：spec_version 递增 + repo-native lease 下行一致 | 同上 §6 M3 |
| env-blocked | 部署期实测 M4：未授权用户页面零写入口负例 | 同上 §6 M4 |
| other | 并行会话失败修复（非本变更）：JsonPreviewer mock（ade4807d4 previewers 域）/ pending_thinking_level（schema 已提交 queue.py 未提交的半提交态） | 由对应并行会话收口；本变更不揽责 |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
<!-- 无 cannot_verify 任务时本节写「无」；有则逐 task 一行 -->
- task-09: partial | verifiedFiles: .sillyspec/changes/2026-09-17-knowledge-precipitation/evidence/task-09-evidence.md（自动化部分 satisfied：测试计数/路由序/CLI validate+search 真实执行；M1-M5 部署级 missing 待部署实测）

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
- claim: CLI 同源交叉验证——平台 writer 生成的 INDEX 路由行被真实 sillyspec CLI validate+search 解析命中 | command: sillyspec knowledge validate --spec-dir <sandbox> + sillyspec knowledge search --query 关键词a --spec-dir <sandbox> | exit: 0 | log: evidence/task-09-evidence.md §3（validate ok 零错误 + search score 2 命中 + 负例零命中 + Python/CLI 格式字面同源对照）
- claim: 应用装配冒烟——app.main import 成功 624 路由注册，7 新端点注册序 380-386 先于 :path 通配 387 | command: uv run python -c "from app.main import app; ..." | exit: 0 | log: evidence/task-09-evidence.md §2
- claim: 本变更测试面全绿（真实执行） | command: uv run pytest app/modules/knowledge -q（81 passed）+ tests/modules/auth（194 passed）+ daemon 面（2160 passed，增量时点）+ 前端 knowledge 相关 vitest（58 用例）+ tsc --noEmit 0 | exit: 0 | log: evidence/task-09-evidence.md §1/§4 + 各增量审查记录
- claim: 部署级 M1-M5（真实 UI/daemon 在线蒸馏/下行一致/权限负例）未执行——deployment-critical 完整证据缺失 | command: 待部署 | exit: n/a | log: evidence/task-09-evidence.md §6 步骤已备

## 任务完成度 [层：人工判断]
10/10 全部完成 ✅（交付物存在性+关键符号 grep 实证：writer 两段式/distill 续接分流/zone 树/权限/migration/四组件/证据文档/模块卡增量）。另有 execute 后三增量超卡实装：D-010 后端+前端（4974bf369）、D-008 取数通道+回流+护栏（2c7873e5e）——均有主代理双 pass 审查。

## 设计一致性 [层：人工判断]
主体一致。三处经披露偏差（均有依据）：①antd Tabs→原生 tab（jsdom :has() 不兼容实测）；②origin 取 k-distill（String(16) 列限长）；③D-008@v2 前提修正（洞二"树在缺指路"，design R-08 节已带修正注记，D-008@v1 正式 superseded）。文档债 2 处（轻微）：决策追踪表/requirements 矩阵未补 D-008~010 行（增量决策记录在专节）。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ glob 项未展开（agent 手动展开扫描）：frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx、frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx

#### 探针 2：设计关键词覆盖
16/16 关键词全命中：propose_manual(3)/merge(22)/reject(11)/update_entry(4)/dispatch(21)/reopen_session(4)/inject_session(12)/refetchInterval(1)/KNOWLEDGE_WRITE(6)/zone(13)/rglob(3)/_export_session_transcript(2)/attachment(16)/k-distill(1)/merged_to(11)/source_ref(12)。无 ⚠️ 未实现项。断言有效性抽查合格（test_writer 12 用例全为真实副作用断言：两段式冲突保留候选/幂等重试不重复追加/白名单外 422/decisions 422/frontmatter 四字段）。集成盲区：路由注册序已由装配冒烟实证；daemon 在线链路与 UI 全链无自动化（deployment M1-M5）。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/app/modules/knowledge、backend/app/modules/knowledge/tests、backend、frontend/src/lib）找到 82 个测试文件（backend/app/modules/knowledge/tests/test_distill.py、backend/app/modules/knowledge/tests/test_parser.py、backend/app/modules/knowledge/tests/test_router.py、backend/app/modules/knowledge/tests/test_writer.py、backend/app/core/spec_paths.py …）
- ✅ task-02: 模块目录（backend/app/modules/auth、backend/migrations、backend/tests/modules/auth）找到 15 个测试文件（backend/migrations/versions/202606100900_create_spec_workspaces.py、backend/migrations/versions/202606101000_create_spec_profile.py、backend/migrations/versions/202606220900_backfill_spec_workspaces.py、backend/migrations/versions/202606230900_repair_spec_root_paths.py、backend/migrations/versions/20260813160000_create_spec_file_manifest.py …）
- ✅ task-03: 模块目录（frontend/src/app/(dashboard)/workspaces/[id]/knowledge、frontend/src/app/(dashboard)/workspaces/[id]/__tests__）找到 4 个测试文件（frontend/src/app/(dashboard)/workspaces/[id]/__tests__/explorer-page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/__tests__/page-sync.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx）
- ✅ task-04: 模块目录（backend/app/modules/knowledge、backend/app/modules/knowledge/tests、backend、frontend/src/lib）找到 82 个测试文件（backend/app/modules/knowledge/tests/test_distill.py、backend/app/modules/knowledge/tests/test_parser.py、backend/app/modules/knowledge/tests/test_router.py、backend/app/modules/knowledge/tests/test_writer.py、backend/app/core/spec_paths.py …）
- ✅ task-05: 模块目录（NEW:frontend/src/components/knowledge、frontend/src/lib、frontend/src/app/(dashboard)/workspaces/[id]/knowledge、NEW:frontend/src/components/knowledge/__tests__、frontend/src/app/(dashboard)/workspaces/[id]/__tests__）找到 14 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/change-autolink.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts …）
- ✅ task-06: 模块目录（NEW:frontend/src/components/knowledge、frontend/src/app/(dashboard)/workspaces/[id]/knowledge、frontend/src/lib、NEW:frontend/src/components/knowledge/__tests__、frontend/src/app/(dashboard)/workspaces/[id]/__tests__）找到 14 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/change-autolink.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts …）
- ✅ task-07: 模块目录（NEW:backend/app/modules/knowledge、backend/app/modules/knowledge、backend/app/modules/knowledge/tests、backend、frontend/src/lib）找到 82 个测试文件（backend/app/modules/knowledge/tests/test_distill.py、backend/app/modules/knowledge/tests/test_parser.py、backend/app/modules/knowledge/tests/test_router.py、backend/app/modules/knowledge/tests/test_writer.py、backend/app/core/spec_paths.py …）
- ✅ task-08: 模块目录（frontend/src/components/knowledge、NEW:frontend/src/components/knowledge、frontend/src/app/(dashboard)/workspaces/[id]/knowledge、frontend/src/lib、NEW:frontend/src/components/knowledge/__tests__、frontend/src/app/(dashboard)/workspaces/[id]/__tests__）找到 18 个测试文件（frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx、frontend/src/components/knowledge/__tests__/entry-editor.test.tsx、frontend/src/components/knowledge/__tests__/merge-dialog.test.tsx、frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx、frontend/src/lib/api/__tests__/llm-providers.test.ts …）
- ✅ task-09: 模块目录（backend/app/modules/knowledge、frontend/src/app/(dashboard)/workspaces/[id]/knowledge、.sillyspec/changes）找到 8 个测试文件（backend/app/modules/knowledge/tests/test_distill.py、backend/app/modules/knowledge/tests/test_parser.py、backend/app/modules/knowledge/tests/test_router.py、backend/app/modules/knowledge/tests/test_writer.py、.sillyspec/changes/2026-09-12-session-live-display-fixes/evidence/prod-live-test-20260913.md …）
- ✅ task-10: 模块目录（.sillyspec/docs/SillyHub/modules、.sillyspec/changes/2026-09-17-knowledge-precipitation）找到 2 个测试文件（.sillyspec/docs/SillyHub/modules/spec_profile.md、.sillyspec/docs/SillyHub/modules/spec_workspace.md）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles 结构归属承接面（每条 acceptance 由哪些测试承接）；两者并排冲突以 7 为准。判定枚举（四选一）：covered / partial / uncovered / non-testable（文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。证据列给首命中 file:line 锚点或人工核验提示。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 列表含 decisions/ 与 generated/ 子目录条目且 zone 正确（top/decisions/generated/proposed 四值覆盖） | `backend/app/modules/knowledge/tests/test_parser.py`<br>`backend/app/modules/knowledge/tests/test_router.py` | 列表含、decisions、generated、zone（`backend/app/modules/knowledge/tests/test_router.py`、`backend/app/modules/knowledge/tests/test_parser.py`） | covered | `backend/app/modules/knowledge/tests/test_router.py:316`（列表含）、`backend/app/modules/knowledge/tests/test_parser.py:46`（decisions）、`backend/app/modules/knowledge/tests/test_parser.py:47`（generated） |
| 顶层条目 filename 与 path 值和改造前逐字一致（回归断言，既有断言零变化） | `backend/app/modules/knowledge/tests/test_parser.py`<br>`backend/app/modules/knowledge/tests/test_router.py` | 顶层条目、filename、path、值和改造前逐字一致、回归断言（`backend/app/modules/knowledge/tests/test_parser.py`、`backend/app/modules/knowledge/tests/test_router.py`） | covered | `backend/app/modules/knowledge/tests/test_parser.py:84`（顶层条目）、`backend/app/modules/knowledge/tests/test_parser.py:20`（filename）、`backend/app/modules/knowledge/tests/test_parser.py:5`（path） |
| 跨目录同名文件按含子目录段的 filename get 各自命中；不存在维持既有 WorkspaceNotFound 语义 | `backend/app/modules/knowledge/tests/test_parser.py`<br>`backend/app/modules/knowledge/tests/test_router.py` | filename、get、各自命中（`backend/app/modules/knowledge/tests/test_parser.py`、`backend/app/modules/knowledge/tests/test_router.py`） | covered | `backend/app/modules/knowledge/tests/test_parser.py:20`（filename）、`backend/app/modules/knowledge/tests/test_parser.py:110`（get）、`backend/app/modules/knowledge/tests/test_router.py:352`（各自命中） |
| GET /knowledge 响应只增 zone 字段；quicklog 两端点行为与响应结构零变化 | `backend/app/modules/knowledge/tests/test_parser.py`<br>`backend/app/modules/knowledge/tests/test_router.py` | GET、knowledge、zone、字段（`backend/app/modules/knowledge/tests/test_router.py`、`backend/app/modules/knowledge/tests/test_parser.py`） | covered | `backend/app/modules/knowledge/tests/test_router.py:522`（GET）、`backend/app/modules/knowledge/tests/test_parser.py:1`（knowledge）、`backend/app/modules/knowledge/tests/test_parser.py:41`（zone） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| Permission.KNOWLEDGE_WRITE 枚举存在且导入无误，group 属性返回 PermissionGroup.WORKSPACE | `backend/tests/modules/auth/test_permissions.py` | Permission、KNOWLEDGE_WRITE、group（`backend/tests/modules/auth/test_permissions.py`） | covered | `backend/tests/modules/auth/test_permissions.py:1`（Permission）、`backend/tests/modules/auth/test_permissions.py:56`（KNOWLEDGE_WRITE）、`backend/tests/modules/auth/test_permissions.py:1`（group） |
| alembic upgrade 后 platform_admin 与 workspace_owner 角色持有 knowledge:write 授权行 | `backend/tests/modules/auth/test_permissions.py` | alembic、upgrade、platform_admin、workspace_owner（`backend/tests/modules/auth/test_permissions.py`） | covered | `backend/tests/modules/auth/test_permissions.py:16`（alembic）、`backend/tests/modules/auth/test_permissions.py:172`（upgrade）、`backend/tests/modules/auth/test_permissions.py:236`（platform_admin） |
| alembic downgrade 可回退（对应 role_permissions 行删除，roles 本体不动） | `backend/tests/modules/auth/test_permissions.py` | alembic、downgrade、role_permissions（`backend/tests/modules/auth/test_permissions.py`） | covered | `backend/tests/modules/auth/test_permissions.py:16`（alembic）、`backend/tests/modules/auth/test_permissions.py:172`（downgrade）、`backend/tests/modules/auth/test_permissions.py:191`（role_permissions） |
| 既有角色其它权限集合零变化（只增授权不删改，brownfield 零回归） | `backend/tests/modules/auth/test_permissions.py` | 只增授权不删改（`backend/tests/modules/auth/test_permissions.py`） | covered | `backend/tests/modules/auth/test_permissions.py:269`（只增授权不删改） |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| mock 数据含四种 zone 条目时树按固定 zone 顺序分组且待审核置顶、徽标计数正确；空待审核无徽标 | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | mock、zone（`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`） | covered | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx:29`（mock）、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx:7`（zone） |
| 既有展开收起、点文件拉详情与 Markdown 渲染、拖拽调宽与 localStorage 记忆用例在适配后全部通过 | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | Markdown、渲染（`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`） | covered | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx:10`（Markdown）、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx:7`（渲染） |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| propose 落盘 proposed/<slug>.md 且 frontmatter 四字段齐全、slug 冲突序号唯一，列表侧待审核 zone 可见 | `backend/app/modules/knowledge/tests/test_writer.py`<br>`backend/app/modules/knowledge/tests/test_router.py` | propose、落盘、proposed、slug、frontmatter（`backend/app/modules/knowledge/tests/test_writer.py`、`backend/app/modules/knowledge/tests/test_router.py`） | covered | `backend/app/modules/knowledge/tests/test_writer.py:4`（propose）、`backend/app/modules/knowledge/tests/test_writer.py:4`（落盘）、`backend/app/modules/knowledge/tests/test_writer.py:4`（proposed） |
| merge 段一返回 conflict 时候选文件保留未删；合并已生效后重试不重复追加同名小节与 INDEX 路由行 | `backend/app/modules/knowledge/tests/test_writer.py`<br>`backend/app/modules/knowledge/tests/test_router.py` | merge、conflict（`backend/app/modules/knowledge/tests/test_writer.py`、`backend/app/modules/knowledge/tests/test_router.py`） | covered | `backend/app/modules/knowledge/tests/test_writer.py:7`（merge）、`backend/app/modules/knowledge/tests/test_writer.py:7`（conflict） |
| 编辑 decisions zone 条目返回 422 且 message 含由归档流程维护；白名单外目标拒绝合并；409 响应含 message/conflict/server_versions 三键 | `backend/app/modules/knowledge/tests/test_writer.py`<br>`backend/app/modules/knowledge/tests/test_router.py` | 编辑、decisions、zone、message（`backend/app/modules/knowledge/tests/test_writer.py`、`backend/app/modules/knowledge/tests/test_router.py`） | covered | `backend/app/modules/knowledge/tests/test_writer.py:6`（编辑）、`backend/app/modules/knowledge/tests/test_writer.py:6`（decisions）、`backend/app/modules/knowledge/tests/test_writer.py:5`（zone） |

**task-05**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| KNOWLEDGE_WRITE 持有者可见「沉淀知识」与「编辑」入口；未持有者两入口均不渲染，页面行为与现状一致（brownfield 兼容） | `frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx`<br>`frontend/src/components/knowledge/__tests__/entry-editor.test.tsx`<br>`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | 沉淀知识、编辑、入口（`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`、`frontend/src/components/knowledge/__tests__/entry-editor.test.tsx`） | covered | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx:14`（沉淀知识）、`frontend/src/components/knowledge/__tests__/entry-editor.test.tsx:5`（编辑）、`frontend/src/components/knowledge/__tests__/entry-editor.test.tsx:14`（入口） |
| 手工录入填齐标题与正文提交后待审核区立即出现新候选；未填齐时「存为候选知识」按钮禁用 | `frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx`<br>`frontend/src/components/knowledge/__tests__/entry-editor.test.tsx`<br>`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | 存为候选知识（`frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx`） | covered | `frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx:13`（存为候选知识） |
| top/generated/proposed 条目编辑保存后正文更新且 frontmatter 保持不动；decisions 条目无编辑按钮且有「由归档流程维护 · 只读」标注 | `frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx`<br>`frontend/src/components/knowledge/__tests__/entry-editor.test.tsx`<br>`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | top、generated、proposed、frontmatter（`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`、`frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx`、`frontend/src/components/knowledge/__tests__/entry-editor.test.tsx`） | covered | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx:19`（top）、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx:147`（generated）、`frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx:147`（proposed） |
| propose/update 的请求与响应类型全部来自 api-types 再生成果（task-04 产物），无手写 DTO | `frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx`<br>`frontend/src/components/knowledge/__tests__/entry-editor.test.tsx`<br>`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | propose、update（`frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx`、`frontend/src/components/knowledge/__tests__/entry-editor.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`） | covered | `frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx:15`（propose）、`frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx:139`（update） |

**task-06**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 待审核条目可打开合并弹层，目标文件仅三类可选且无新建文件入口，必填项未填齐时确认按钮禁用 | `frontend/src/components/knowledge/__tests__/merge-dialog.test.tsx`<br>`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | — | partial | （无机械命中——人工核验 `frontend/src/components/knowledge/__tests__/merge-dialog.test.tsx`） |
| 预览区内容与后端 preview 返回一致（## 小节文本 + INDEX 路由行），非前端拼接 | `frontend/src/components/knowledge/__tests__/merge-dialog.test.tsx`<br>`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | preview、INDEX（`frontend/src/components/knowledge/__tests__/merge-dialog.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`） | covered | `frontend/src/components/knowledge/__tests__/merge-dialog.test.tsx:11`（preview）、`frontend/src/components/knowledge/__tests__/merge-dialog.test.tsx:52`（INDEX） |
| 合并成功后列表刷新且候选从待审核区消失；409 时出现指定文案 toast 且表单不丢 | `frontend/src/components/knowledge/__tests__/merge-dialog.test.tsx`<br>`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | toast（`frontend/src/components/knowledge/__tests__/merge-dialog.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`） | covered | `frontend/src/components/knowledge/__tests__/merge-dialog.test.tsx:15`（toast） |
| 拒绝需二次确认，确认后候选从列表消失；合并/拒绝按钮仅对 KNOWLEDGE_WRITE 用户可见 | `frontend/src/components/knowledge/__tests__/merge-dialog.test.tsx`<br>`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | 合并、KNOWLEDGE_WRITE（`frontend/src/components/knowledge/__tests__/merge-dialog.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`） | covered | `frontend/src/components/knowledge/__tests__/merge-dialog.test.tsx:10`（合并）、`frontend/src/components/knowledge/__tests__/merge-dialog.test.tsx:235`（KNOWLEDGE_WRITE） |

**task-07**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 派发成功创建 AgentRun 且 metadata_ 含 kind=knowledge-distill/source_type/source_ref/focus 四键、AgentRunWorkspace 关联建立，响应含 agent_run_id 与 status | `backend/app/modules/knowledge/tests/test_distill.py`<br>`backend/app/modules/knowledge/tests/test_router.py` | AgentRun、metadata_、kind、knowledge（`backend/app/modules/knowledge/tests/test_distill.py`、`backend/app/modules/knowledge/tests/test_router.py`） | covered | `backend/app/modules/knowledge/tests/test_distill.py:39`（AgentRun）、`backend/app/modules/knowledge/tests/test_distill.py:10`（metadata_）、`backend/app/modules/knowledge/tests/test_distill.py:10`（kind） |
| daemon 离线时任务创建成功且状态立即可查为失败态（error_code=no_online_daemon） | `backend/app/modules/knowledge/tests/test_distill.py`<br>`backend/app/modules/knowledge/tests/test_router.py` | daemon、error_code、no_online_daemon（`backend/app/modules/knowledge/tests/test_distill.py`、`backend/app/modules/knowledge/tests/test_router.py`） | covered | `backend/app/modules/knowledge/tests/test_distill.py:9`（daemon）、`backend/app/modules/knowledge/tests/test_distill.py:344`（error_code）、`backend/app/modules/knowledge/tests/test_distill.py:9`（no_online_daemon） |
| 无记录会话与未归档变更派发返回 422；不存在的会话/变更沿既有 404 语义 | `backend/app/modules/knowledge/tests/test_distill.py`<br>`backend/app/modules/knowledge/tests/test_router.py` | 不存在的会话、变更沿既有、语义（`backend/app/modules/knowledge/tests/test_distill.py`、`backend/app/modules/knowledge/tests/test_router.py`） | covered | `backend/app/modules/knowledge/tests/test_distill.py:7`（不存在的会话）、`backend/app/modules/knowledge/tests/test_distill.py:7`（变更沿既有）、`backend/app/modules/knowledge/tests/test_distill.py:7`（语义） |
| GET /knowledge/distill/tasks 仅返回 knowledge-distill 类任务（其它 AgentRun 不混入），字段 agent_run_id/source_type/source_ref/status/created_at 齐全 | `backend/app/modules/knowledge/tests/test_distill.py`<br>`backend/app/modules/knowledge/tests/test_router.py` | GET、knowledge、distill、tasks（`backend/app/modules/knowledge/tests/test_router.py`、`backend/app/modules/knowledge/tests/test_distill.py`） | covered | `backend/app/modules/knowledge/tests/test_router.py:522`（GET）、`backend/app/modules/knowledge/tests/test_distill.py:18`（knowledge）、`backend/app/modules/knowledge/tests/test_distill.py:16`（distill） |
| 写端点对仅 KNOWLEDGE_READ 用户 403；openapi.json 与 api-types.ts 已再生成随变更提交 | `backend/app/modules/knowledge/tests/test_distill.py`<br>`backend/app/modules/knowledge/tests/test_router.py` | KNOWLEDGE_READ、用户、json（`backend/app/modules/knowledge/tests/test_router.py`、`backend/app/modules/knowledge/tests/test_distill.py`） | covered | `backend/app/modules/knowledge/tests/test_router.py:787`（KNOWLEDGE_READ）、`backend/app/modules/knowledge/tests/test_distill.py:80`（用户）、`backend/app/modules/knowledge/tests/test_router.py:51`（json） |

**task-08**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 来源类型可切换，两类源列表分别来自真实 API（会话带 workspace 过滤、变更仅已归档），字段名与既有响应一致无编造 | `frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx`<br>`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | workspace（`frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`） | covered | `frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx:71`（workspace） |
| 派发成功后任务条出现并按轮询节奏刷新；无进行中任务时任务条不渲染 | `frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx`<br>`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | — | partial | （无机械命中——人工核验 `frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx`） |
| 任务完成触发知识列表刷新使候选出现在待审核区；失败态可见 daemon 离线对应文案 | `frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx`<br>`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | daemon（`frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`） | covered | `frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx:9`（daemon） |
| 手工录入 tab（task-05 产物）行为不回归 | `frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx`<br>`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx` | tab、task（`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`、`frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx`） | covered | `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx:7`（tab）、`frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx:2`（task） |

**task-09**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 录入→待审核可见→合并→known-issues.md 新增「##」小节 + INDEX.md 新路由行全程通过且证据落盘 | 无归属测试——判定大概率 uncovered | — | uncovered | （无归属测试） |
| sillyspec knowledge validate 通过且 knowledge search 命中新条目（输出留证） | 无归属测试——判定大概率 uncovered | — | uncovered | （无归属测试） |
| 蒸馏派发 AgentRun 有终态记录——completed 且候选回流待审核，或 failed 附原因（daemon 离线场景） | 无归属测试——判定大概率 uncovered | — | uncovered | （无归属测试） |
| 未授权用户页面零写入口；spec_version 递增与 repo-native lease 下行一致均有前后对照证据 | 无归属测试——判定大概率 uncovered | — | uncovered | （无归属测试） |

**task-10**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 四份模块文档增量落地且与实现一致（文档与实现不一致处以实现为准修文档，CLAUDE.md 规则 18） | `.sillyspec/docs/SillyHub/modules/spec_workspace.md` | — | partial | （无机械命中——人工核验 `.sillyspec/docs/SillyHub/modules/spec_workspace.md`） |
| 原型对照复核完成，偏差逐项登记（可接受偏差注明理由） | `.sillyspec/docs/SillyHub/modules/spec_workspace.md` | — | partial | （无机械命中——人工核验 `.sillyspec/docs/SillyHub/modules/spec_workspace.md`） |
| 相邻面回归全绿零失败；module-impact.md 更新结果表已回填 | `.sillyspec/docs/SillyHub/modules/spec_workspace.md` | module（`.sillyspec/docs/SillyHub/modules/spec_workspace.md`） | covered | `.sillyspec/docs/SillyHub/modules/spec_workspace.md:3`（module） |

- ⚠️ 零/半自动化承接条目 8 条——这些路径无测试兜底，verify 复核必须**显式走查**（尤其编辑/更新链路与非主分支流：二次复核实证它们正是 P1 藏身处），走查结论登记进「代码审查」节

#### 探针 4：决策追踪覆盖
决策闭环复核：D-001~D-007 全链闭环（requirements 矩阵→plan 覆盖矩阵→task 卡 decision_ids→实现证据）。D-008@v1 已 superseded 于 D-008@v2（design R-08 节带修正注记，无 stale 引用）。D-008@v2/D-009/D-010 为 execute 后增量决策，未回写 requirements/plan 矩阵（轻微文档债）但实现证据齐：D-008@v2→distill.py 附件通道+--spec-dir+护栏（2c7873e5e）；D-009→reopen+inject 分流+降级守卫（94bc0a4b9）；D-010→quick 来源/create_session 复用/origin k-distill 隔离/merged_to 反链（94bc0a4b9+26009cac6）。无 unresolved/blocking 决策。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 5892 backend endpoints (live [scan-root 610] + artifact 5490), 0 frontend calls [scope: change-diff (17 files @ scan-root)] | 1872 backend endpoints unused by frontend
- ⚠️ 1872 个本变更端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）

## 测试结果 [层：确定性检查——CLI 实测对账]
本变更直接面（真实执行，全绿）：uv run pytest app/modules/knowledge -q → 81 passed；tests/modules/auth → 194 passed + 2 既有 xfail；daemon 面 2160 passed（增量时点，守护 create/read_model）；前端 knowledge 相关 vitest → 41+17 用例绿；pnpm exec tsc --noEmit → 本变更文件 0 错误；ruff check/format → 0。

Step 6 noAI 模块子集实测（frontend,workspace,daemon）失败 ❌——**归属判定：非本变更引入**：①JsonPreviewer mock 缺导出 + blob.text——previewers 域（HEAD 提交 ade4807d4 并行预览四修的测试债）；②AttributeError pending_thinking_level——半提交态（daemon/schema.py 已在 HEAD 含该字段，消费方 queue.py 未提交），interactive_run_closed 链路炸。本变更 17 文件与失败符号/文件零交集（grep 实证）。known_failures 81 条豁免不覆盖此二者（新增失败）。按诚实原则如实记录不揽责、也不豁免——留移交项由对应并行会话收口。

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
<!-- 机械半边预填（CLI，P0-1）：D→FR→task 链自 decisions.md × tasks/*.md frontmatter 结构化字段构建；
     Evidence / 状态两列是人工判断——逐格复核，未闭环行必须在报告标注风险 -->
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01、FR-02、FR-03、FR-07 | task-05、task-08 | propose 端点+弹层双 tab+distill 派发+quick 来源（无复盘入口） | closed |
| D-002@v1 | FR-01、FR-03 | task-07、task-08 | AgentRun 派发链（distill.py），无后端直调 LLM | closed |
| D-003@v1 | 全 FR | task-09 | 无新表+文件即真相+CLI 同源命中（evidence §3） | closed |
| D-004@v1 | 全 FR | task-01、task-03、task-10 | parser rglob+zone 树+quicklog 零改动回归 | closed |
| D-005@v1 | 全 FR | task-02、task-04、task-09、task-10 | writer 走 apply_ops+409 契约+无代写队列 | closed |
| D-006@v1 | FR-02、FR-07 | task-05 | entry-editor+decisions 422+页面标注 | closed |
| D-007@v1 | 全 FR | task-01、task-04、task-06、task-10 | 两段式+dupRe+白名单+keywords+path 前缀（test_writer 12 用例） | closed |
| D-008@v1 | — | — | superseded by D-008@v2 | superseded |
| D-009@v1 | — | 增量实装（无卡） | distill.py mode 分流 reopen+inject+降级守卫（94bc0a4b9，测试 72） | closed（增量，矩阵未回写=文档债） |
| D-010@v1 | — | 增量实装（无卡） | quick 来源/create_session 复用/origin k-distill/merged_to（94bc0a4b9+26009cac6） | closed（增量，矩阵未回写=文档债） |
| D-008@v2 | — | 增量实装（无卡） | 附件通道+--spec-dir+三重护栏（2c7873e5e，测试 81） | closed（增量，矩阵未回写=文档债） |

## 技术债务 [层：人工判断]
探针 1 零命中。既有登记债（非阻断）：writer.py 三处 starlette HTTP_422_UNPROCESSABLE_ENTITY DeprecationWarning；附件下载 daemon 侧 60s 超时；DistillTaskRead 无 error_code（失败文案包含式）。

## 变更风险等级 [层：人工判断]
deployment-critical（brainstorm gate 判级保留，未显式覆盖）。理由成立：蒸馏链路依赖真实 daemon 在线（AgentRun 派发/附件落盘/spec 回流），design 生命周期契约表 6 事件中 5 个复用 daemon/lease/session 既有事件——逻辑层已由 2160 daemon 测试+81 knowledge 测试覆盖，但端到端需部署实测（M1-M5）。无否定语境抑制。

## Runtime Evidence [层：人工判断]
证据链（全部真实执行，时间 2026-09-17）：
- commits：e69bf3bab（四 Wave 主体）→ 4974bf369（D-010/D-009）→ 2c7873e5e（D-008）
- CLI 同源交叉验证（2026-09-17 午间执行）：sandbox 构树→writer 真实函数生成路由行→sillyspec knowledge validate exit 0 零错误→knowledge search 命中 score 2→负例零命中（evidence §3）
- 应用装配（同期）：app.main import 624 路由；7 新端点注册序 380-386 先于 :path 387（evidence §2）
- 测试（最终态 2026-09-17 19:0x 复跑）：knowledge 81 passed 26.79s；auth 194+2xfail；daemon 2160（增量时点）；前端 knowledge 组件 41+页面 17
- daemon 运行时组件：不涉及直接部署验证（M2 留部署期）——distill 逻辑层终态断言（failed/no_online_daemon、离线立即收敛）由 test_distill 9→17 用例覆盖
- UI 全链/真实 lease 下行：不涉及（M1/M3 留部署期）
- 未授权负例：逻辑层由 router 测试 403×4 覆盖；页面级 M4 留部署期

## 代码审查 [层：人工判断]
走查结论：①编辑/更新链路——entry-editor frontmatter 字节拼回+decisions 双防线（页面不渲染+422 后端）有组件+路由双层测试，回显/残留态由 test_update_top_zone_roundtrip 覆盖；②非主分支流——merge 幂等重试/白名单外 422/非 proposed 源 422/reject 非 proposed 422 均有专测；③守卫一致性——七个端点统一 require_permission 模式（写 KNOWLEDGE_READ 拒 403×4 用例），无操作人越权面（写操作全走权限门+owner 会话）；④载荷契约——gen:types 双次再生成+API parity 0 missing；⑤并发/事务——两段式 merge 段间窗口幂等（dupRe 双守卫专测）、apply_ops 单写者语义未动（daemon 2160 守护）。总体：实现质量扎实，审查发现问题均已闭环或如实登记（三处披露偏差+三笔既有债）。FAIL 因子为部署级证据缺失与并行会话测试失败，非代码缺陷。

## 独立复核（可选回流槽） [层：人工判断——复核后追加]
<!-- verify 完成后的深度复核（独立子代理/二次审查）结论回流至此：缺陷分级（P1 功能不可用 / P2 需求子项 / P3 建议修）+ 修复证据链 + 对「结论枚举」的影响改写。无复核时本节写「无」或删除。复核结论不再只活在聊天记录（2026-09-16 EHS 二次复核实证：5 个 P1 只有聊天可查，变更档案仍写 PASS WITH NOTES）。 -->
