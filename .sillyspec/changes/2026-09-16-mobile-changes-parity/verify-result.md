# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。

## 结论 [层：人工判断]

结论枚举：PASS WITH NOTES —— 8/8 任务完成，FR-01~FR-07 全部有测试承接（5 文件 115 用例全绿 + 桌面 36 回归），tsc 0 错误 eslint 0 error；notes 为 3 条非阻断遗留（真机冒烟移交人工验收、3 条新增 lint warning、2 处已记录的微小桌面差异）。

## 移交项（结构化） [层：人工判断——CLI 清单核验]

| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| manual-acceptance | 390px 真机/浏览器视觉冒烟（R-01 残余） | 手机访问 /m/workspaces/<id>/changes 与 /m/workspaces/<id>/changes/<cid>：确认三卡（最后信号/执行用量/范围对账）与增强卡片无横向溢出。结构性证据已备（ScopeAuditCommandCard 桌面即渲染于 320px 固定侧栏，窄于 390px） |
| manual-acceptance | 原型对照走查 | 打开 .sillyspec/changes/2026-09-16-mobile-changes-parity/prototype-mobile-changes-parity.html 七屏与真机对照，确认交互形态符合预期 |
| other | 筛选按钮激活点（dot）未实现 | task-05 裁定：需改 mobile-filter-drawer.tsx（超出本变更 allowed_paths）且非验收项；后续变更给 MobileFilterDrawer 加 active prop |
| other | 3 条新增 eslint warning 清理 | mobile-change-detail.tsx:215（stage 未用）、m/changes/__tests__/page.test.tsx:465/565（q 未用）——改 _ 前缀即可，顺手变更处理 |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]

无

## 集成验证回执 [层：自述声明——CLI 一致性校验]

无（非 integration-critical：纯前端展示层，无跨服务/部署面）

## 任务完成度 [层：人工判断]

8/8 全部完成（tasks.md checkbox 由 CLI 按 review.json verdict 勾选，逐任务均有 pass review + 源码抽查）：
- task-01 ✅ 3 行 export diff，桌面 36 测试零回归
- task-02 ✅ 卡片 24 用例（含新增 11）
- task-03 ✅ 重新扫描（成功/警告/失败/防重入 4 用例）
- task-04 ✅ 排序+URL（4 用例 + R-03 同构）
- task-05 ✅ quicklog 筛选（4 用例）
- task-06 ✅ 三卡+联动（15 用例）
- task-07 ✅ 删除入口（12 用例）
- task-08 ✅ 汇总（列表页 15→27 用例）

## 设计一致性 [层：人工判断]

与 design.md 一致，两处已记录的微小偏差（均在 review 注释留痕）：
1. task-04：抽屉「重置」将排序一并回默认（桌面 handleResetClick 不动排序——因桌面排序是表头态不在筛选面板；移动排序 chip 在抽屉内随「抽屉维度全回默认」语义），裁定已写入头注释。
2. task-03：未复制桌面「reparse 错误横幅随 changesQuery.dataUpdatedAt 收敛」effect（任务卡 implementation 未列、非验收项；移动端失败红条留存至下次点击清除）。
3. task-04 mock 接线突破（page.test.tsx 补 useSearchParams mock 导出一行，零断言改动）——commit 1b5c71b4 同款先例，属测试接线非源码越权。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ glob 项未展开（agent 手动展开扫描）：frontend/src/app/m/workspaces/[id]/changes/page.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx、frontend/src/app/m/workspaces/[id]/changes/[cid]/page.tsx、frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx、frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx

#### 探针 2：设计关键词覆盖
全部命中（worktree grep 实测文件数）：reparseChanges=4、ChangeActivityBadge=2、formatDurationZh=2、useSearchParams=2、MobileFilterDrawer=4、lastSignalFromSteps=1、ScopeAuditCommandCard=2、DeleteChangeConfirm=3、focusStage=1——design 总体方案 8 点的关键能力词全部落地。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（frontend/src/app/(dashboard)/workspaces/[id]/changes）找到 3 个测试文件（frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx）
- ✅ task-02: 模块目录（frontend/src/components/mobile）找到 7 个测试文件（frontend/src/components/mobile/mobile-card-list.test.tsx、frontend/src/components/mobile/mobile-change-card.test.tsx、frontend/src/components/mobile/mobile-change-detail.test.tsx、frontend/src/components/mobile/mobile-session-list.test.tsx、frontend/src/components/mobile/mobile-tab-bar.test.tsx …）
- ✅ task-03: 模块目录（frontend/src/app/m/workspaces/[id]/changes）找到 3 个测试文件（frontend/src/app/m/workspaces/[id]/changes/[cid]/sessions/__tests__/page.m-sessions-fallback.test.tsx、frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx、frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx）
- ✅ task-04: 模块目录（frontend/src/app/m/workspaces/[id]/changes）找到 3 个测试文件（frontend/src/app/m/workspaces/[id]/changes/[cid]/sessions/__tests__/page.m-sessions-fallback.test.tsx、frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx、frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx）
- ✅ task-05: 模块目录（frontend/src/app/m/workspaces/[id]/changes）找到 3 个测试文件（frontend/src/app/m/workspaces/[id]/changes/[cid]/sessions/__tests__/page.m-sessions-fallback.test.tsx、frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx、frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx）
- ✅ task-06: 模块目录（frontend/src/components/mobile）找到 7 个测试文件（frontend/src/components/mobile/mobile-card-list.test.tsx、frontend/src/components/mobile/mobile-change-card.test.tsx、frontend/src/components/mobile/mobile-change-detail.test.tsx、frontend/src/components/mobile/mobile-session-list.test.tsx、frontend/src/components/mobile/mobile-tab-bar.test.tsx …）
- ✅ task-07: 模块目录（frontend/src/app/m/workspaces/[id]/changes/[cid]、frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__）找到 2 个测试文件（frontend/src/app/m/workspaces/[id]/changes/[cid]/sessions/__tests__/page.m-sessions-fallback.test.tsx、frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx）
- ✅ task-08: 模块目录（frontend/src/components/mobile、frontend/src/app/m/workspaces/[id]/changes/__tests__、frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__、frontend/src/app/m/workspaces/[id]/changes、frontend/src/app/m/workspaces/[id]/changes/[cid]）找到 10 个测试文件（frontend/src/components/mobile/mobile-card-list.test.tsx、frontend/src/components/mobile/mobile-change-card.test.tsx、frontend/src/components/mobile/mobile-change-detail.test.tsx、frontend/src/components/mobile/mobile-session-list.test.tsx、frontend/src/components/mobile/mobile-tab-bar.test.tsx …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 三个 helper 可从 @/app/(dashboard)/workspaces/[id]/changes/page import 且 tsc 零错误 | `frontend/src/components/mobile/mobile-change-card.test.tsx` | — | covered | mobile-change-card.tsx 编译期 import 三个 helper（tsc 0 错误即证）；行为经 mobile-change-card.test.tsx:52-67 用量行断言（1.2M tok · 156 次 · 3.6 小时）间接覆盖 |
| 桌面列表页行为零变化（既有 __tests__/page.test.tsx 全绿，无渲染回归） | `frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx` | — | covered | `frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx` 实跑 36/36 passed（主代理复跑，2026-09-16 22:33） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| FR-02 逐条满足：负责人三态 / 影响组件空省略 / usage null「—」/ undefined 整行不渲染 / 进行中 pill / ChangeActivityBadge 挂载 | `frontend/src/components/mobile/mobile-change-card.test.tsx` | null | covered | mobile-change-card.test.tsx 新增 11 用例：负责人三态 describe、usage 两档判空、进行中 pill 出现/缺席、影响组件 join/空省略；停滞第三态由 task-08 补（:52 起「停滞 · 最后信号 45 分钟前」逐字断言） |
| MobileChangeCard props 签名不变（change/onClick），整卡仍单一 button 且触摸热区 ≥44px；tsc 零错误 | `frontend/src/components/mobile/mobile-change-card.test.tsx` | MobileChangeCard、change、onClick | covered | `frontend/src/components/mobile/mobile-change-card.test.tsx` 24/24 全绿（props 冒烟 + 信息行用例）；git diff 证 props 接口块零改动；tsc --noEmit exit 0 |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 点击「重新扫描」触发 reparseChanges(workspaceId)，请求期间按钮 disabled 显示「解析中…」 | `frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx` | — | covered | page.test.tsx:719（成功流断言 reparseChanges("ws-1")）、:796（防重入 disabled + 「解析中…」） |
| 成功后显示反馈条文案逐字一致 + 警告卡 | 同上 | — | covered | page.test.tsx:719 用例 toBe 逐字断言「已重新扫描：解析 3，新增 1 · 更新 1 · 删除 1。 2 个警告。」+ 警告卡 [code] change_key: detail |
| 成功后失效 ["changes", workspaceId] 前缀（不含 changesTabTotals） | 同上 | — | covered | page.test.tsx:719 用例 invalidateSpy 断言前缀 |
| 失败时中文错误不白屏 | 同上 | — | covered | page.test.tsx:767（ApiError.message 红条 + 非 ApiError 兜底「重新解析失败」+ 列表仍在） |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 抽屉切换排序确定后 sortDir 进 key 与请求，pagesLoaded 回 1 | `frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx` | — | covered | page.test.tsx:810（「↑ 最早优先」→ sort=updated_at_asc 进请求与 key；:318 主列表 key 全参槽位断言含 sort） |
| URL ?tab= 白名单（合法值生效/非法回 active） | 同上 | — | covered | page.test.tsx:836（?tab=quicklog 初始 tab + 不发主列表请求）、:863（非法值回 active） |
| URL ?search= 词初始化双 state | 同上 | — | covered | page.test.tsx:877（输入框 toHaveValue + 请求与 key 带 search） |
| 默认参数与改造前逐字相同（R-03） | 同上 | — | covered | page.test.tsx:895（R-03 专用用例：主列表/quicklog 默认 key 槽位与桌面逐字一致 + 请求参数精确形态） |
| 抽屉「重置」后排序回默认 | 同上 | — | covered | page.test.tsx:371（主列表筛选抽屉重置用例扩展含排序回默认断言；:810 默认 chip aria-pressed） |

**task-05**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 状态=疑似中断确定 → key/请求 status="stale" | `frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx` | — | covered | page.test.tsx:926 |
| 作者聚合口径与桌面 :197-203 一致 | 同上 | — | covered | page.test.tsx:950（五 fixture：owner_name 重复去重/author_name/author_raw/全空过滤，候选恰 4 chips + 选张三进请求与 key） |
| 占位开关关闭 → include_placeholder 收窄 | 同上 | — | covered | page.test.tsx:1021（key showPlaceholder=false + 请求不带占位参数） |
| 重置回默认（占位 true） | 同上 | — | covered | page.test.tsx:1049（复合筛选态重置：状态/作者清空、占位回 true、搜索词一并清空、请求回默认形态） |
| 未筛选时 key 与改造前逐字相同 | 同上 | — | covered | page.test.tsx:895 R-03 用例 quicklog 半段（status:""/author:""/showPlaceholder:true + include_placeholder: true 精确形态） |

**task-06**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 三卡挂载顺序 + 无信号不渲染（FR-05） | `frontend/src/components/mobile/mobile-change-detail.test.tsx` | data、testid | covered | mobile-change-detail.test.tsx 三卡测试（挂载+DOM 顺序+props 接线；无 completed_at 与 steps 缺失两分支不渲染） |
| 阶段节点点击筛选 + 清除 chip + 再点取消（FR-06） | 同上 | 点击、steps | covered | `frontend/src/components/mobile/mobile-change-detail.test.tsx:706`（联动：节点点击→筛选+清除 chip+aria-pressed）、`:741`（再点同节点/点 chip 两路径取消恢复全量） |
| 无步骤阶段不可点 / 非线性 stage 步骤条缺席 | 同上 | steps、current_stage | covered | `frontend/src/components/mobile/mobile-change-detail.test.tsx:771`（无步骤阶段非 button 断言）；既有 quick 降级用例（步骤条整体不渲染联动缺席） |
| 三卡 import 复用无第二份实现（D-005） | 同上 | import、复用 | covered | git diff 实证三组件源零改动 + mobile-change-detail.tsx:69-77 import 行 |
| tsc 通过 + 既有测试全绿 | 同上 | — | covered | `frontend/src/components/mobile/mobile-change-detail.test.tsx` 15/15 全绿 + tsc --noEmit exit 0（主代理复跑，2026-09-16 22:33） |

**task-07**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 三判门控出现/无权限不出现，其余动作不受影响（FR-07） | `frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx` | owner | covered | page.m-change-detail.test.tsx 三判循环用例（管理员/owner 本人/工作区所有者，data-action-key="delete-change" + danger 样式 + 其余动作在）+ 无权限用例 |
| change=null 加载态不出现 | 同上 | change、null | covered | page.m-change-detail.test.tsx 加载态用例 |
| 确认流：弹层 → deleteChange 成功 → toast + 前缀失效 + 跳回列表 | 同上 | — | covered | page.m-change-detail.test.tsx 成功流用例（末段防呆、失效先于跳转的顺序哨兵、push 回移动列表）——预填 partial 系机械零命中，实测用例存在，改判 covered |
| 失败流：403 中文 toast 留页不白屏 | 同上 | 失败、ApiError | covered | page.m-change-detail.test.tsx 失败流用例 |
| tsc + 既有全绿 | 同上 | exec | covered | `frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx` 12/12 全绿 + tsc --noEmit exit 0（主代理复跑） |

**task-08**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 三文件新增用例覆盖 FR-01~FR-07 全部 GWT 且全绿 | 三测试文件 | 全部 | covered | `frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx`:719-1073 新增 12 用例（FR-01×3/FR-03×4/FR-04×4/R-03×1）；`frontend/src/components/mobile/mobile-change-card.test.tsx` +停滞态用例；详情两文件 task-06/07 已覆盖——5 文件合跑 115/115 |
| R-03 断言（默认 key 同构） | `frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx` | 断言、query、key | covered | page.test.tsx:895 专用用例 + :318 既有全参槽位 |
| mock 补字段不改手写 | 三测试文件 | mock | covered | `frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx` mock 段（next/navigation useSearchParams 可变槽位 + @/lib/changes 补 reparseChanges，零断言弱化）；ApiError 走 `frontend/src/lib/api.ts` 真实类 |
| tsc 0 错误 | 三测试文件 | frontend、exec | covered | `frontend/src/components/mobile/mobile-change-card.test.tsx` 全绿隐含编译通过 + 主代理复跑 tsc --noEmit exit 0（worktree frontend，2026-09-16 22:33） |

- ⚠️ 零/半自动化承接条目复核：预填 uncovered 的 task-03/04/05 行经实测用例存在全部改判 covered（见上表证据列锚点）；task-01 两行以编译期 import + 桌面回归实证 covered。

#### 探针 4：决策追踪覆盖
见下方「决策追踪矩阵」——5 决策全闭环。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 0 frontend calls 变更（纯前端展示层复用既有端点）
- ℹ️ 624 个端点未调用为全仓既有状态（与本变更无关）

#### 探针 6：代码删除对账
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/2026-09-07-docs-check-fix-improvement-proposal.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/daemon-spawn-node-hang.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/quick-sync-block-filenotes-and-quicklog-mixed-commit.md`（git 状态 D）
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定
- agent 判定：上述 3 个 D 为**主仓工作区并行会话的删除**（本变更全程未触碰 docs/sillyspec，git status 会话开始即不含本变更操作），不判本变更 FAIL；建议用户在并行会话收口时处理。

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（无后端载荷面）

## 测试结果 [层：确定性检查——CLI 实测对账]

- 命令：`./node_modules/.bin/vitest run <5 个相关测试文件>`（worktree frontend，2026-09-16 22:33）：**115 passed (115)**——m/changes 列表 27、mobile-change-card 25、mobile-change-detail 15、[cid] 详情 12、桌面 changes 36（export 零回归）
- 命令：`./node_modules/.bin/tsc --noEmit`：exit 0
- 命令：`./node_modules/.bin/eslint <9 个改动文件>`：0 error / 6 warning（3 条主仓既有基线 + 3 条新增：mobile-change-detail.tsx:215 stage、page.test.tsx:465/565 q——均未用参数类，已列移交项）
- 未跑全量测试（CLAUDE.md 规则 0：全量留 CI）
- **verify lint 门（advisory 审计）**：CLI 快照实测 lint 链退出码 2，失败点=快照内 daemon `tsc --noEmit` 报 `Cannot find module './build-id.js'`——`src/build-id.ts` 为 postinstall 生成产物（package.json:21-22 gen-build-id.mjs，.gitignore:6 忽略），快照/worktree 不跑 postinstall 必缺，与本变更无关（本变更 0 个 daemon 文件）。**主仓全链对照实测全绿（2026-09-16 22:4x）**：backend ruff check 0 / ruff format --check 0 / mypy app 0（Success: no issues found in 953 files）、frontend pnpm lint 0、daemon pnpm typecheck 0。工具缺陷已记录 docs/sillyspec/verify-lint-gate-daemon-build-id-missing.md（CLAUDE.md 规则 15）。

## 决策追踪矩阵（如存在 decisions.md） [层：人工判断]
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | 全部（范围界定） | task-01~08 | 全部改动落在两页 + 4 组件 + 3 测试文件（git diff 9 文件与清单一致，无 /m/ 新路由、无后端文件） | 已闭环 |
| D-002@v1 | （非目标约束） | — | git diff 无任务域文件；引导条保留（mobile-change-detail.tsx m-change-desktop-guide 未删） | 已闭环（约束类，无任务回指为预期） |
| D-003@v1 | FR-01~04 | task-01~05 | 列表五项全部落地（探针 7 covered + 探针 2 关键词命中） | 已闭环 |
| D-004@v1 | FR-05~07 | task-06/07/08 | 详情五项全部落地（三卡/联动/删除，测试承接见探针 7） | 已闭环 |
| D-005@v1 | 全部（路线约束） | task-01/02/06/07 | 三卡/徽标/权限组件/数据函数 git diff 零改动（纯 import）；仅 helper export 3 行 | 已闭环 |

## 技术债务 [层：人工判断]
- 探针 1 零 TODO/FIXME 命中；新增 3 条 eslint unused-arg warning（见移交项）；既有 3 条 warning 非本变更引入。

## 变更风险等级 [层：人工判断]
unit-sufficient——纯前端展示层（无 schema/API/状态机/部署面）；测试矩阵 115 用例 + 桌面回归覆盖。design.md 无 risk_level 显式声明。真机视觉验收（manual-acceptance）已列移交项兜底 R-01。

## Runtime Evidence [层：人工判断]
不涉及（无运行时组件改动：不起服务、无端点/日志/生命周期断言面；前端组件行为由 jsdom 测试矩阵证明）。

## 代码审查 [层：人工判断]
主代理逐任务审查（execute 阶段 8 份 review.json）+ verify 集成抽查：
① 无编辑/更新链路（本变更是展示层补齐，无表单更新面）；quicklog 筛选的「草稿→确定」链路经 4 用例覆盖（应用/重置/占位/聚合）。
② 非主分支流：usage undefined/null 两档、change=null 加载态、无权限、403 失败、quick 非线性 stage——均有专属用例。
③ 守卫一致性：删除入口与桌面同款 canDeleteChange 三判 + 后端权限权威（403 toast），与桌面 delete-change-confirm 实件共享判定逻辑，无第二份权限实现。
④ 载荷契约：无后端载荷变更（探针 8 不适用）。
⑤ 分页/并发：加载更多与轮询保持既有机制（query key 默认值同构经 R-03 用例锁定）；三串行任务集成后 27 用例全绿证明无相互覆盖。
总体：无 P1/P2 缺陷；3 条 lint warning 与 2 处已记录微小差异列移交项。

## 独立复核（可选回流槽） [层：人工判断——复核后追加]
无（变更规模 light + 全部任务有 execute 阶段主代理逐任务 review；如需二次深度复核可另派独立子代理）。
