---
id: task-10
title: '前端测试 __tests__/workspace-drag-grid.test.tsx + page 测试增补'
title_zh: '前端测试 __tests__/workspace-drag-grid.test.tsx + page 测试增补'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 14:04:23
priority: P0
depends_on: ['task-08', 'task-09']
blocks: []
requirement_ids: [FR-04, FR-05, FR-06, FR-07, FR-08]
decision_ids: [D-014@v1]
allowed_paths:
  - NEW:frontend/src/components/__tests__/workspace-drag-grid.test.tsx
  - frontend/src/app/(dashboard)/workspaces/__tests__/page.test.tsx
  - frontend/src/components/__tests__/workspace-card.test.tsx
target_files:
  - NEW:frontend/src/components/__tests__/workspace-drag-grid.test.tsx
  - frontend/src/app/(dashboard)/workspaces/__tests__/page.test.tsx
  - frontend/src/components/__tests__/workspace-card.test.tsx
goal: >
  为拖拽排序前端全链路（task-08 网格 + task-09 弹窗/接线）补测试：
  新建 workspace-drag-grid.test.tsx 覆盖投放带显隐边界/落带 to 参数/
  页内 after_id/rank 换算翻页高亮/弹窗方向锚点/自锚跳过/筛选禁拖，
  增补 page.test.tsx 接线与分页数量不变量断言（D-014@v1），
  workspace-card.test.tsx 补挂点默认不渲染回归。
implementation:
  - '①NEW frontend/src/components/__tests__/workspace-drag-grid.test.tsx：vitest + @testing-library/react（jsdom），对照 page.test.tsx 既有风格（vi.hoisted mock + importActual 部分替换 + mkWorkspace fixture）；mock @/lib/workspaces 的 moveWorkspace/listWorkspaces，clearMocks（beforeEach）每测清调用计数——「零调用」断言依赖；dnd-kit 交互模拟按网格实现的可测面选择（PointerSensor 事件序列或受控回调直调，以 task-08 实现为准）'
  - '②投放带显隐边界（FR-05）：第 1 页（page=0）拖起无上带；末页（(page+1)*WORKSPACE_PAGE_SIZE>=total）拖起无下带；筛选态拖起不出现任何投放带'
  - '③落带提交（FR-05/D-012）：下带断言 moveWorkspace(id, {to:"next_page_head", page_size:WORKSPACE_PAGE_SIZE})、上带断言 moveWorkspace(id, {to:"prev_page_tail", page_size:WORKSPACE_PAGE_SIZE})——to 枚举与 page_size 携带逐字段断言'
  - '④页内拖放（FR-04）：drop 落位断言 moveWorkspace(id, {after_id:落位前邻卡 id})；乐观更新 + 失败回滚（mock reject 后断言 reload 恢复原序）'
  - '⑤rank 换算与高亮（FR-05/R-07）：mock moveWorkspace resolve {rank} 后断言翻页到 floor(rank/WORKSPACE_PAGE_SIZE) 页且目标卡高亮态渲染（1.6s 高亮用 vi.useFakeTimers 推进断言出现与消退）'
  - '⑥弹窗方向锚点（FR-06/D-009@v2）：选目标页+页首/页尾后断言——向上页首 before_id=目标页第一张、向下页首 after_id=目标页第一张、页尾对偶到最后一张、同页页首 before/页尾 after；提交前先 listWorkspaces({status:"active", limit:WORKSPACE_PAGE_SIZE, offset:目标页*WORKSPACE_PAGE_SIZE}) 拉目标页；锚点=被移动卡自身时 moveWorkspace 零调用（自锚跳过）'
  - '⑦筛选禁拖（FR-07/D-005@v2）：filtersActive 时断言手柄禁用（disabled/aria-disabled + cursor-not-allowed 类名）、筛选条出现提示「筛选状态下不可拖拽排序」、「移动到…」入口禁用、moveWorkspace 零调用'
  - '⑧page.test.tsx 增补（接线与不变量）：mock WorkspaceDragGrid/workspace-move-dialog 为 stub 后断言 filtersActive 正确透传（默认视图 false/任一筛选激活 true）与「移动到…」打开弹窗流程；分页数量不变量前端侧（D-014@v1）：move 成功触发 reload 后 listWorkspaces 仍以 limit=WORKSPACE_PAGE_SIZE(12) 调用、total 不变、页内渲染条数恒 WORKSPACE_PAGE_SIZE（末页允许不满）'
  - '⑨workspace-card.test.tsx 增补回归：不传拖拽挂点 props 时手柄/挂点不渲染（挂点默认不渲染保持他处兼容，design 文件变更清单）'
acceptance:
  - '投放带三态边界断言齐并通过：第 1 页无上带/末页无下带/筛选态不出现'
  - '落带 to 参数与 page_size、页内 after_id=前邻卡逐字段断言通过'
  - 'rank 换算页码与 1.6s 高亮（fake timers）断言通过'
  - '弹窗方向锚点四象限+同页规则+自锚零调用断言通过'
  - '筛选态禁拖四联动断言通过（手柄禁用+提示+入口禁用+零 move 调用）'
  - '分页数量不变量前端侧断言通过：move 后 reload 每页仍 WORKSPACE_PAGE_SIZE(12)、total 不变、无重复渲染'
  - 'workspace-card 挂点默认不渲染回归通过；三个测试文件全绿 + pnpm exec tsc --noEmit 0 错误'
verify:
  - 'cd frontend && pnpm test -- workspace-drag-grid page.test workspace-card'
  - 'cd frontend && pnpm exec tsc --noEmit'
constraints:
  - '禁跑全量测试（CLAUDE.md 规则 0）——只跑上列三个相关测试文件，全量留给 CI'
  - 'vitest + @testing-library/react，jsdom 环境；moveWorkspace/listWorkspaces 全 mock 不发真实请求；clearMocks 每测清调用计数（「零调用」断言依赖）'
  - '测试红时禁改断言迁就实现（CLAUDE.md 规则 9）——先核对被测实现（task-08/09 文件域），实现有误时跨文件域修复由主代理协调，不在本卡 allowed_paths 内私改'
  - '本卡只新增/增补测试文件，不改任何被测实现与生产代码'
  - '时间敏感断言（1.6s 高亮/防抖）用 vi.useFakeTimers，不引入真实等待拖慢测试'
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
