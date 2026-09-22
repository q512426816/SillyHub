---
id: task-09
title: '前端「移动到…」弹窗 + 筛选禁拖保护 + 列表页接线'
title_zh: '前端「移动到…」弹窗 + 筛选禁拖保护 + 列表页接线'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 14:04:23
priority: P0
depends_on: ['task-08']
blocks: []
requirement_ids: [FR-06, FR-07]
decision_ids: [D-005@v2, D-009@v2]
expects_from:
  task-08:
    - contract: WorkspaceDragGrid
      needs: [WorkspaceDragGrid]
  task-07:
    - contract: moveWorkspace
      needs: [moveWorkspace, WORKSPACE_PAGE_SIZE]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/page.tsx
  - NEW:frontend/src/components/workspace-move-dialog.tsx
target_files:
  - frontend/src/app/(dashboard)/workspaces/page.tsx
  - NEW:frontend/src/components/workspace-move-dialog.tsx
goal: >
  WorkspacesPage 接入 task-08 的 WorkspaceDragGrid 完成拖拽排序前端收口
  （FR-06/FR-07）：新增「移动到…」弹窗（antd Modal+Select，目标页+页首/
  页尾，方向锚点规则）与筛选禁拖保护（手柄禁用态+筛选条提示+投放带与
  移动入口同步禁用），本地 PAGE_SIZE=12 换 task-07 的 WORKSPACE_PAGE_SIZE
  单源常量。
implementation:
  - '①接线（page.tsx）：删本地 const PAGE_SIZE = 12（frontend/src/app/(dashboard)/workspaces/page.tsx:44），改用 task-07 导出的 WORKSPACE_PAGE_SIZE，reload 的 limit/offset（:111-112）与分页器 disabled 判断（:386）同步换用；items.map 卡片网格区（:342-367）换 <WorkspaceDragGrid>（task-08 产物）渲染，原样透传 linkedProjects/boundDaemon/daemonStatus/onChanged/onEditAlias/onActivate 等 props，另传当前 page/total 与移动回调——moveWorkspace 成功后按响应 rank=floor(rank/WORKSPACE_PAGE_SIZE) 换算目标页 setPage 自动翻页 + reload（落位高亮由网格内实现）'
  - '②筛选禁拖派生（page.tsx，D-005@v2）：filtersActive = q(debouncedQuery，与 reload 同源) 非空 || typeFilter !== null（含 unclassified）|| statusFilter !== "active" || (isPlatformAdmin && ownerUserId !== null)；include_deleted=true 管理员删除视图同判（当前页未单独暴露该参量时随 status 筛选覆盖，预留同一判定分支）。filtersActive 传入网格禁用：手柄禁用态（可见灰显 + cursor-not-allowed，不隐藏）、投放带不出现、「移动到…」入口禁用；同时筛选条内渲染提示「筛选状态下不可拖拽排序」（对照原型 .drag-disabled-tip）'
  - '③NEW frontend/src/components/workspace-move-dialog.tsx：「移动到…」弹窗独立组件（antd Modal + Select 受控），props 约 {open, workspace, currentPage, totalPages, disabled, onConfirm, onCancel}；目标页 Select 选项 1..N（N=ceil(total/WORKSPACE_PAGE_SIZE)，按默认视图分页，默认选中当前页），位置 Select「页首/页尾」；标题与选项文案中文（对照原型 §移动到…弹窗）'
  - '④弹窗提交流程（page.tsx，FR-06/D-009@v2）：确认后先 listWorkspaces({status:"active", limit:WORKSPACE_PAGE_SIZE, offset:目标页*WORKSPACE_PAGE_SIZE}) 拉取目标页默认视图数据（不带任何筛选参数），锚点按方向规则取——页首：向上（目标页<当前页）before_id=目标页第一张 / 向下 after_id=目标页第一张；页尾对偶：向上 before_id=目标页最后一张 / 向下 after_id=目标页最后一张；目标页=当前页时页首走 before_id、页尾走 after_id；锚点 id === 被移动卡 id 时跳过请求（不发 move，自锚服务端 422 兜底）；正常提交 moveWorkspace 后 reload，失败 useNotify 中文报错'
  - '⑤「移动到…」入口接线：经 WorkspaceDragGrid 暴露的卡片菜单/手柄区挂点打开弹窗（具体 prop 形态以 task-08 组件契约为准），filtersActive 时入口同步禁用（D-005@v2）'
acceptance:
  - '默认视图（无筛选）：网格可拖拽；弹窗选目标页+页首/页尾提交 move，锚点方向四象限（页首向上 before/向下 after=目标页第一张；页尾对偶到最后一张；同页页首 before/页尾 after）与 design Wave 2-4 一致'
  - '弹窗确认先以 {status:"active", limit:WORKSPACE_PAGE_SIZE, offset:目标页*WORKSPACE_PAGE_SIZE} 拉取目标页（无筛选参数）再算锚点；锚点=被移动卡自身时跳过请求、零 moveWorkspace 调用'
  - '筛选任一激活（q/type/unclassified/status≠active/user_id/include_deleted）：手柄可见灰显 cursor-not-allowed、筛选条显示「筛选状态下不可拖拽排序」、投放带不出现、「移动到…」入口禁用、不发出任何 moveWorkspace 请求（FR-07）'
  - 'page.tsx 本地 PAGE_SIZE 引用清零，全部换 WORKSPACE_PAGE_SIZE（单源常量，风险 R-08 同源耦合）；reload 四路筛选与 limit/offset 分页行为不变（FR-03 兼容）'
  - '既有 page.test.tsx 回归全绿（listWorkspaces 参数、空态/别名/徽标/整卡点击行为不回归）；pnpm exec tsc --noEmit 0 错误'
verify:
  - 'cd frontend && pnpm exec tsc --noEmit'
  - 'cd frontend && pnpm test -- page.test（既有列表页回归，不跑全量）'
constraints:
  - '禁跑全量测试（CLAUDE.md 规则 0）只跑上列相关测试；新增测试用例一律归 task-10，本卡不写新测试'
  - '弹窗为独立新文件 NEW:frontend/src/components/workspace-move-dialog.tsx；design 文件清单亦允许并入 workspace-drag-grid.tsx，若并入属 task-08 文件域——本卡按独立文件执行，不改 workspace-drag-grid.tsx 与 workspace-card.tsx'
  - '弹窗 UI 与文案全部中文（antd Modal+Select，对照 prototype-workspace-drag-sort.html）'
  - '样式遵守主题系统（FRONTEND_PAGE_STYLE §0.5）：brand-* 语义阶/主题 token，不硬编码 hex；禁用态灰显走 muted 语义色 + cursor-not-allowed'
  - '不改四路筛选/reload/分页器既有行为；WorkspaceCard 其余 props 透传不断线；错误路径 useNotify 中文提示不静默吞错'
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
