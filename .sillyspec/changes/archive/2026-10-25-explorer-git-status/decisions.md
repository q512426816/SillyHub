---
author: qinyi
created_at: 2026-10-25 19:51:00
generated_by: sillyspec-fourpiece-init
change: 2026-10-25-explorer-git-status
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: 修改文件集合视图入口放在 Git 日志页
- type: scope
- priority: P1
- status: confirmed
- source: user
- question: 「修改文件集合」视图放在哪里（explorer 页内切换/独立标签页/Git 日志页）？
- answer: 用户拍板——放进现有「Git 日志」页（/workspaces/[id]/git-log），不新增独立标签页、不嵌 explorer 页
- normalized_requirement: 修改文件集合树与文件级 diff 入口挂载在 Git 日志页内；explorer 页不新增修改集合视图入口
- impacts: [FR-02, task-W3-04, verify-页面归属]
- 锚点: frontend/src/app/(dashboard)/workspaces/[id]/git-log/page.tsx:190
- 模块域: frontend
- evidence: frontend/src/app/(dashboard)/workspaces/[id]/git-log/page.tsx:183（页面装配：PageHeader + GitStatusBar + 工具栏 + CommitList + CommitDetailDrawer）
- 故障面: Git 日志页内容变长，需选好折叠形态避免把提交列表挤到首屏之外
- 退役判据: 若修改集合使用频率远高于提交历史，再评估独立 tab

## D-002@v1: 新功能采用 IDEA 颜色语义，现有文件变更卡不动
- type: consistency
- priority: P1
- status: confirmed
- source: user
- question: 新功能的 IDEA 语义（新增绿/修改蓝/忽略灰）与现有会话「文件变更卡」FILE_STATUS_META（修改=灰/新文件=蓝）冲突，怎么处理？
- answer: 用户选「只新功能用 IDEA 语义」——现有文件变更卡颜色不在本变更范围
- normalized_requirement: 本变更新增的着色/徽标一律用 IDEA 语义（新增绿、修改蓝、忽略灰、删除红）；frontend/src/components/daemon/file-changes/file-changes-card.tsx 的 FILE_STATUS_META 不改动
- impacts: [FR-01, FR-02, task-W3-02, task-W4-01]
- 锚点: frontend/src/components/prototype/explorer-git-status-view.tsx:24
- 模块域: frontend
- evidence: frontend/src/components/daemon/file-changes/file-changes-card.tsx:125（现有 FILE_STATUS_META 定义，保持不动）
- 故障面: 平台内两套状态色并存，用户可能困惑——文档与图例需标明
- 退役判据: 后续全局统一颜色语义时另立变更收敛两套映射

## D-003@v1: 忽略条目按顶层聚合展示，不递归展开
- type: architecture
- priority: P1
- status: accepted
- source: code
- question: 忽略文件（ignored）如何采集与展示，node_modules 等海量目录怎么处理？
- answer: 我的判断：daemon 采集忽略条目时按目录聚合（git ls-files --others --ignored --exclude-standard --directory 形态，忽略目录只出一行）；树上一行「忽略目录名」整体标灰，不递归列出内部文件
- normalized_requirement: 忽略状态集合规模与忽略文件总数无关（顶层聚合口径）；explorer 树与修改集合视图中忽略目录整体标灰可折叠
- impacts: [FR-01, task-daemon采集, task-着色映射]
- evidence: sillyhub-daemon/src/host-fs-handler.ts:1642（现有 gitStatus 采集链路，porcelain v2；ignored 目前未采集，需新增 --directory 口径）
- 故障面: 用户想看忽略目录内部具体文件时需借助现有 explorer 树（忽略目录仍可展开浏览，只是不着色逐文件）
- 退役判据: 实测存在必须逐文件标忽略色的场景时再评估递归口径

## D-004@v1: diff 基线一律 HEAD，不区分暂存区；untracked/已删除特例展示
- type: definition
- priority: P1
- status: accepted
- source: code
- question: 文件 diff 的基线版本取什么？已暂存（staged）与未暂存是否区分？untracked 与已删除文件怎么展示？
- answer: 我的判断：一律与 HEAD（最近一次提交）比，不拆「更改/已暂存更改」两组（平台 agent 场景不走暂存流程，YAGNI）；untracked 文件 diff 展示整文件为新增（全绿）；已删除文件保留在修改集合清单（红色删除线），diff 展示整文件删除（全红）
- normalized_requirement: 修改集合与文件 diff 均为「工作区 vs HEAD」单口径；无 staged/unstaged 分组；untracked→全文新增、deleted→全文删除
- impacts: [FR-02, FR-03, task-daemon-diff, task-清单分组]
- evidence: sillyhub-daemon/src/host-fs-handler.ts:1567（现有 gitDiffFile 为 git show <sha> 形态，工作区 vs HEAD 需新增 git diff HEAD 口径）
- 故障面: 用户本地手动 stage 后清单不体现暂存态，可能误判「还有未暂存改动」
- 退役判据: 平台引入暂存区工作流（如平台内提交功能）时重议口径

## D-005@v1: explorer 树着色不改点击行为，diff 入口仅修改集合视图
- type: boundary
- priority: P2
- status: accepted
- source: docs
- question: explorer「文件」页树上着色后，点击着色文件是否改为打开 diff？
- answer: 我的判断（按用户原话字面）：explorer 树点击行为维持现状（右侧内容预览）；「点击看 diff」仅是修改文件集合视图的交互。explorer 树只加状态着色
- normalized_requirement: explorer 树节点点击仍打开文件预览；文件级 diff 仅从修改集合视图触发
- impacts: [FR-01, task-着色映射]
- evidence: frontend/src/components/explorer/file-explorer.tsx:489（现有 onSelect → 右侧 FilePreview 装配链路，不改动交互语义）
- 故障面: 用户若预期「树上点文件直接看 diff」会与实现不符——design 图例中写明
- 退役判据: 用户反馈想从 explorer 树直达 diff 时，加辅助入口（如右键菜单/图标按钮）

## D-006@v1: 状态采集沿用 git_log 既有三层链路，daemon 新增两个平名能力
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: 文件级 git 状态与工作区 vs HEAD diff 的采集链路怎么建？
- answer: 我的判断：沿用 git_log 模块既有「backend(GitLogService 绑定解析) → ws_hub.send_rpc → daemon execFile git」链路与安全守卫；daemon 侧新增两个平名 RPC 能力——①文件级状态清单（porcelain v2 文件行 + ignored --directory 聚合行 + numstat 增删行数）②工作区单文件 vs HEAD diff（git diff HEAD --unified=3 --no-color -- <path>，untracked 用 no-index 形态或标记位由前端渲染全文新增）。backend 暴露两个新只读端点（WORKSPACE_READ 门控）
- normalized_requirement: 不新建采集通道、不引入 GitPython/JGit；新端点权限与现有 git-log 端点一致（WORKSPACE_READ）；daemon git 调用走既有 execFile argv 数组与路径/sha 校验守卫
- impacts: [FR-01, FR-02, FR-03, task-daemon采集, task-daemon-diff, task-backend端点]
- evidence: backend/app/modules/git_log/service.py:464（GitLogService 绑定解析与 RPC 骨架）；sillyhub-daemon/src/host-fs-handler.ts:537（runCmd execFile 封装与白名单守卫）
- 故障面: daemon 旧版本无新平名能力 → backend 需按未知方法映射为 422「daemon 版本过旧」降级（对齐现有 git-log 降级形态）
- 退役判据: 若后续 daemon 与 backend 合并部署形态变化，再评估链路简化

## D-007@v1: 方案 A——平行状态接口 + 前端 join（选定）
- type: architecture
- priority: P0
- status: confirmed
- source: user
- question: 文件级 git 状态与工作区 vs HEAD diff 的实现方案（A 平行状态接口前端 join / B explorer 契约内嵌 / C 实时推送）？
- answer: 用户选定方案 A——daemon 新增「改动文件清单」（porcelain v2 文件行 + ignored --directory 聚合 + numstat）与「工作区单文件 vs HEAD diff」两个平名 RPC，backend 暴露两个只读端点；前端一次拉清单建 path→status 映射，explorer 树着色与 Git 日志页修改集合同源消费
- normalized_requirement: 着色、修改集合、行数徽标共用同一状态清单接口；explorer 现有契约零改动；不引入实时推送通道
- impacts: [FR-01, FR-02, FR-03, task-W1-01, task-W2-02, task-W3-01, task-W4-01]
- 锚点: sillyhub-daemon/src/daemon.ts:7803
- 模块域: backend, frontend, sillyhub-daemon
- evidence: 用户方案选择轮（AskUserQuestion「方案 A：平行状态接口」）；同向先例 knowledge/decisions/backend.md:55（2026-08-26-workspace-git-status「复用 git_log 模块与 host-fs 平名通道」）
- 故障面: 状态清单为拉取式快照，daemon 侧文件变动后页面不自动变色——需手动刷新或重新进页
- 退役判据: 出现「多端同改工作区需秒级感知」的真实场景时重议推送（见 D-009）

## D-008@v1: 落选——方案 B（explorer 契约内嵌状态字段）— rejected
- type: architecture
- priority: P1
- status: rejected
- source: user
- question: 同 D-007
- answer: 落选
- normalized_requirement: explorer 目录接口不加 git 状态字段
- impacts: [FR-01]
- evidence: 方案选择轮（AskUserQuestion）
- 否决理由: 懒加载树逐层列目录导致重复采集（每层一次 git status）；逐目录语义拼不出全量修改清单，Git 日志页修改集合另开接口形成两处数据源，一致性无保障；ExplorerEntry DTO 变更牵动 gen:types 双份义务
- 复潮条件: explorer 树改为一次性全量返回（无逐层懒加载）且修改集合需求取消时，可重议内嵌口径

## D-009@v1: 落选——方案 C（daemon watch + 实时推送）— rejected
- type: architecture
- priority: P1
- status: rejected
- source: user
- question: 同 D-007
- answer: 落选
- normalized_requirement: 不新增 fs watcher 与状态推送通道；状态新鲜度由「手动刷新 + 进页拉取」保障
- impacts: [FR-01, FR-02]
- evidence: 方案选择轮（AskUserQuestion）
- 否决理由: 大仓库 fs 监听开销大且 Windows 文件监听坑多；需新增推送通道与连接状态机；当前场景刷新按钮 + react-query 失效机制已覆盖，YAGNI 严重超范围
- 复潮条件: 出现多端同改工作区需秒级感知的真实场景（如多人协作审阅同一工作区）时重议

## D-010@v1: untracked diff 采集用局部 execFile 读退出码（exit 0/1 均成功）
- type: architecture
- priority: P1
- status: accepted
- source: design-grill
- question: `git diff --no-index` 有差异时 exit=1（隐含 --exit-code 语义），而 runCmd 对任何非零 exit 一律 ok:false 且 ExecResult 不暴露退出码——untracked diff 分支如何拿到「有差异=成功」语义？
- answer: 我的判断：untracked 分支不走 runCmd 的 ok 通道，用局部 execFile（对齐 runGitFetch 先例 sillyhub-daemon/src/host-fs-handler.ts:1661）直接读退出码——exit 0/1 均视为成功（1=有差异，常态），≥2 或 killed 才 error；stderr 的 CRLF warning 行不进 error 文案。备选「改 ExecResult 暴露退出码」影响公共件全调用面，不取
- normalized_requirement: git_worktree_diff 的 untracked 分支以退出码 0/1 为成功判据，仅在 exit≥2 或进程被杀时走 error 通道；FR-03「untracked 全绿」在有差异常态下可兑现
- impacts: [FR-03, task-W1-02, verify-untracked-diff]
- evidence: Design Grill 首轮 review.json P1-1（git 2.45.1 Windows 实证 exit=1；runCmd 形态 host-fs-handler.ts:570-584）
- 故障面: git 未安装/版本极旧时 no-index 旗标行为差异——退化为 error 通道，前端按 diff 拉取失败降级，不致错数据
- 退役判据: ExecResult 未来暴露退出码后，可回归统一 runCmd 通道

## D-011@v1: porcelain v2 解析契约——末段 rejoin、u 条目按 modified、祖先蓝点不含 ignored
- type: definition
- priority: P1
- status: accepted
- source: design-grill
- question: porcelain v2 行的真实分段结构、unmerged（冲突）条目归类、「含改动的祖先目录」口径未闭合——如何定义？
- answer: 我的判断：① `1` 条目前段字段以单空格分隔、path 以制表符与前段分隔（git 官方契约）——按行内首个 `\t` 切出 path（含空格安全；path 含 `\t`/换行时 git 自动 C-quote 包裹）；② `u`（unmerged，合并冲突）条目按 modified 归类（四态不扩冲突态，YAGNI，测试用例覆盖）；③ explorer 祖先目录蓝点口径=子树内存在 added/modified/deleted/untracked 任一，ignored 不算改动
- normalized_requirement: daemon 解析按「行内首个制表符切出 path、前段单空格分字段」；u 条目 → modified；蓝点判定集合不含 ignored 状态文件
- impacts: [FR-01, FR-02, task-W1-01, task-W1-03, task-W4-01]
- evidence: Design Grill 首轮 review.json P2-①④（porcelain v2 9 段格式实证）
- 故障面: 冲突文件显示为「修改」蓝而非专门冲突标识——平台场景罕见，图例不提示；用户在别处解决冲突后状态自然消失
- 退役判据: 平台出现高频合并冲突场景时增补第五态「冲突」

## D-003@v2: 忽略条目按顶层聚合展示，不递归展开（措辞精度修订）
- type: architecture
- priority: P1
- status: accepted
- supersedes: D-003@v1
- source: design-grill
- question: 同 D-003@v1；Grill P2-② 指出 v1 的「与忽略文件总数无关」措辞过强
- answer: 结论不变（顶层聚合）；normalized_requirement 措辞收敛为「与忽略目录内部文件数无关（--directory 只聚合目录），散落的忽略单文件仍逐条、规模与其线性相关」
- normalized_requirement: 忽略采集规模与忽略目录内部文件数无关；散落忽略单文件逐条透出；explorer 树与修改集合视图中忽略目录整体标灰可折叠
- impacts: [FR-01, task-W1-01, task-W4-01]
- evidence: Design Grill 首轮 review.json P2-②；sillyhub-daemon/src/host-fs-handler.ts:1642（既有 gitStatus 链路）
- 故障面: 同 D-003@v1
- 退役判据: 同 D-003@v1

## D-012@v1: porcelain v2 path 分隔按现实双形态解析（空格为主、\t 兼容）

- **歧义**：design §Phase 1 写「`1` 条目……按行内首个 `\t` 切出 path」，但 2026-10-25 本机实证（git 2.45.1.windows.1，临时仓库含空格/中文路径 + `-z` 对照）`1`/`u` 条目字段区与 path 之间为**单空格**分隔、path 为行尾字段（`\t` 形态实为 `2` rename 条目 path/origPath 间的分隔，设计写作期口径有误）。
- **选择**：解析函数双形态兼容——行内首个 `\t` 且其前恰为 fieldCount 个空格 token 时按 `\t` 切（覆盖设计所述形态与未来 git 变更）；否则按单空格 split 后第 fieldCount token 起整体 rejoin（本机现实形态，path 含空格安全）。两形态均有单测锚定（DF2/DF3）。
- **理由**：接口契约（path 字符串、空格/中文安全）不变，仅解析机制按现实修正；单形态硬编码（任一）都会在另一形态下丢路径首段。
- **影响 task**：task-01（host-fs-handler.ts parsePorcelainChangedLine + 单测 DF2/DF3）。

## D-013@v1: 既有注册器测试 GL30 方法集断言 5→7（plan 漏标 related_tests 的就地修复）

- **歧义**：tests/host-fs-handler-git-log.test.ts GL30 断言「注册且仅注册五个平名方法」（封闭集合）；本变更在同一注册器追加第 6/7 个平名方法必然破坏该断言，而 task-01 卡 allowed_paths 未含该测试文件（plan-review P2-① 只核对了前端三卡的 related_tests，daemon 侧漏标）。
- **选择**：GL30 期望集更新为七方法（新增 git_dirty_files/git_worktree_diff 两行），测试意图（平名、无 host_fs. 前缀、封闭集合防意外注册）原样保留；新测试文件 RG1 不重复断言全集、指向 GL30。
- **理由**：与 plan 对 task-05/06/07 related_tests 的处理先例同构（改既有测试文件使断言与新事实对齐，非删断言凑绿）；不更新则全局验收标准 3「既有相关测试不破」无法成立。
- **影响 task**：task-01（tests/host-fs-handler-git-log.test.ts 一处 it 块）。

## D-014@v1: 并行变更遗留红测试的就地对齐（turn-timeline 断言恢复）
- type: process
- priority: P1
- status: accepted
- source: code
- question: execute 收口时主仓 frontend 全量套件发现 turn-timeline 测试红（断言的内联展开行为已被并行变更删除）——本变更收口提交如何处置？
- answer: 我的判断：该红由并行变更 subagent-card-unify-panel 已提交主仓但漏更新对应测试所致，非本变更文件；为恢复提交门可用，在收口提交 0f3bf815a 中顺带对齐断言（20/20 绿），commit message 留痕
- normalized_requirement: 并行变更遗留红按「顺手对齐恢复门 + 提交留痕」处置，不静默 reset/绕过
- impacts: [verify-提交门, task-07 收尾对账]
- evidence: 提交 0f3bf815a（commit message 注明）；verify 遗留项 3 原文「D-014 缺 decisions.md 条目（内容仅存于提交信息）」——本条即补记
- 故障面: 顺手修复与变更主体混于同一提交，追溯需读 commit message
- 退役判据: 无（一次性修复留痕）
