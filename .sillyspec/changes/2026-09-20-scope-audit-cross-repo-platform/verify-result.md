# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

## 结论 [层：人工判断]

结论枚举：PASS WITH NOTES——三层自动化验证全绿（daemon 16/16、backend 11 passed + ruff/mypy、frontend 33/33 + tsc 0 错 + gen:types 零漂移），execute 阶段独立验收 7/7 pass；唯一移交项=真机人工验收（f85a6650 类多仓工作区的 daemon 在另一台机器，本机无法端到端实跑，且该机 sillyspec CLI 需升级到契约 v2 版本才有 repos 输出）。

## 移交项（结构化） [层：人工判断——CLI 清单核验]

| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| manual-acceptance | 真机验收：在 f85a6650 的 daemon 所在机器（或任一多仓工作区）打开变更中心对账卡，人工核对主仓段 + 各跨仓段真实三态与锚点档（R-01 应对：夹具逐字段对齐上游契约示例，真机首查核对一次） | ①目标机器 sillyspec CLI 升级到含 2026-09-20-scope-audit-cross-repo 的版本（契约 v2 输出 repos）；②daemon 重新构建部署（本变更投影代码）；③打开 workspace f85a6650 变更 7fa17ae5 对账卡核对三仓分段/锚点档/degraded 文案；单仓变更对照确认回退与旧版一致 |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]

无（3/3 任务均有夹具级测试证据，无 cannot_verify）。

## 集成验证回执 [层：自述声明——CLI 一致性校验]

无（非 integration-critical：纯既有查询链路的响应扩展，无启动/部署/路由装配面；RPC 链路行为由三层夹具测试锁定，跨进程真机面已列移交项）。

## 任务完成度 [层：人工判断]

- task-01 ✅ 已完成：daemon 投影 + 类型 + 16/16 测试（worktree diff sillyhub-daemon/src/sillyspec-manager.ts +91/-1、tests/sillyspec-file-diff.test.ts +180）
- task-02 ✅ 已完成：backend schema 三新类 + 防御透传 + 11 passed + ruff/mypy 绿（backend/app/modules/change/schema.py +61、scope_audit.py +69、tests +261）
- task-03 ✅ 已完成：gen:types 零漂移 + 卡片分组双分支 + 33/33（含 mobile 15/quicklog 7 回归零改动全绿）+ tsc 0 错
- 完成率 3/3（100%）

## 设计一致性 [层：人工判断]

实现与 design.md 一致，无偏差：

- 投影白名单封闭：daemon repos 投影逐字段与 design「接口定义 daemon TS」一致（key/anchor 四字段/anchor_label 短化/totals 六字段/degraded/degraded_reason），repoPath 不投影（D-001）
- 分组激活条件与桶序：`groupedRepos`（repos 非空数组 && mode==='full-flow'）+ `detailBuckets`（cross_repo ?? 'main' 归桶、repos[] 序、孤儿桶首现尾随）与 design「消费语义」逐条一致
- 回退形态：兼容策略 1/2/6 全部落实（无 repos → 现状渲染 + 旧 testid + 不渲染 note；旧形态跨仓行归主仓平铺）
- 生成物：api-types.ts 与 openapi.json 同变更落地且重跑 md5 一致（规则 21 闭环）
- 预填失实改写两处：探针 7「卡无 acceptance」失实（三卡 frontmatter acceptance 在场，plan 门禁已验，按预填协议手工改写）；接口矩阵解析零端点（design 声明行/表格两种写法均未被解析器识别，已按 agent 复核协议手工补行——工具侧解析面问题，不影响本变更事实）

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中

#### 探针 2：设计关键词覆盖
- cross_repo：frontend/src/components/changes/scope-audit-command-card.tsx 3 处（分桶/类型）+ sillyhub-daemon/src/sillyspec-manager.ts 投影 + backend/app/modules/change/scope_audit.py isinstance 守卫 ✅
- repos[]：daemon 类型 SillySpecAuditRepo[] + 投影循环 / backend ScopeAuditRepo 构造 / 前端 groupedRepos ✅
- anchor_label：sillyhub-daemon/src/sillyspec-manager.ts 9 处（含 ^[0-9a-f]{7,40}$ 短化正则）✅
- degraded_reason：backend/app/modules/change/scope_audit.py 6 处 / 前端 scope-audit-repo-degraded-<repo> 段 ✅
- 按仓分组：groupedRepos/detailBuckets/仓标徽章 bg-brand-50 ✅
- note 顶摘要：scope-audit-note testid 组件内唯一一处（分组分支）✅
- 语义锚 → null（D-004@v2）：daemon 三分支测试（hash/语义锚/degraded）✅
- 全部关键词命中，无 ⚠️ 未实现项。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 11 个测试文件
- ✅ task-02: 模块目录（backend/app/modules/change、backend/app/modules/change/tests）找到 10 个测试文件
- ✅ task-03: 模块目录找到 103 个测试文件
- 集成盲区标注（3.4）：路由/跨模块装配无新面（零新增端点、零路由改动）；跨进程 RPC 链路（真 CLI→daemon→backend→前端）自动化用夹具替代（daemon 假 CLI stdout / backend FakeHub / 前端 mock fetch），真机端到端未自动化 → ⚠️ 已列移交项（与结论移交一致，非静默）
- 断言有效性抽查（3.5）：①daemon v2 用例逐字段 toEqual + `JSON.stringify(result)` not.toContain('repoPath'/'E:/PZwangge')——真副作用断言非空断言；②前端夹具 rows 仅 3 行而 chips 断言 20/13/9——数字只能来自信封 totals，钉死单一源（防实现细节耦合）；③回退用例断言旧 testid 在场（行为面非实现面）。达标。

#### 探针 7：验收×测试覆盖矩阵

**task-01**（预填「卡无 acceptance」失实，按卡片 frontmatter 手工改写）
- v2 信封夹具投影逐字段正确 → covered | sillyhub-daemon/tests/sillyspec-file-diff.test.ts（v2 信封全字段用例：cross_repo 透传/anchor_label 短化 a1b2c3d/totals 三态/repos 序保持 toEqual）
- 无 repos 键 → repos:null 且其余投影与现状一致 → covered | 同文件（无 repos 键回退用例 + 既有 3 用例补 cross_repo:null 后逐字段通过）
- 序列化不含 repoPath → covered | 同文件（not.toContain('repoPath') 与 not.toContain('E:/PZwangge') 双断言）

**task-02**（同上手工改写）
- v2 FakeHub 响应 JSON 逐字段正确 → covered | backend/app/modules/change/tests/test_scope_file_diff.py::test_scope_audit_v2_cross_repo_rows_and_repos
- 无 repos 键/非 list → repos==[] 且既有用例全绿 → covered | 同文件::test_scope_audit_v2_repos_fallback_and_invalid_skipped + 既有用例补 repos==[] 断言
- OpenAPI 导出含新字段 → covered | backend/openapi.json 三新 schema + ScopeAuditResponse.repos（gen:types 零漂移佐证）

**task-03**（同上手工改写）
- f85a6650 类三仓卡面主仓段+跨仓段真实三态与锚点档（任务书验收）→ covered | frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx（三仓分组用例：chip-main 20/2 + 214151b、sub-grid-security 13/1 + a1b2c3d、spdemo 9/1 + 语义锚 —）
- 单仓/无 repos/quick 渲染与现状等价 → covered | 同文件（回退用例：旧 testid scope-audit-chip-planned 在场/无仓段/note 不渲染/旧形态跨仓行归主仓平铺；quick 回退由既有 2 quick 用例钉住）
- degraded 段 ⚠️ 原因无伪三态；null 行数 — → covered | 同文件（degraded 用例三 chips 均 null query + spdemo +—/−—）
- api-types 含 cross_repo/repos 零漂移 → covered | frontend/src/lib/api-types.ts（grep 命中 + gen:types 重跑 md5 一致）

#### 探针 4：决策追踪覆盖
- D-001@v1 → FR-01/02 → task-01：投影白名单无 repoPath + 测试双断言 ✅ 闭环
- D-002@v1 → FR-03~06 → task-02/03：回退用例（daemon null/backend []/前端现状渲染）+ 零新增门禁错误码 ✅ 闭环
- D-003@v1 → FR-04/05 → task-03：分组渲染用例（段/chips 单一源/明细分桶/note）✅ 闭环
- D-005@v1 → 全任务：三任务全链落地即方案 A ✅ 闭环
- D-004@v2 → task-01（短化三分支）+ task-03（语义锚 — 显示）✅ 闭环
- 无 P0/P1 unresolved；D-004@v1 为 superseded（见决策追踪矩阵状态列），无下游引用（design/卡片均已引 @v2）

#### 探针 5：API Contract Parity
- ✅ parity check passed（scope: change-diff 9 files @ worktree，前端 diff 内 0 新调用——本变更是既有 getScopeAudit 的响应消费扩展，符合预期）
- ⚠️ 418 unused 为多根并集口径噪音（主仓 614 ∪ worktree 614 ∪ artifact 1228 的全仓端点 × 本变更局部 diff），非本变更 contract gap——无新增端点、无新增前端调用面。

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除；38 行删除全为前端明细行内联→DetailRow 等价搬移（execute 独立验收核实，回退测试断言旧 testid 佐证 DOM 等价）

#### 探针 8：载荷字段契约对账（advisory）
- 不适用
#### 探针 9：守卫一致性（advisory）
- 不适用
#### 探针 10：预填注清零（error 门）
- ✅ 预填注清零
#### 探针 11：红线一致性（advisory）
- 不适用

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]
（CLI 首轮预填「无接口面」为声明行未识别的中间态；表格加入后 gate 解析出 1 端点，行已对齐解析口径。）
| 端点 | 判定 | 用例依据 | 结果 | 证据 |
|---|---|---|---|---|
| GET /api/workspaces/{workspace_id}/sillyspec/scope-audit | covered-service | design接口表#GET /api/workspaces/{workspace_id}/sillyspec/scope-audit | PASS | backend/app/modules/change/tests/test_scope_file_diff.py（scope-audit 端点 v2 透传/回退用例）+ frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx（消费面分组/回退用例） |
↳ 前端: 对账卡消费（getScopeAudit 既有调用，响应扩展零新调用面）

## 测试结果 [层：确定性检查——CLI 实测对账]
- cd sillyhub-daemon && pnpm typecheck → 0 错（零输出）
- cd sillyhub-daemon && pnpm vitest run tests/sillyspec-file-diff.test.ts → 16/16 passed
- cd backend && uv run pytest -q app/modules/change/tests/test_scope_file_diff.py → 11 passed（既有 9 + 新增 2）
- cd backend && uv run ruff check <三文件> → All checks passed；mypy → no issues found in 2 source files
- cd frontend && pnpm exec tsc --noEmit → 0 错
- cd frontend && pnpm vitest run <卡片+mobile+quicklog 三文件> → 33/33 passed（主卡 11 = 旧 7 + 新 4；mobile 15；quicklog 7）
- gen:types 重跑 md5 前后一致（零漂移）
- 无 known_failures 豁免项。全量测试未跑（CLAUDE.md 规则 0，留 CI）。

## 决策追踪矩阵 [层：人工判断]

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01、FR-02 | task-01 | 投影白名单封闭无 repoPath；sillyspec-file-diff.test.ts 双断言 | 已闭环 |
| D-002@v1 | FR-03、FR-04、FR-05、FR-06 | task-02、task-03 | 回退三层用例 + 零新增门禁错误码（diff 核实无新 AppError/能力门） | 已闭环 |
| D-003@v1 | FR-04、FR-05、FR-06 | task-03 | 分组渲染四新用例（段/chips 单一源/分桶/note） | 已闭环 |
| D-005@v1 | FR-04、FR-05、FR-06 | task-03 | 三任务全链 = 方案 A 落地（本报告任务完成度） | 已闭环 |
| D-004@v2 | FR-01、FR-02、FR-04、FR-05、FR-06 | task-01、task-03 | daemon 短化三分支测试（hash/语义锚 null/degraded）+ 前端语义锚 — 显示 | 已闭环 |
| D-004@v1 | ⚠️ 未映射 | ⚠️ 未闭环（无 task 回指） | superseded by D-004@v2（2026-09-20 Grill S2 缺口修正），无下游引用 | superseded（不参与覆盖） |

## 技术债务 [层：人工判断]

探针 1 零 TODO/FIXME 命中；本变更未引入新债务标记。存量观察（非本变更引入）：verify-probes 接口段解析器对「本变更接口面：N 端点」声明与含路径表格均未识别（三次重试失实预填），按 agent 复核协议手工兜底——建议工具侧后续核对 parseDesignApiTable 收表条件。

## 变更风险等级 [层：人工判断]

contract-required：跨三层契约 additive 扩展，全链由夹具级自动化契约测试锁定（daemon 信封夹具/backend FakeHub/前端组件测试）；跨进程真机面（真 CLI v2 输出）移交人工验收。非 integration/deployment-critical（零新增端点、零部署面变化）。

## Runtime Evidence [层：人工判断]

不涉及启动/部署/数据库面（纯既有查询链路响应扩展）。关键证据链：worktree 分支 sillyspec/2026-09-20-scope-audit-cross-repo-platform 9 文件 +1603/−38（git diff 实测）；三层测试输出见「测试结果」节；execute 阶段独立验收 review.json（.sillyspec/.runtime/stage-reviews/execute-review-2026-09-20-203014/）。失败模式排除：旧 CLI 无 repos 键 → daemon null → backend [] → 前端现状渲染（三层各有专测）；非法 repos 条目跳过不炸（backend 用例）；行数 null 不出伪数据（前端 — 显示用例）。

## 代码审查 [层：人工判断]

走查清单：
- ① 编辑/更新链路：不涉及（无编辑表单/回显面）
- ② 非主分支流：回退三态（无 repos/空数组/quick）均有专测——主路径外的分支已覆盖
- ③ 守卫一致性：零新增端点/权限面，不适用
- ④ 载荷字段契约：五层字段链（CLI camel → daemon snake → backend 同键 → OpenAPI → 前端）抽样锚点/标签/计数三字段逐层核对一致（execute 独立验收第 3 条）
- ⑤ 分页/并发/事务：不涉及（只读查询链路）
总体评价：实现收敛、边界防御完整（isRecord/isinstance 守卫 + 非法跳过 + 回退三态）、测试断言钉在真实输出。execute 阶段独立验收 7/7 pass（详见独立复核节）。

## 独立复核（可选回流槽） [层：人工判断——复核后追加]

execute 阶段独立验收子代理（agent-tool 通道，2026-09-20）结论回流：verdict=pass（specVerdict/qualityVerdict 均 pass），checklist 7/7——任务书验收闭环（三仓段 testid+主仓 20/2+跨仓真实三态与锚点档断言）/硬约束全过（D-001 双断言、additive、主仓行不变、D-004@v2 三分支）/五层字段链一致/测试质量（单一源钉死、零删断言）/边界干净（无越权、无杂物）。非阻断观察 3 条：backend 夹具 anchor_label 用文案形态（透传层语义成立）；分组 chips 三态键 null 显示 0（design 仅要求行数 null → —，合理缺省）；api-types LF/CRLF warning 为仓库既有环境提示。无 P1/P2 缺陷。
