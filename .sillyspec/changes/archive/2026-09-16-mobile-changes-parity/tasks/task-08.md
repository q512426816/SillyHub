---
id: task-08
title: mobile-changes-parity-tests-and-query-key-parity
title_zh: '测试补齐——列表页/卡片/详情页三组用例 + query key 同构断言'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 21:19:19
priority: P0
depends_on: ['task-02', 'task-03', 'task-04', 'task-05', 'task-06', 'task-07']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07]
decision_ids: [D-003@v1, D-004@v1, D-005@v1]
allowed_paths:
  - frontend/src/components/mobile/mobile-change-card.test.tsx
  - frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx
  - frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx
  - frontend/src/components/mobile/mobile-change-card.tsx
  - frontend/src/app/m/workspaces/[id]/changes/page.tsx
  - frontend/src/app/m/workspaces/[id]/changes/[cid]/page.tsx
  - frontend/src/components/mobile/mobile-change-detail.tsx
target_files:
  - frontend/src/components/mobile/mobile-change-card.test.tsx
  - frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx
  - frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx
goal: >
  按 FR-01~FR-07 的 GWT 补齐移动列表页/卡片/详情页三组测试用例，并加 R-03 默认参数
  query key 同构断言，锁定 task-02~task-07 全部实现的行为契约（design Wave 3）。
implementation:
  - 'frontend/src/components/mobile/mobile-change-card.test.tsx（FR-02 GWT）：负责人三态（owner_name → owner_id 前 8 位 mono → —）；usage 两档判空（null → 「—」、undefined → 整行不渲染）；进行中 pill（started_at 有且 finished_at 缺）；affected_components 空数组省略整段；ChangeActivityBadge 挂载（activity-active/stale/idle 真值表）'
  - 'frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx（FR-01/FR-03/FR-04 GWT）：重新扫描入口成功统计条 + 警告卡（文案与桌面逐字一致）+ ApiError 中文兜底；排序 chip 切换生效进主列表 query key；?tab=/?search= URL 初始化（非法 tab 回 active、输入框与已提交 state 同步）；quicklog 状态/作者/显示空壳占位筛选生效与作者聚合口径（owner_name→author_name→author_raw 去重）'
  - 'frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx（FR-05/FR-06/FR-07 GWT）：三卡挂载与无信号不渲染 change-last-signal；阶段节点点击筛选时间线 + 「阶段名 ✕」清除 chip + 无条目阶段不可点 + 非线性 stage（quick）步骤条整体缺席；删除入口三态门控（有权出现 danger 项/无权不出现/change=null 不出现）+ 确认流成功（失效 ["changes", workspaceId] 前缀 + router.push 回移动列表 + toast）+ 失败中文 toast'
  - 'R-03 key 同构断言：未操作筛选且 URL 无参数时，移动主列表与 quicklog 的请求参数/query key 与桌面逐字同构（sortDir / quicklog status·author·showPlaceholder 槽位默认值深度相等，不产生额外请求）——按 design R-03 的 x-04-query-key-lock 同款断言扩展'
  - 'mock 对齐：被测源新增消费字段（usage / owner_id / step_progress / last_pushed_at / steps 等）在既有 mock 缺失时补齐字段（api-types 生成类型口径），不改回手写；跑三个测试文件与 tsc 验证'
acceptance:
  - '三个测试文件新增用例覆盖 FR-01~FR-07 全部 GWT 分支且全绿'
  - '包含 R-03 断言：默认参数下移动端 query key 与桌面同构、与改造前默认值逐字一致（AC-03 兼容基线）'
  - 'mock 缺字段以补齐字段方式修复（不手写类型）；非测试逻辑有误时不改断言迁就实现'
  - 'cd frontend && pnpm exec tsc --noEmit 0 错误'
verify:
  - 'cd frontend && pnpm exec tsc --noEmit'
  - 'cd frontend && pnpm test -- "src/components/mobile/mobile-change-card.test.tsx" "src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx" "src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx"'
constraints:
  - '仅跑本卡三个测试文件与 tsc，禁止全量测试（CLAUDE.md 规则 0，全量留给 CI）'
  - '用例严格按 FR-01~FR-07 的 GWT 结构写；R-03 默认参数 key 同构断言为必含项'
  - 'mock 缺字段补齐而非改回手写（CLAUDE.md 规则 21 惯例）；发现 task-02~07 实现缺陷时不改测试迁就（规则 9），回报并按对应任务范围修复'
  - '被测源文件（mobile-change-card.tsx / m 两页 page.tsx / mobile-change-detail.tsx）仅允许测试接线所需的最小改动（如 export、fixture 字段对齐），功能行为改动回对应任务'
  - '纯测试聚合任务：不提供契约（provides/expects_from 跳过），实现已由 task-02~task-07 提供并在其合入后执行'
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
