---
id: task-02
title: 'Workspace collector (porcelain v2 + dual numstat + ahead commit details + payload capacity truncation R-03)'
title_zh: '工作区采集器（porcelain v2 + numstat 双口径 + ahead 提交明细 + payload 容量截断 R-03）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-07 00:39:35
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-012, D-014, D-015]
provides:
  - contract: collectGitApprovalPayload
    fields: [intent, cwd, sessionId]
  - contract: GitApprovalPayload
    fields: [operation, command, worktree, branch, message, remoteTarget, runner, protectedBranch, aheadCommits, files, defaultSelected]
expects_from:
  - task-01 的 GitCommandIntent 与 resolveDefaultSelection（defaultSelected 预填来源）
allowed_paths:
  - sillyhub-daemon/src/interactive/git-approval-collector.ts
  - sillyhub-daemon/tests/interactive/git-approval-collector.test.ts
target_files:
  - NEW:sillyhub-daemon/src/interactive/git-approval-collector.ts
  - NEW:sillyhub-daemon/tests/interactive/git-approval-collector.test.ts
goal: >
  新建独立采集模块 sillyhub-daemon/src/interactive/git-approval-collector.ts：对命中工作区跑 git status --porcelain=v2 --branch + numstat 双口径 + push 态 ahead 提交明细（≤20 条、每条含文件明细）采集，组装 GitApprovalPayload 数据面（含 resolveDefaultSelection 预填）并按 R-03 容量截断（files>500 仅统计、每提交 files>50 截断、ahead>20 显统计）——为 task-03/04 挂载分支提供 payload 组装，容量实测绑本任务验收（FR-02/FR-03，R-03/R-07）。
implementation:
  - 新建采集模块，执行形态参照 turn-file-changes.ts 先例（sillyhub-daemon/src/interactive/turn-file-changes.ts:229 可注入 execFile；:108 GIT_BASE_ARGS 恒带 --no-optional-locks 与 core.quotePath=false；spawn 数组形参不经 shell）
  - 采集命令面：git status --porcelain=v2 --branch（1 条目 path 分隔符是空格不是 \t——R-07 实证坑）+ git diff --numstat 与 git diff --cached --numstat 双口径（未暂存/已暂存增删行数）；push 态加 git log @{u}..HEAD -n 20 --name-status --numstat 一次采集（每条 sha/subject/author/date + 该提交文件明细 path/status/增删行数，D-014/D-015）
  - 组装 GitApprovalPayload 数据面（design 接口定义）：operation/command/worktree/branch/message/remoteTarget/runner/protectedBranch（push 目标为 main/master 时 true，D-006 警示数据）/aheadCommits[]/files[]{path,status,staged,addLines,delLines}/defaultSelected（调 task-01 resolveDefaultSelection 产出，D-012）；renamed 条目取 new 路径归 renamed 状态（R-07）
  - R-03 容量截断：工作区 files>500 → 不逐文件仅传统计（总数+截断标记，卡片提示去 git-log 页看全量）；aheadCommits 每提交 files>50 → 截断为统计行；ahead>20 → 超出显统计行（D-014）
  - R-03 容量实测（plan 总表绑本任务验收）：只读查证 backend session_dialog_requests payload 列容量与 SSE publish_session_event 载荷截断阈值（backend 不改码），构造 500 文件×numstat fixture 实测 JSON.stringify(payload) 字节数确认截断档位不超限，结论留痕回写 design R-03 行
  - 单测 mock 可注入 execFile（先例 tests/interactive/turn-file-changes.test.ts）：porcelain v2 空格分隔与 staged 归属、中文与含空格路径 fixture（R-07）、numstat 双口径合并、rename 取 new 路径、ahead 明细解析、截断三档、defaultSelected 接线
acceptance:
  - porcelain v2 行按空格分隔解析出 path 与 staged 归属；中文与含空格路径 fixture 通过（R-07）
  - numstat 双口径正确——staged 文件取 --cached 口径、未暂存取工作区口径
  - push 态 aheadCommits ≤20 条且每条含 sha/subject/author/date/files 明细；rename 条目取 new 路径标 renamed（D-014/D-015）
  - 截断三档生效（files>500 仅统计 / 每提交 files>50 截断 / ahead>20 显统计，R-03）
  - defaultSelected 由 resolveDefaultSelection(intent, status) 产出（D-012 四分支接线 task-01）
  - 容量实测留痕——截断后 payload 序列化字节数不超过查证所得 payload 列/SSE 载荷限制（R-03 验收绑定）
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/git-approval-collector.test.ts 全绿
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/git-approval-collector.test.ts
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 只读采集：git 子进程一律 spawn 数组形参不经 shell，恒带 --no-optional-locks（不拿 index.lock，不与用户/并行会话互锁——turn-file-changes.ts:108 先例）
  - porcelain v2 path 按空格分隔实证坑解析（禁按 \t 切列）；rename 条目取 new 路径（R-07）
  - GitApprovalPayload 结构按 design 接口定义冻结（W2 executor/W4 卡片同构局部 interface 消费），截断统计字段以可判别语义命名，不私改字段名
  - daemon ESM import 带 .js；backend 侧零改动（容量查证只读）；规则 0 禁全量测试，仅跑本模块测试
  - payload 组装消费 task-01 的导出（Wave 1 内按任务序 01→02 先行落地；plan 总表正式依赖边维持空，执行顺序由 Wave 内任务序保证）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
