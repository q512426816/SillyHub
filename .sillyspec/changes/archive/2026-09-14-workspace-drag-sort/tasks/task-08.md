---
id: task-08
title: '前端拖拽网格组件——WorkspaceDragGrid（手柄/页内拖放乐观更新/边缘投放带 to 提交/rank 翻页高亮）'
title_zh: '前端拖拽网格组件——WorkspaceDragGrid（手柄/页内拖放乐观更新/边缘投放带 to 提交/rank 翻页高亮）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 14:04:23
priority: P0
depends_on: ['task-07']
blocks: []
requirement_ids: [FR-04, FR-05, FR-08]
decision_ids: [D-002@v1, D-003@v2, D-008@v1, D-012@v1, D-014@v1]
expects_from:
  task-07:
    - contract: moveWorkspace
      needs: [moveWorkspace, WORKSPACE_PAGE_SIZE]
provides:
  - contract: WorkspaceDragGrid
    fields: [WorkspaceDragGrid, onMoved]
allowed_paths:
  - frontend/src/components/workspace-drag-grid.tsx
  - frontend/src/components/workspace-card.tsx
target_files:
  - NEW:frontend/src/components/workspace-drag-grid.tsx
  - frontend/src/components/workspace-card.tsx
goal: >
  新建纯组件 WorkspaceDragGrid（@dnd-kit/core DndContext + SortableContext，
  rectSortingStrategy 适配 1/2/3 列响应式网格），组合现有 WorkspaceCard 实现
  FR-04 页内拖放（手柄拖拽、按落位前邻卡提交 after_id、乐观更新失败回滚）与
  FR-05 边缘投放带跨页（拖起滑入上下投放带、to 枚举提交、响应 rank 换算页码
  回调翻页、主题 token 高亮 1.6s）；翻页/刷新经 props 回调（onMoved）上抛，
  由 task-09 在 page.tsx 接线——「移动到…」弹窗与筛选禁拖不属本卡。
implementation:
  - 新建 frontend/src/components/workspace-drag-grid.tsx——DndContext 包裹 SortableContext（rectSortingStrategy，适配 1/2/3 列网格，D-002 分页网格不变），每卡 useSortable 组合现有 WorkspaceCard 渲染（透传其既有 props）
  - workspace-card.tsx 加可选挂点 props（drag handle 注入）——手柄节点与 setNodeRef/attributes/listeners 由父级 useSortable 传入，渲染在卡片左侧悬浮位（对照原型 ⠿ 手柄）；props 缺省时不渲染手柄，他处调用零改动兼容（workspace-card.test.tsx 回归归 task-10）
  - 手柄手势约束——仅手柄承载 drag listeners（PPM 先例 frontend/src/components/ppm-sub-table.tsx:350 最左拖拽手柄列同款），卡体整卡点击进详情（onActivate）不受拖拽影响（风险 R-06）
  - 页内拖放——dragEnd 按落位取前邻卡，一次 moveWorkspace 调用携 after_id=前邻卡 id（落位本页页首无前邻时改携 before_id=本页第一张）；本地乐观重排 items，失败回滚并回调刷新（后写覆盖语义 D-008，不加乐观锁）
  - 边缘投放带——DragStart 时网格上下滑入两条虚线投放带（DndContext 外置 droppable，上下带各自 id，D-003@v2），drop/取消即收起；页面位置经 props 传入——第 1 页不渲染上带、末页不渲染下带
  - 落带提交——下带 drop 调 moveWorkspace 携 to=next_page_head 与 page_size=WORKSPACE_PAGE_SIZE、上带携 to=prev_page_tail 同携 page_size；跨页锚点由服务端解析，客户端不算边界卡（D-012/R-07）
  - 成功闭环——按响应 rank 换算目标页 floor(rank/WORKSPACE_PAGE_SIZE)，经 onMoved 回调上抛（被拖卡 id + 目标页）由父级翻页刷新；被拖卡在新页高亮 1.6s 后自动消失（高亮色走主题 token accent/info，FRONTEND_PAGE_STYLE §0.5，禁硬编码 hex）
  - 纯组件边界——不持路由不拉数据，items/page/total 与刷新/翻页回调全部经 props；move 后不在本地造卡/删卡，跨页表现为源页少一张目标页多一张（D-014 分页数量不变量展示侧）
acceptance:
  - 拖起手柄才滑入投放带，drop/取消即收起；第 1 页无上带、末页无下带（页信息经 props 传入）
  - 页内 drop 恰发一次 moveWorkspace，锚点=落位前邻卡（页首落位为 before_id=本页第一张）；乐观更新失败回滚并回调刷新（FR-04）
  - 上/下带分别提交 to=prev_page_tail/next_page_head 且携 page_size=WORKSPACE_PAGE_SIZE；成功后按响应 rank 回调 onMoved（目标页=floor(rank/WORKSPACE_PAGE_SIZE)），目标卡高亮 1.6s 消失（FR-05）
  - 仅手柄可起拖，卡体点击仍走 onActivate 进详情，两者互不冲突（R-06）
  - workspace-card.tsx 挂点 props 缺省时渲染结果与现状完全一致（默认不渲染手柄，他处调用零改动）
  - move 后经回调刷新重取列表，网格不本地增删卡——每页恒 WORKSPACE_PAGE_SIZE 张（末页允许不满）、无空页/丢卡/双卡（FR-08 展示侧不变量）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint --file src/components/workspace-drag-grid.tsx --file src/components/workspace-card.tsx
constraints:
  - 样式遵守 FRONTEND_PAGE_STYLE §0/§0.5——高亮与投放带配色走主题 token（accent/info 语义）与 brand-* 语义类，禁硬编码 hex；antd 组件色经 ConfigProvider token 不手写
  - 手柄与整卡点击不冲突——仅手柄承载 drag listeners，卡体 onActivate 行为零改动
  - 纯组件边界——翻页/刷新经 props 回调上抛由 task-09 接线 page.tsx；「移动到…」弹窗与筛选禁拖保护（D-005@v2）属 task-09 不在本卡
  - 跨页落位只发 to 枚举由服务端解析（D-012），页码换算只用响应 rank 与 WORKSPACE_PAGE_SIZE（R-07/R-08），不本地推算边界卡
  - 禁跑全量测试（CLAUDE.md 规则 0）；组件测试 workspace-drag-grid.test.tsx 与 workspace-card.test.tsx 回归归 task-10
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
