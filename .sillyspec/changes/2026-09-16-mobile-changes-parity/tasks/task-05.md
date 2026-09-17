---
id: task-05
title: 'mobile-changes-list-quicklog-filter-drawer'
title_zh: '移动列表页 quicklog 筛选抽屉（状态 4 态/作者聚合/空壳占位开关，query key 真值化）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 21:19:19
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-003@v1]
related_tests:
  - frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx
allowed_paths:
  - frontend/src/app/m/workspaces/[id]/changes/page.tsx
target_files:
  - frontend/src/app/m/workspaces/[id]/changes/page.tsx
goal: >
  移动列表页 quicklog tab 搜索行挂 MobileFilterDrawer：状态 4 态 chips /
  作者 chips（items 聚合去重）/ 显示空壳占位开关；quicklog query key 的
  status/author/showPlaceholder 槽位（:523-535 固定默认值）升为 state 真值，
  补齐 FR-04 列表页缺口（D-003@v1 清单项 5）。
implementation:
  - 新增 quicklog 筛选 state：qlStatus / qlAuthor / showPlaceholder（默认 "" / "" / true）+ 抽屉草稿态（打开时拷贝生效值、确定落生效），沿用本页既有筛选抽屉草稿范式（:589-601）
  - quicklog query（:523-549）key 的 status/author/showPlaceholder 槽位从固定默认值升为 state 真值；queryFn 参数联动（status=qlStatus || undefined（QuicklogStatus）、author=qlAuthor || undefined、include_placeholder=showPlaceholder || undefined，传参形态对齐桌面 QuicklogTable :174-182）
  - quicklog tab 搜索行（:790-809）搜索按钮旁挂 MobileFilterDrawer（独立开关 state，不与主列表抽屉共用），children 三段
  - 状态 chips：全部状态（""）/ 已完成（completed）/ 进行中（in_progress）/ 已暂存（partial_done）/ 疑似中断（stale），值与文案对齐桌面 STATUS_OPTIONS（frontend/src/components/changes/quicklog-table.tsx:31-37）
  - 作者 chips：由页面既有 quicklogItems 聚合去重（owner_name || author_name || author_raw → Boolean 过滤 → Set 去重，照抄桌面 :197-203 口径，零新增请求）
  - 「显示空壳占位」开关（role=switch，默认开，语义对齐桌面 Checkbox ql-20260818-008：取消勾选=收窄筛选）
  - 抽屉「重置」：搜索词/状态/作者/占位全部回默认（占位回 true，草稿与生效态一并清）
acceptance:
  - 选择状态=疑似中断并确定后，quicklog query key 槽位 status="stale"，请求带 status 参数
  - 作者 chips 选项来自当前 quicklog 列表响应 items，按 owner_name→author_name→author_raw 去重聚合，口径与桌面 frontend/src/components/changes/quicklog-table.tsx:197-203 一致
  - 关闭「显示空壳占位」并确定后 include_placeholder 收窄（false 时请求不带占位条目）
  - 抽屉「重置」后搜索词/状态/作者/占位全部回默认（占位回 true）
  - 未筛选时 quicklog query key 与改造前逐字相同（status="" / author="" / showPlaceholder=true 槽位值不变）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- "src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx"
constraints:
  - 作者聚合口径照抄桌面 frontend/src/components/changes/quicklog-table.tsx:197-203（owner_name→author_name→author_raw 兜底链 + Boolean 过滤 + Set 去重），不另造口径（R-05）；数据源为页面既有 quicklogItems，零新增请求
  - R-03：query key 槽位结构与桌面 QuicklogTable :168-173 同构（["quicklogEntries", ws, { search/status/author/showPlaceholder/page/pageSize }]），默认值不漂移，默认参数下与旧 key 深度相等不产生额外请求
  - 状态选项 4 态值与文案对齐桌面 STATUS_OPTIONS；本页既有 QL_STATUS_META 映射不改
  - chips/开关 44px 触摸热区、沿用抽屉内既有 chip 范式与 focusMine 开关范式；不引入 antd Select/Checkbox
  - 仅改 m/workspaces/[id]/changes/page.tsx；quicklog-table.tsx 只读参照不修改
  - 本 task 不新增/不修改测试用例（query key 同构断言与用例补齐归 task-08）；related_tests 仅登记既有断言文件，测试路径不进 allowed_paths
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
