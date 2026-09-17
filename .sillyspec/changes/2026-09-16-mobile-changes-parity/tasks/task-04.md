---
id: task-04
title: 'mobile-changes-list-sort-and-url-params'
title_zh: '移动列表页排序切换（筛选抽屉 chips）+ ?tab=/?search= URL 参数初始化'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 21:19:19
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-003@v1]
related_tests:
  - frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx
allowed_paths:
  - frontend/src/app/m/workspaces/[id]/changes/page.tsx
target_files:
  - frontend/src/app/m/workspaces/[id]/changes/page.tsx
goal: >
  移动列表页补排序切换与 URL 参数初始化：sortDir 从常量 DEFAULT_SORT（:104-106）
  升为 state 进主列表 query key sort 槽位（与桌面 key 同构），MobileFilterDrawer
  加「排序（更新时间）」chip 组；useSearchParams 读 ?tab=/?search= 初始化，
  补齐 FR-03 列表页缺口（D-003@v1 清单项 3/4）。
implementation:
  - sortDir state 化：新增 useState<SortDir>(DEFAULT_SORT)（默认值仍取既有常量，对齐桌面 :243 默认 updated_at_desc）
  - pageQueryKey（:430-444）的 sort 槽位与 queryFn listChanges（:458-466）的 sort 参数从 DEFAULT_SORT 常量改为 sortDir state 真值
  - 筛选抽屉（active/archive 分支 MobileFilterDrawer children）加「排序（更新时间）」chip 组：↓ 最近优先（updated_at_desc）/ ↑ 最早优先（updated_at_asc）；draftSort 草稿态，打开抽屉时拷贝生效值、确定落生效（沿用既有 draftStage 草稿范式 :589-601）
  - handleFilterReset 扩展：sortDir/draftSort 一并回 DEFAULT_SORT（抽屉内筛选维度全部回默认）
  - URL 参数初始化：useSearchParams 读 ?tab=（仅 quicklog/archive 合法，非法/缺失回 active）与 ?search=（?? "" 兜底，同时初始化 searchInput 与 search），对齐桌面 :230-239
  - pagesLoaded 回 1 的 useEffect 依赖数组（:567-569）补 sortDir
acceptance:
  - 抽屉切换排序（↓ 最近优先 / ↑ 最早优先）并确定后，sortDir 生效进 pageQueryKey 与 listChanges 请求参数，列表按新方向重取且 pagesLoaded 回 1
  - URL 含 ?tab=quicklog 或 ?tab=archive 时初始 tab 为该值；非法值或缺失回 active
  - URL 含 ?search=词 时初始搜索词同步到输入框（searchInput）与已提交 state（search）
  - 未操作筛选且 URL 无参数时，主列表 query key 与请求参数与改造前逐字相同（sort 槽位仍为 "updated_at_desc"）
  - 抽屉「重置」后排序回默认 ↓ 最近优先
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- "src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx"
constraints:
  - R-03：默认参数下主列表 query key 与桌面 (dashboard) 页 :265-277 key 同构（sort 槽位默认值 "updated_at_desc" 与原 DEFAULT_SORT 常量值相等、槽位顺序不变），不破坏桌面/移动共享缓存
  - URL 白名单对齐桌面 :236：tab 仅 quicklog/archive 合法，其余回 active；search 空缺用 "" 兜底（?? ""，对齐桌面 :234）
  - 排序 chip 沿用抽屉内既有 stage chips 范式（min-h-[38px] 圆角 chip + aria-pressed + data-testid），不引入 antd Select；无桌面表头点击切换（toggleSort :399-404）形态，移动排序入口仅在抽屉
  - 仅改 m/workspaces/[id]/changes/page.tsx；桌面页与共享组件不修改
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
