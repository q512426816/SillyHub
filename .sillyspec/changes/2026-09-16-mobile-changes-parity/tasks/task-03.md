---
id: task-03
title: 'mobile-changes-list-reparse-entry'
title_zh: '移动列表页重新扫描——工具栏按钮 + stats/warnings 反馈 + 失效 ["changes", wid] 前缀'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 21:19:19
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-003@v1]
related_tests:
  - frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx
allowed_paths:
  - frontend/src/app/m/workspaces/[id]/changes/page.tsx
target_files:
  - frontend/src/app/m/workspaces/[id]/changes/page.tsx
goal: >
  移动列表页（active/archive 分支）补「重新扫描」入口：工具栏搜索行右侧按钮，
  逻辑照抄桌面 handleReparse（frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx:406-423），
  成功显示 stats 反馈条与 warnings 警告卡并失效 ["changes", workspaceId] 前缀，
  补齐 FR-01 列表页缺口（D-003@v1 清单项 1）。
implementation:
  - import 补 reparseChanges 与 ChangeReparseStats/ChangeWarning 类型（@/lib/changes :20-27/:206，只读引用不改该文件）
  - 新增 state：reparsing / pageError / stats / warnings（对齐桌面 :246/:254-256 同名同语义）
  - 实现 handleReparse：setReparsing(true) → reparseChanges(workspaceId) → setStats(resp.stats) / setWarnings(resp.warnings ?? []) → await queryClient.invalidateQueries({ queryKey=["changes", workspaceId] })；catch 取 ApiError.message 兜底「重新解析失败」；finally setReparsing(false)（流程与桌面 :406-423 一致）
  - 工具栏搜索行（active/archive 分支 :845-922，搜索/筛选入口之后）加「↻ 重新扫描」按钮：min-h-[44px] 热区，reparsing 时 disabled 并显示「解析中…」（按钮文案对齐桌面 :688-695）
  - stats 非空时渲染成功反馈条（rounded-[var(--radius-md)] border 移动化范式），warnings.length > 0 时其下追加警告卡（[code] change_key: detail 列表），文案与桌面 :701-720 逐字一致
  - reparse 失败以 role="alert" 中文红条呈现（对齐本页 listError 样式 :924-931），不白屏
acceptance:
  - 点击「重新扫描」触发 reparseChanges(workspaceId)，请求期间按钮 disabled 显示「解析中…」
  - 成功后显示「已重新扫描：解析 N，新增 N · 更新 N · 删除 N。」反馈条，有警告时追加「 N 个警告。」，文案与桌面逐字一致
  - warnings 非空时反馈条下渲染警告卡列表（[code] change_key: detail，change_key 缺失显示 —）
  - 成功后失效 ["changes", workspaceId] 前缀（移动分页各页 query 与桌面共享该前缀自动重取；不含 changesTabTotals）
  - 失败时页面显示中文错误（ApiError.message，兜底「重新解析失败」），不白屏
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- "src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx"
constraints:
  - stats/warnings 反馈文案与桌面 (dashboard) 页 :701-720 逐字一致，不改字不加字
  - 失效前缀仅 ["changes", workspaceId]，不含 changesTabTotals（对齐桌面 reparse 既有语义，tab 计数不随 reparse 刷新）
  - 移动样式：按钮与反馈区 44px 触摸热区、rounded-[var(--radius-md)] border 卡片化；不引入桌面 PageHeader/SectionCard/antd Button
  - frontend/src/lib/changes.ts 仅只读引用（reparseChanges :206），不修改；桌面页不修改
  - 本 task 不新增/不修改测试用例（测试补齐与既有断言修复统一归 task-08）；related_tests 仅登记页面行为变化可能影响的既有断言文件，测试路径不进 allowed_paths
  - 不动本页既有 query key 形态与其它功能区（排序/URL 参数/quicklog 筛选归 task-04/05）
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
