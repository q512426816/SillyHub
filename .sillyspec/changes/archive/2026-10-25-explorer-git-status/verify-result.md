# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。

> verify 执行说明：变更代码在 worktree 分支 `sillyspec/2026-10-25-explorer-git-status`（HEAD 2e5824030，7 任务提交 4d510fe0→2e5824030 + baseline b2d6c3280），主仓 main 另有 3 笔收口提交（915be7d73 spec 产物 / 0f3bf815a 原型冻结+主仓既有红修复 / 3615228c1 knowledge 沉淀）。本报告代码核验与测试复跑均在 worktree 物理目录（`.sillyspec/.runtime/worktrees/2026-10-25-explorer-git-status`）执行；报告按护栏落盘主仓变更目录。worktree Apply: pending，按 CLI verify 流程处理指引未擅自 apply/merge。

## 结论 [层：人工判断]

结论枚举：PASS WITH NOTES——三层聚焦测试全绿（daemon 76 / backend 18 / 前端 96 用例）、探针零 FAIL、7/7 任务验收达标、两处实现偏差已核实合理并 Reverse Sync 进 design.md；NOTES = dev 集成冒烟在本环境不可执行（backend:8000 / frontend:3000 均不可达）移交人工、worktree 分支 Apply: pending、少量文档债（D-014 缺 decisions.md 条目、requirements.md 测试绑定段待填）。

## 移交项（结构化） [层：人工判断——CLI 清单核验]

| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| manual-acceptance | dev 集成冒烟（全局验收标准 4）：Git 日志页「工作区更改」卡与 explorer 树着色在真实数据下的可见性 | ① 起 dev 栈（backend uvicorn + frontend next dev + 本机 sillyhub-daemon 在线并绑定一个含未提交改动的 git 工作区）；② 打开该工作区 Git 日志页，确认更改卡三分组/四色/计数/刷新/点击弹窗 diff（modified 红绿、untracked 全绿、deleted 全红）；③ 打开「文件」页确认树着色+目录蓝点+忽略灰徽标+点击仍为内容预览；④ 旧 daemon（无新 RPC）场景确认 422 降级卡不阻断提交历史 |
| manual-acceptance | worktree 分支 apply/merge 主仓（Apply: pending，变更代码在分支 sillyspec/2026-10-25-explorer-git-status 上，主仓 main 尚未合并） | 由主代理/用户决策后执行 apply（或 merge）；apply 后主仓复跑本报告「测试结果」节三组聚焦命令确认全绿 |
| other | decisions.md 补 D-014 条目（主仓提交门两处既有红修复裁决：turn-timeline 陈旧断言对齐 unify + session-history-scroll rAF 加固——内容现仅存在于 0f3bf815a 提交信息，台账缺条目） | 主代理择机补记（与 D-012/D-013 同格式）；不影响本变更功能 |
| other | requirements.md 测试绑定段（FR-01~FR-05）为 brainstorm 模板残留「（待填…）」 | 归档前由主代理补填（可直接抄本报告探针 7 矩阵与测试结果节的锚点） |
| other | 0f3bf815a 缺 Co-Authored-By 尾注（提交竞态遗留，按纪律不 amend 赌工作区） | 记录在案，不回改 |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]

无（verify-required-evidence.json 不存在——execute Task Review Gate 已于 2026-09-26-task-review-retire 退役停写，无 cannot_verify 任务）。

## 集成验证回执 [层：自述声明——CLI 一致性校验]

- claim: worktree 内三层聚焦测试全绿（daemon 双文件 76 用例 + backend 单文件 18 用例 + 前端 7 文件 96 用例；daemon tsc 0 错误、frontend tsc 仅 2 个基线既有 session-panel 债非本变更文件）
  command: pnpm exec vitest run tests/host-fs-handler-git-dirty-files.test.ts tests/host-fs-handler-git-log.test.ts（sillyhub-daemon @ worktree）
  exit: 0
  log: .sillyspec/.runtime/logs/verify-daemon-test.log
- claim: backend 端点降级/聚合测试全绿（18 passed；61 warnings 均为 starlette DeprecationWarning 噪音）
  command: uv run pytest tests/modules/git_log/test_git_log_dirty_files.py -q（backend @ worktree）
  exit: 0
  log: .sillyspec/.runtime/logs/verify-backend-test.log
- claim: 前端 7 聚焦测试文件全绿（含 task-04/05/06/07 全部新测试与 git-log/explorer 既有回归）
  command: pnpm exec vitest run src/components/git-log/__tests__/worktree-changes-card.test.tsx src/components/git-log/__tests__/worktree-diff-modal.test.tsx src/components/git-log/__tests__/file-tree.test.tsx src/components/git-log/__tests__/git-log-page.test.tsx src/components/git-log/__tests__/git-status-bar.test.tsx src/components/explorer/__tests__/file-explorer-git-status.test.tsx src/components/explorer/__tests__/file-explorer.test.tsx（frontend @ worktree）
  exit: 0
  log: .sillyspec/.runtime/logs/verify-frontend-test.log
- claim: dev 真实集成冒烟未执行——本环境无 dev 服务（backend:8000 / frontend:3000 探测均 000 不可达），移交人工（见移交项表）
  command: curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:8000/api/health
  exit: 非零（连接失败）
  log: （内联探测，无日志文件）
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->

## 任务完成度 [层：人工判断]

7/7 全部完成（勾选状态与实测一致）：

- task-01 daemon 双指令 ✅——host-fs-handler.ts:2018 `gitDirtyFiles` / :2150 `gitWorktreeDiff` 双形态解析（parsePorcelainChangedLine:961，D-012）+ daemon.ts:7811/7815 平名注册 + GL30 方法集 5→7（D-013）；实测 27 新用例 + 49 既有回归全绿、tsc 0。
- task-02 backend 双端点 ✅——router.py:121/136 两端点 WORKSPACE_READ、service.py:1038/:1102 两方法复用骨架零改映射、schema.py:199-237 4 DTO；实测 18 用例全绿。
- task-03 gen:types 三份产物 ✅——e0b90f0a 同批提交三份；openapi.json 含 dirty-files/worktree-diff 路径（4 命中）、前端与 daemon api-types 均含 GitDirtyFilesResponse（各 3 命中），零手写。
- task-04 取数层+更改卡 ✅——git-log.ts:147/:160 fetch + :257/:271 两 hook + queryKeys:72-74；worktree-changes-card.tsx 三分组/四色（测试 :160-171 类名断言）/计数/快照/手动刷新（:277 invalidate 前缀）；13 用例全绿。
- task-05 diff 弹窗 ✅——file-tree.tsx:82 buildFileTree / :193 DiffBody 导出（行为零变化，13 回归用例绿）；worktree-diff-modal.tsx 受控+enabled 门（:240 用例锚定）+三态渲染+截断/binary+错误分型；13 用例全绿。
- task-06 页面挂载 ✅——page.tsx:205-212 GitStatusBar 下挂载 + gitMode!=="no_git" 门控不堆叠 + :331 弹窗受控接线（diffTarget 关闭清 null）；git-log 4 文件 52 用例全绿。
- task-07 explorer 着色 ✅——file-explorer.tsx:302 自取 hook + 渲染期状态映射（Grill P2-③ 竞态解法，:276 晚到变色用例锚定）+ 四色/蓝点（D-011）/忽略徽标（D-003@v2）/点击不变（:302 用例）；8 新用例 + 23 既有回归全绿；原型三件分支上冻结（worktree status 干净佐证）。

## 设计一致性 [层：人工判断]

实现与 design.md 一致（文件清单 22 项全部落盘且功能对齐，接口契约 head_short/empty/files/ignored/status/truncated/binary 与 §接口定义逐字段一致）。execute 报告的两处自洽偏差核实结论：

1. **daemon status 增 `--branch` 旗标**：核实为**新方法自身旗标**而非改既有方法——baseline（b2d6c3280:1672）里既有 gitStatus 本就带 `--branch`；本次分支 diff 的 `--branch` 全部位于新方法（gitDirtyFiles:2029 / gitWorktreeDiff:2165）块内，为兑现接口契约 head_short（porcelain v2 不带 --branch 不输出 branch.oid 头行）的自洽补全。design §Phase 1 命令清单初稿漏写，已由本 verify Reverse Sync 补记进 design.md。
2. **worktree-diff no_git 返回 404**：design 接口定义只写「错误码同上」未显式定义 no_git 行为；实现选择 404「不是 Git 仓库」（service.py:1102-1111 注释：响应模型无 git_mode 字段无法表达 no_git 空态，对齐 get_commit_detail 先例 :815），有测试锚定（test_git_log_dirty_files.py:526 test_worktree_diff_no_git_404）。判定为 design 缺口的合理填补，已 Reverse Sync 补记进 design.md 接口定义节。

执行期裁决 D-012（porcelain 双形态解析）/D-013（GL30 5→7）已落 decisions.md 且代码+测试锚定齐。D-014（主仓提交门既有红修复）仅在 0f3bf815a 提交信息中、decisions.md 缺条目——记为文档债（见移交项），不影响本变更功能面。

模块文档一致性：verify 阶段已同步三份（modules/backend.md git_log 段追加第 5/6 端点增量；modules/frontend.md 新增「工作区 git 感知三层 UI」段；modules/sillyhub-daemon.md 新增「host_fs git 第 6/7 方法」段），module-impact.md 更新结果表回填 3 done + 1 skipped（_module-map.yaml 无需新条目——触达文件均落既有模块前缀内）。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ glob 项未展开（agent 手动展开扫描）：frontend/src/app/(dashboard)/workspaces/[id]/git-log/page.tsx（人工核验：文件在盘、挂载实现完整，见任务完成度 task-06）
- ℹ️ 7 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）

#### 探针 2：设计关键词覆盖
人工核验（worktree 分支源码 grep）：全部能力关键词命中实现——dirty-files（router.py:121 + git-log.ts:151）、worktree-diff（router.py:136 + git-log.ts:164）、ignored 顶层聚合（host-fs-handler.ts `--directory` 分支 + file-explorer.tsx:112）、numstat（gitDirtyFiles ③ 段 join）、porcelain v2 双形态（parsePorcelainChangedLine:961）、no-index（:1044）、三分组文案「更改/未纳入版本管理/已忽略」（worktree-changes-card.tsx:9-11）、四色 token（text-success/text-primary/text-error+line-through/text-muted-foreground，卡片测试 :160-171 断言）、目录蓝点（dirtyAncestors，file-explorer-git-status.test.tsx:174/:236）、手动刷新 invalidate（worktree-changes-card.tsx:277）、64KB 截断 truncated（modal:158-161）、binary（modal:135-139）、422 降级（modal:53 + backend GitLogDaemonTooOld）。无「可能未实现」项。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（sillyhub-daemon/src、NEW:sillyhub-daemon/tests）找到 1 个测试文件（sillyhub-daemon/src/spec-sync.ts）
- ✅ task-02: 模块目录（backend/app/modules/git_log、NEW:backend/tests/modules/git_log）找到 2 个测试文件（backend/app/modules/git_log/tests/test_graph_layout.py、backend/app/modules/git_log/tests/test_router.py）
- ✅ task-03: 模块目录（backend、frontend/src/lib、sillyhub-daemon/src）找到 85 个测试文件（backend/app/core/spec_paths.py、backend/app/core/tests/test_auth_deps_db_release.py、backend/app/core/tests/test_config_auth.py、backend/app/core/tests/test_errors.py、backend/app/core/tests/test_monitoring.py …）
- ✅ task-04: 模块目录（frontend/src/lib、frontend/src/components/git-log、NEW:frontend/src/components/git-log、NEW:frontend/src/components/git-log/__tests__）找到 18 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/change-autolink.test.ts、frontend/src/lib/daemon/__tests__/runtimes.test.ts、frontend/src/lib/daemon.test.ts …）
- ✅ task-05: 模块目录（frontend/src/components/git-log、frontend/src/components/git-log/__tests__、NEW:frontend/src/components/git-log、NEW:frontend/src/components/git-log/__tests__）找到 8 个测试文件（frontend/src/components/git-log/__tests__/commit-detail-drawer.test.tsx、frontend/src/components/git-log/__tests__/commit-graph.test.tsx、frontend/src/components/git-log/__tests__/file-tree.test.tsx、frontend/src/components/git-log/__tests__/git-log-page.test.tsx、frontend/src/components/git-log/__tests__/git-status-bar.test.tsx …）
- ✅ task-06: 模块目录（frontend/src/app/(dashboard)/workspaces/[id]/git-log、frontend/src/components/git-log/__tests__）找到 8 个测试文件（frontend/src/components/git-log/__tests__/commit-detail-drawer.test.tsx、frontend/src/components/git-log/__tests__/commit-graph.test.tsx、frontend/src/components/git-log/__tests__/file-tree.test.tsx、frontend/src/components/git-log/__tests__/git-log-page.test.tsx、frontend/src/components/git-log/__tests__/git-status-bar.test.tsx …）
- ✅ task-07: 模块目录（frontend/src/components/explorer、frontend/src/components/explorer/__tests__、NEW:frontend/src/components/explorer/__tests__、frontend/src/components/prototype、frontend/scripts、frontend/prototype-dist）找到 5 个测试文件（frontend/src/components/explorer/__tests__/file-explorer.test.tsx、frontend/src/components/explorer/__tests__/file-preview.test.tsx、frontend/src/components/explorer/__tests__/file-explorer-git-status.test.tsx、frontend/src/components/prototype/__tests__/flow-diagram.test.tsx、frontend/src/components/prototype/__tests__/prototype-smoke.test.tsx）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

**集成盲区标注（人工）**：task-02（backend→daemon ws RPC 跨进程装配）与 task-06（页面跨组件装配）为集成敏感面——单测均以 mock RPC/受控 props 锁定，真实跨进程链路（daemon 在线 + 真实 git 仓库）归 dev 集成冒烟，本环境 dev 服务不可达，已列移交项 manual-acceptance。task-01/03/04/05/07 无路由/跨进程装配面（单进程解析/产物/纯组件）。

**断言有效性抽查（人工）**：PASS——①daemon WD4（host-fs-handler-git-dirty-files.test.ts:416）以 mock exit=1+err 非空断言「业务成功」真实输出，并覆盖 killed/signal/越界/magic pathspec 异常分支；②backend test_worktree_diff_no_git_404（test_git_log_dirty_files.py:526）断言 404 状态码+文案而非空断言，五形态×两端点全覆盖边界；③前端 file-explorer-git-status.test.tsx:276 晚到变色用例走公开渲染行为（rerender 后类名断言）非实现细节。

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable（covered-service 适用：端点行为由 service 层等非端点层测试锁定，证据附测试锚点；non-testable 是文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 上述全部用例在 vitest 单文件运行通过（聚焦测试，不跑全量） | `sillyhub-daemon/tests/host-fs-handler-git-dirty-files.test.ts` | vitest（`sillyhub-daemon/tests/host-fs-handler-git-dirty-files.test.ts`） | covered | `sillyhub-daemon/tests/host-fs-handler-git-dirty-files.test.ts`（verify 实跑 27 用例 + host-fs-handler-git-log.test.ts 49 回归 = 76 passed，exit 0，日志 .sillyspec/.runtime/logs/verify-daemon-test.log） |
| 两方法遵守不抛错误约定：任何 git 失败返回 error 字段而非抛异常（对齐既有五 git 方法） | `sillyhub-daemon/tests/host-fs-handler-git-dirty-files.test.ts` | git、error（`sillyhub-daemon/tests/host-fs-handler-git-dirty-files.test.ts`） | covered | `sillyhub-daemon/tests/host-fs-handler-git-dirty-files.test.ts:301`（DF9: porcelain 失败（非 git 目录）→ error 通道整体返回，不抛）、:154（DF1~DF7 四态清单解析） |
| RPC 注册为平名（无 host_fs. 前缀），backend 可按 method 名直连调用 | `sillyhub-daemon/tests/host-fs-handler-git-dirty-files.test.ts` | host_fs、前缀（`sillyhub-daemon/tests/host-fs-handler-git-dirty-files.test.ts`） | covered | `sillyhub-daemon/tests/host-fs-handler-git-dirty-files.test.ts:619`（RG1: 两新方法平名注册（无 host_fs. 前缀））+ 实源 sillyhub-daemon/src/daemon.ts:7811/:7815 |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| pytest 单文件全绿（聚焦测试，不跑全量） | `backend/tests/modules/git_log/__init__.py`<br>`backend/tests/modules/git_log/test_git_log_dirty_files.py` | pytest（`backend/tests/modules/git_log/test_git_log_dirty_files.py`） | covered | `backend/tests/modules/git_log/test_git_log_dirty_files.py`（verify 实跑 18 passed，exit 0，日志 .sillyspec/.runtime/logs/verify-backend-test.log） |
| 两端点 OpenAPI schema 可被后续 gen:types 正确生成（response_model 齐全） | `backend/tests/modules/git_log/__init__.py`<br>`backend/tests/modules/git_log/test_git_log_dirty_files.py` | 两端点（`backend/tests/modules/git_log/test_git_log_dirty_files.py`） | covered | `backend/tests/modules/git_log/test_git_log_dirty_files.py:345`（test_openapi_lists_two_new_paths 锁两路径）+ task-03 实际生成事实（三份产物含新类型，commit e0b90f0a） |
| 降级文案中文且与既有 git-log 端点口径一致 | `backend/tests/modules/git_log/__init__.py`<br>`backend/tests/modules/git_log/test_git_log_dirty_files.py` | git、log（`backend/tests/modules/git_log/__init__.py`、`backend/tests/modules/git_log/test_git_log_dirty_files.py`） | covered | `backend/tests/modules/git_log/test_git_log_dirty_files.py:410`（test_dirty_files_no_git_empty_state）、:398（daemon_too_old_422）、:426（timeout_504）——五形态降级全断言 |

**task-03**
- ℹ️ 既有用例候选（FR 关联回归面，本变更未改动；判定仍由你复核，命中≠结论）：候选全量在 facts/trace（200+ 文件清单此处省略，见 verify-facts.json）。
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 三份产物同批更新且相互一致（同一 schema 源生成） | （产物对账类，无测试文件归属——机械候选 20 个全为噪音） | 同一、schema | non-testable | 产物对账类验收：git 事实核验——commit e0b90f0a 同批提交 backend/openapi.json（+287 行含两路径与 4 DTO schema）+ frontend/src/lib/api-types.ts + sillyhub-daemon/src/api-types.ts，三份 grep 均含 GitDirtyFilesResponse（产物内容见本报告「任务完成度」task-03 行） |
| frontend/src/lib/api-types.ts 与 sillyhub-daemon/src/api-types.ts 含新 DTO 类型，零手写补丁 | （同上，机械候选为噪音） | frontend、src、lib、api、types | non-testable | 产物内容核验：两份 api-types 均含 GitDirtyFilesResponse/GitWorktreeDiffResponse（各 3 处命中），且分支 diff 显示产物仅随 gen:types 变更（commit e0b90f0a 独立产物提交，无手写混入）；零手写由生成器提交形态佐证 |
| backend/openapi.json 含 /workspaces/{workspace_id}/git-log/dirty-files 与 /worktree-diff 两路径 | （机械候选为噪音，但有直接测试锚点） | backend、json、workspaces、workspace_id | covered | `backend/tests/modules/git_log/test_git_log_dirty_files.py:345`（test_openapi_lists_two_new_paths——直接断言 openapi 两路径在场） |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 卡片测试全绿；tsc 无新错误 | `frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx` | — | covered | `frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx`（verify 实跑 13 用例全绿；frontend tsc 仅 2 个基线既有 session-panel 债——session-panel-variant.test.tsx:238 / page-helpers.tsx:435，均非本变更文件，a9f5fae15 引入） |
| 颜色语义为 IDEA 口径（D-002），不触碰 frontend/src/components/daemon/file-changes/file-changes-card.tsx | `frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx` | frontend（`frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx`） | covered | `frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx:160-171`（text-primary/text-success/text-error+line-through/text-muted-foreground 四色类名逐项断言）+ git diff --stat 分支 vs baseline 对 file-changes-card.tsx 零行改动（D-002 约束实证） |
| 卡片为 props 驱动（workspaceId+onOpenFile），挂载留给 task-06 | `frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx` | workspaceId、onOpenFile（`frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx`） | covered | `frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx:206`（点击文件行 → onOpenFile(path, status)；忽略行无点击语义） |

**task-05**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 弹窗测试与 file-tree 回归全绿；tsc 无新错误 | `frontend/src/components/git-log/__tests__/file-tree.test.tsx`<br>`frontend/src/components/git-log/__tests__/worktree-diff-modal.test.tsx` | file、tree（`frontend/src/components/git-log/__tests__/file-tree.test.tsx`、`frontend/src/components/git-log/__tests__/worktree-diff-modal.test.tsx`） | covered | `frontend/src/components/git-log/__tests__/worktree-diff-modal.test.tsx:118`（三态渲染）、:195（错误分型降级）；verify 实跑弹窗 13 + file-tree 回归 13 = 26 用例全绿（见 verify-frontend-test.log） |
| 弹窗为受控组件（open/path props），挂载接线留给 task-06 | `frontend/src/components/git-log/__tests__/file-tree.test.tsx`<br>`frontend/src/components/git-log/__tests__/worktree-diff-modal.test.tsx` | open、path、props（`frontend/src/components/git-log/__tests__/worktree-diff-modal.test.tsx`、`frontend/src/components/git-log/__tests__/file-tree.test.tsx`） | covered | `frontend/src/components/git-log/__tests__/worktree-diff-modal.test.tsx:240`（open=false 不取数（apiFetch 零调用））、:245（path=null 不取数；关闭后重开按新 path 取数） |

**task-06**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 页面测试与状态条回归全绿；tsc 无新错误 | `frontend/src/components/git-log/__tests__/git-log-page.test.tsx`<br>`frontend/src/components/git-log/__tests__/git-status-bar.test.tsx` | — | covered | `frontend/src/components/git-log/__tests__/git-log-page.test.tsx`（verify 实跑含新增挂载/点击弹窗/no_git 三用例；git-log 全组 4 文件 52 用例全绿——execute 提交 2e582403 复核 + verify 7 文件 96 用例实跑全绿） |
| 更改卡位于状态条与提交列表工具栏之间，不挤掉提交列表首屏（卡可折叠） | `frontend/src/components/git-log/__tests__/git-log-page.test.tsx`<br>`frontend/src/components/git-log/__tests__/git-status-bar.test.tsx` | — | covered | `frontend/src/components/git-log/__tests__/git-log-page.test.tsx`（task-06 新增挂载用例断言卡在状态条之下工具栏之上 + 卡片 data==null 静默守卫不与工具栏断言冲突）；卡可折叠由 `worktree-changes-card.tsx` 折叠态实现 + 卡片测试覆盖 |

**task-07**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 着色测试与 explorer 回归全绿；tsc 无新错误 | `frontend/src/components/explorer/__tests__/file-explorer.test.tsx`<br>`frontend/src/components/explorer/__tests__/file-explorer-git-status.test.tsx` | explorer（`frontend/src/components/explorer/__tests__/file-explorer.test.tsx`、`frontend/src/components/explorer/__tests__/file-explorer-git-status.test.tsx`） | covered | `frontend/src/components/explorer/__tests__/file-explorer-git-status.test.tsx:142`（FileExplorer git 着色 describe）+ verify 实跑 8 新用例 + file-explorer.test.tsx 23 既有回归 = 31 用例全绿（含 QueryClient 包装适配后的回归） |
| 原型产物与源码同源（重编译后 git diff 仅预期新增 explorer-git-status.html，其余 11 产物 diff 为空） | `frontend/src/components/explorer/__tests__/file-explorer.test.tsx`<br>`frontend/src/components/explorer/__tests__/file-explorer-git-status.test.tsx` | git（`frontend/src/components/explorer/__tests__/file-explorer-git-status.test.tsx`） | non-testable | 产物对账类验收：git 事实核验——worktree 分支 ca545af3f 完成重编译冻结（提交信息实证 diff 空 + 11 漂移产物还原），verify 复核 worktree `git status --short` 干净（原型三件无未提交漂移）；主仓 0f3bf815a 已提交原型三件（+557 行）。当前主仓工作区再现的 11 个 prototype-dist M 为并行会话依赖重装漂移，非本变更产物（本变更产物 explorer-git-status.html 已入库不漂） |
| design.md 验收条目逐项有证据 | `frontend/src/components/explorer/__tests__/file-explorer.test.tsx`<br>`frontend/src/components/explorer/__tests__/file-explorer-git-status.test.tsx` | design（`frontend/src/components/explorer/__tests__/file-explorer-git-status.test.tsx`） | non-testable | 对账类条目：由本验证报告承接——FR-01~FR-05 逐条核验见「任务完成度」「设计一致性」与探针 2 关键词面；测试锚点汇总见「测试结果」节 |

- ⚠️ 零/半自动化承接条目 7 条——复核走查结论见「代码审查」节（本变更无编辑/更新链路，全部走查项落只读展示面，无 P1 藏身）

#### 探针 4：决策追踪覆盖
14 条当前版本决策（D-001~D-011 + D-003@v2 + D-012/D-013）全部闭环，无 unresolved/blocking：D-001~D-011+D-003@v2 经 requirements.md 决策覆盖矩阵 → plan.md 覆盖矩阵 → tasks 卡逐级引用；D-012/D-013 为 execute 期裁决（结构化字段无 plan 前置引用属预期），由 decisions.md 落条 + module-impact.md Wave 1 实况回填引用 + 代码/测试锚定（详见下方决策追踪矩阵）。superseded 检查：D-003@v1 被 D-003@v2 取代后，requirements/design/plan 三处引用均已用 @v2，无 stale 引用。**D-014 不在 decisions.md 台账（仅存在于 0f3bf815a 提交信息）——非「当前版本决策」故不入闭环矩阵，记为文档债移交项。**

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 2439 backend endpoints (live [scan-root 665 + worktree 665] + artifact 1995), 0 frontend calls [scope: change-diff (23 files @ worktree)] | 12 backend endpoints unused by frontend (+659 stock noise collapsed)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ⚠️ 12 个本变更端点前端未调用（warning 不阻断）：GET /commits、GET /status、GET /dirty-files、GET /worktree-diff、GET /commits …
- ℹ️ 另有 659 个存量端点未调用（他模块存量噪音，已折叠不逐条列出）
- **人工复核：判定为路径模板口径噪音，非真实 contract gap**——前端实际调用在 `frontend/src/lib/git-log.ts:151`（`/api/workspaces/${encodeURIComponent(workspaceId)}/git-log/dirty-files`）与 :164（worktree-diff），机械匹配无法把模板字符串 `${encodeURIComponent(workspaceId)}` 对齐 `{workspace_id}` 占位符；既有端点 GET /commits、GET /status 同被列「未调用」佐证（这两者前端调用自 2026-08 起就在 lib/git-log.ts）。语义面：两新端点的前端消费完整（更改卡 + explorer 着色 + 弹窗三处），无 FAIL。

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- 人工终审：合规——分支净增（22 清单文件 8 NEW + 14 修改），无静默删除面。

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 22 个非 Java 清单文件不在探针 9 扫描面）
#### 探针 10：预填注清零（error 门）
- ✅ 预填注清零（8 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml——红线机检零打扰，D-002）
#### 探针 12：UI 视觉证据（分级门）
- ✅ UI 视觉证据在场（visual-evidence.md 非空）

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]
| 端点 | 判定 | 用例依据 ID | 结果 | 证据 |
|---|---|---|---|---|
| GET /workspaces/{wid}/git-log/dirty-files | covered | 契约表@task-02 五形态用例（200 聚合+RPC 契约 / 404 未绑定 / 502 离线 / 422 旧 daemon / no_git 空态）+ 504 超时 + 契约缺口 502 + 鉴权 | 18 用例组内 9 条 dirty-files 用例全绿（verify 实跑） | design接口表#GET /workspaces/{wid}/git-log/dirty-files；端点级测试锚点 `backend/tests/modules/git_log/test_git_log_dirty_files.py:357`（test_dirty_files_200_aggregate_and_rpc_contract；同文件 :377 not_bound_404、:386 offline_502、:398 daemon_too_old_422、:410 no_git_empty_state、:426 timeout_504、:434 contract_gap_502、:580 require_auth） |
| GET /workspaces/{workspace_id}/git-log/dirty-files | covered | 同上（CLI 解析出的 {workspace_id} 参数名形态，同一端点） | 同上 | design接口表#GET /workspaces/{workspace_id}/git-log/dirty-files；端点级测试锚点 `backend/tests/modules/git_log/test_git_log_dirty_files.py:345`（test_openapi_lists_two_new_paths 锁该路径参数形态）+ :357（聚合用例同上） |
| GET /workspaces/{workspace_id}/git-log/worktree-diff | covered | 契约表@task-02 五形态用例（200+RPC 契约含 30s 超时 / 404 / 502 / 422 旧 daemon / no_git→404）+ path 预检 422 + 缺 path 422 + 鉴权 | 18 用例组内 9 条 worktree-diff 用例全绿（verify 实跑） | design接口表#GET /workspaces/{workspace_id}/git-log/worktree-diff；端点级测试锚点 `backend/tests/modules/git_log/test_git_log_dirty_files.py:460`（test_worktree_diff_200_and_rpc_contract；同文件 :484 not_bound_404、:495 offline_502、:510 daemon_too_old_422、:526 no_git_404、:539 daemon_error_404、:555 invalid_path_422_pre_rpc、:568 missing_path_422、:580 require_auth） |
  ↳ frontend: `frontend/src/lib/git-log.ts:160` fetchWorktreeDiff + `worktree-diff-modal.tsx`（useGitLogWorktreeDiff 组件内取数，弹窗 13 用例锁定消费面/降级分型）
  ↳ frontend: `frontend/src/lib/git-log.ts:147` fetchDirtyFiles + `worktree-changes-card.tsx`/`file-explorer.tsx` 双消费（卡片 13 用例 + explorer 着色 8 用例锁定）

## 测试结果 [层：确定性检查——CLI 实测对账]

聚焦复跑（worktree 物理目录，2026-10-25 22:54 前台同步执行，规则 0 禁全量）：

| 栈 | 命令 | 结果 | 日志 |
|---|---|---|---|
| daemon | `pnpm exec vitest run tests/host-fs-handler-git-dirty-files.test.ts tests/host-fs-handler-git-log.test.ts` | 2 文件 76 passed（27 新 + 49 既有回归），exit 0 | .sillyspec/.runtime/logs/verify-daemon-test.log |
| daemon | `pnpm exec tsc --noEmit` | 0 错误，exit 0 | .sillyspec/.runtime/logs/verify-daemon-tsc.log |
| backend | `uv run pytest tests/modules/git_log/test_git_log_dirty_files.py -q` | 18 passed（61 warnings 均 starlette DeprecationWarning 噪音），exit 0 | .sillyspec/.runtime/logs/verify-backend-test.log |
| frontend | `pnpm exec vitest run`（7 文件：worktree-changes-card / worktree-diff-modal / file-tree / git-log-page / git-status-bar / file-explorer-git-status / file-explorer） | 7 文件 96 passed，exit 0 | .sillyspec/.runtime/logs/verify-frontend-test.log |
| frontend | `pnpm exec tsc --noEmit` | exit 1——仅 2 个**基线既有**错误（session-panel-variant.test.tsx:238 TS2322 / session-panel/page-helpers.tsx:435 TS2532，a9f5fae15 引入、非本变更文件）；本变更文件零新错误 | .sillyspec/.runtime/logs/verify-frontend-tsc.log |

known_failures 豁免清单（均非本变更引入，不阻断）：
1. frontend tsc 2 个 session-panel 基线债（上述）；
2. 主仓全量 pnpm test 既有 1 个脆弱红：session-history-scroll rAF 用例（2026-10-13 会话域固有债，负载下锚窗耗尽；0f3bf815a 已加 5s waitFor 隔离复跑绿）；
3. execute 期 D-014 裁决处理的两处主仓提交门既有红（turn-timeline 陈旧断言 / scroll rAF）已修复入库（0f3bf815a）。

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-02、FR-03 | task-04、task-06 | 挂载位置 `frontend/src/app/(dashboard)/workspaces/[id]/git-log/page.tsx:205-212`（GitStatusBar 之下工具栏之上）+ git-log-page.test.tsx 挂载用例（52 用例全绿） | 已闭环 |
| D-002@v1 | FR-02 | task-04 | worktree-changes-card.test.tsx:160-171 四色类名断言；分支 diff 对 file-changes/file-changes-card.tsx 零行改动（git diff --stat 空实证） | 已闭环 |
| D-003@v1 | ⚠️ 未映射 | ⚠️ 未闭环（无 task 回指） | superseded by D-003@v2——v1 行无独立下游引用属预期（防复潮历史保留条目），全部现行引用走 @v2 | 已闭环（superseded，现行链走 D-003@v2） |
| D-004@v1 | FR-03 | task-05 | daemon WD 用例单文件判态分流（HEAD 基线）+ worktree-diff-modal.test.tsx:118 三态渲染（modified/untracked 全绿/deleted 全红） | 已闭环 |
| D-005@v1 | FR-01 | task-07 | file-explorer-git-status.test.tsx:302「点击行为回归（D-005）：着色文件节点点击仍触发 onSelectFile」 | 已闭环 |
| D-006@v1 | FR-01、FR-02、FR-03、FR-04 | task-01、task-02 | daemon.ts:7811 平名注册 + RG1 用例（:619）；backend service 复用 _resolve_binding/_probe_git_mode/_send_git_rpc 骨架零改映射（509f7a6a 提交信息 + 18 用例） | 已闭环 |
| D-007@v1 | FR-02 | task-04 | 单一数据源：useGitLogDirtyFiles（git-log.ts:257）被 worktree-changes-card 与 file-explorer（file-explorer.tsx:302）双消费，同源着色 | 已闭环 |
| D-008@v1 | FR-01 | ⚠️ 未闭环（无 task 回指） | rejected 防复潮条目——约束面「explorer 契约零改动」由 task-07 承接（explorer 四端点零改动 + file-explorer.test.tsx 23 既有回归全绿） | 已闭环（rejected 条目以约束面承接） |
| D-009@v1 | FR-02 | ⚠️ 未闭环（无 task 回指） | rejected 防复潮条目——约束面「手动刷新不轮询」由 task-04 承接（worktree-changes-card.tsx:277 invalidate 手动刷新，卡片测试覆盖） | 已闭环（rejected 条目以约束面承接） |
| D-010@v1 | FR-01、FR-02、FR-03 | task-01、task-05 | host-fs-handler-git-dirty-files.test.ts:416 WD4（no-index exit=1 = 有差异常态成功）+ host-fs-handler.ts:1020-1079 局部 execFile 实现 | 已闭环 |
| D-011@v1 | FR-01、FR-02、FR-03 | task-01、task-07 | porcelain 末段 rejoin/u→modified：DF2/DF3 用例（双形态）+ u 条目用例；蓝点口径：file-explorer-git-status.test.tsx:236（ignored 不贡献蓝点） | 已闭环 |
| D-003@v2 | FR-01、FR-02、FR-03 | task-01、task-07 | ignored `--directory` 顶层聚合 DF 用例（host-fs-handler-git-dirty-files.test.ts）+ file-explorer-git-status.test.tsx:205（忽略目录灰+徽标不递归、散落单文件同徽标） | 已闭环 |
| D-012@v1 | ⚠️ 未映射 | ⚠️ 未闭环（无 task 回指） | execute 期裁决（plan 无前置引用属预期）：decisions.md 落条 + module-impact.md Wave 1 回填引用 + parsePorcelainChangedLine（host-fs-handler.ts:961）双形态实现 + DF2/DF3 用例锚定 + knowledge/uncategorized.md porcelain 实证沉淀（3615228c1） | 已闭环（执行期裁决，证据链齐全） |
| D-013@v1 | ⚠️ 未映射 | ⚠️ 未闭环（无 task 回指） | execute 期裁决：decisions.md 落条 + module-impact.md 回填引用 + tests/host-fs-handler-git-log.test.ts GL30 期望集 5→7（verify 实跑 49 用例含该断言全绿） | 已闭环（执行期裁决，证据链齐全） |

## 技术债务 [层：人工判断]

- 探针 1：本变更清单文件零 TODO/FIXME 残留；CONCERNS.md 红区（spec_profile 骨架）与黄区（根 package.json 占位等）均不在本变更触达面。
- 既有债登记（非本变更引入，已在 known_failures 豁免）：frontend tsc 2 个 session-panel 基线错误（a9f5fae15）；主仓全量 1 个 session-history-scroll 脆弱红（2026-10-13 会话域）。
- 文档债（移交项）：D-014 缺 decisions.md 条目；requirements.md 测试绑定段待填；0f3bf815a 缺 Co-Authored-By 尾注。
- 主仓工作区 11 个 prototype-dist 漂移 M + marquee 归档删除暂存为并行会话在途产物，不属本变更，提交时按精确 pathspec 排除。

## 变更风险等级 [层：人工判断]

integration-critical——理由：新增「前端 → backend 两端点 → daemon 平名 RPC → 本机 git execFile」三层跨进程只读链路，全局验收标准 4 明示「组件单测全绿 ≠ 集成正确」要求 dev 冒烟；design.md frontmatter 无 risk_level 显式声明。生命周期面为 N/A（design 生命周期契约表：单次 execFile、30s 超时自灭、无长驻进程）。运行集成冒烟在本环境不可执行（dev 栈不可达），已列移交项 manual-acceptance——不因环境缺失而降级为 unit-sufficient。

## Runtime Evidence [层：人工判断]

- 代码基线：worktree 分支 sillyspec/2026-10-25-explorer-git-status @ 2e5824030（7 任务提交链 4d510fe0 → 509f7a6a → e0b90f0a → f6a366da → 24a1281e → ca545af3 → 2e582403）；主仓 main @ 3615228c1（收口 3 笔 915be7d73/0f3bf815a/3615228c1）。
- 测试执行（worktree 目录，前台同步，2026-10-25 22:54）：daemon vitest 76 passed exit 0；backend pytest 18 passed exit 0；frontend vitest 96 passed exit 0；daemon tsc exit 0；frontend tsc exit 1 仅 2 基线债——日志五份在 .sillyspec/.runtime/logs/verify-*.log。
- 启动命令/端点/请求响应/日志片段：不涉及（本 verify 未起服务——dev 栈探测 backend:8000 / frontend:3000 均 000 不可达，集成冒烟移交人工，见移交项表）。
- 生命周期终态断言：不涉及（纯只读查询链路，无会话/租约/长驻进程；design 生命周期契约表 N/A）。
- 失败模式排除：降级五形态（404 未绑定/502 离线/422 旧 daemon/504 超时/no_git）由 backend 18 用例锁定；daemon 侧 git 失败走 error 通道不抛（DF9）；前端查询失败静默降级无色（file-explorer-git-status.test.tsx:268）。

## 代码审查 [层：人工判断]

走查结论（探针 7 ⚠️ 零/半自动化承接条目 7 条的定向走查）：
- ① 编辑/更新链路：不适用——本变更为纯只读展示链路，无编辑/写路径（design 非目标明示不做提交/暂存/推送）。
- ② 非主分支流：diff 弹窗三特判（modified 标准 diff / untracked no-index 全绿 / deleted 全红）均有独立用例（WD1~WD8 + 弹窗三态渲染）；untracked 无 numstat 行数→前端仅「新文件」徽标（卡片测试覆盖）。
- ③ 守卫一致性：两端点与既有四端点同款 `require_permission(Permission.WORKSPACE_READ)`（router.py:125/:140，test_endpoints_require_auth:580 锁定）；daemon 侧 root 越界/pathspec magic 拒绝（DF 用例）——无越权面。
- ④ 载荷字段契约：producer→consumer 全链对齐——daemon RPC 载荷字段（head_short/empty/files/ignored/status/truncated/binary）→ service 归一化 → response_model → gen:types 双份产物（FR-05 实证）；无手写类型。
- ⑤ 分页/并发/事务：不适用——无分页、无事务；dirty-files 单次采集无共享状态（拉取式快照，D-007）。
- 时序竞态专项（Grill P2-③）：explorer 晚到 dirty-files 不重建 treeData 即变色——渲染期 context 映射实现，:276 用例锚定，无竞态残留。

总体评价：实现质量良好，只读纪律（禁写 git 操作）全程遵守（探针 2 命令面仅 status/ls-files/diff 只读子命令 + 测试「命令构造只读断言」）；测试断言真实（非空断言），覆盖边界（exit 语义/双形态解析/越界/超时/降级五形态/时序）。未发现 P1/P2 功能缺陷。

## 独立复核（可选回流槽） [层：人工判断——复核后追加]

execute 阶段独立验收审查已双 pass（.sillyspec/changes/2026-10-25-explorer-git-status/review.json，14 项 pass）；verify 阶段为一次性瘦会话执行，无追加独立复核——如需二次复核可另派子代理，回流结论追加于此。
