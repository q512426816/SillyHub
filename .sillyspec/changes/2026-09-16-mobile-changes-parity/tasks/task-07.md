---
id: task-07
title: mobile-detail-delete-entry-in-action-menu
title_zh: '移动详情页 ⋯ 菜单删除入口（canDeleteChange 门控 + DeleteChangeConfirm + 成功回列表）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 21:19:19
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-004@v1, D-005@v1]
allowed_paths:
  - frontend/src/app/m/workspaces/[id]/changes/[cid]/page.tsx
  - frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx
related_tests: ['frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx']
target_files:
  - frontend/src/app/m/workspaces/[id]/changes/[cid]/page.tsx
  - frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx
goal: >
  为移动详情页 ⋯ 菜单补齐 danger 删除项（FR-07，D-004@v1）：canDeleteChange 门控可见性 +
  DeleteChangeConfirm 受控确认弹层 + 删除成功后失效 ["changes", workspaceId] 前缀并跳回
  移动列表；确认弹层/权限判定/删除请求全部复用既有实现（D-005@v1）。
implementation:
  - '页面级接线（m/[cid]/page.tsx）：import { DeleteChangeConfirm, canDeleteChange, useChangeDeleteAccess } from "@/components/delete-change-confirm"、deleteChange（frontend/src/lib/changes.ts:199）、useMutation 与 useNotify（lib/errors.ts），全部复用既有实现（D-005）'
  - 'const deleteAccess = useChangeDeleteAccess(workspaceId)；menuActions（:106-121）在 change 非空且 canDeleteChange(change, deleteAccess) 为 true 时追加 { key: "delete-change", label: "删除变更", danger: true, onPress: 打开确认弹层 }（MobileAction.danger 已支持红色文案）——change=null 加载态与无权限时不追加，重解析/复制动作不受影响'
  - '受控弹层：deleteTarget state（null=关闭），删除项 onPress 置 { change_key: change.change_key, owner_name: change.owner_name }；DeleteChangeConfirm onCancel 关闭、onConfirm 先关弹层再 deleteMutation.mutate()（对齐桌面 DetailDeleteAction frontend/src/app/(dashboard)/workspaces/.../page.tsx:453-507 范式）'
  - 'deleteMutation = useMutation({ mutationFn: () => deleteChange(workspaceId, changeId) })：onSuccess → notify.success(`变更 ${changeKey} 已删除`) + invalidateQueries({ queryKey: ["changes", workspaceId] }) 前缀 + router.push(`/m/workspaces/${workspaceId}/changes`)；onError → notify.error(err, "删除变更失败")（403/404/409 统一中文 toast，留在详情页不白屏）'
  - '更新页面头注释 ⋯ 菜单动作清单（补删除项）；跑既有 page.m-change-detail.test.tsx 确认无回归（新用例归 task-08）'
acceptance:
  - 'canDeleteChange 三判其一（owner 本人/平台管理员/工作区所有者）通过时 ⋯ 菜单出现 danger 项「删除变更」；无权限时不出现，重解析/复制动作不受影响（FR-07）'
  - 'change=null 加载态渲染 ⋯ 菜单时不出现删除项'
  - '点击删除项弹出 DeleteChangeConfirm（末段输入防呆）；确认后 deleteChange 成功 → toast「变更 {change_key} 已删除」+ ["changes", workspaceId] 前缀失效 + 跳回移动列表 /m/workspaces/[id]/changes'
  - 'deleteChange 失败（403/404/409）→ 中文 toast（ApiError.message 兜底「删除变更失败」），留在详情页不白屏'
  - 'cd frontend && pnpm exec tsc --noEmit 通过，既有 page.m-change-detail.test.tsx 全绿'
verify:
  - 'cd frontend && pnpm exec tsc --noEmit'
  - 'cd frontend && pnpm test -- "src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx"'
constraints:
  - 'canDeleteChange 仅控入口可见性（三判启发式），后端 DELETE 组合权限为权威，前端判漏由 403 兜底中文 toast（R-04，桌面同语义非新增风险面）'
  - 'change=null 加载态不渲染删除项；无权限时其余菜单动作不受影响'
  - '复用 DeleteChangeConfirm / canDeleteChange / useChangeDeleteAccess / deleteChange，禁止重写确认弹层或权限判定（D-005）'
  - '成功路径必须失效 ["changes", workspaceId] 前缀后再 router.push 回移动列表（与桌面 DetailDeleteAction 同语义，共享缓存失效口径）'
  - '本 task 不新增测试用例（task-08 范围），仅保证既有测试不回归；不动 MobileChangeDetail 内部（task-06 范围）'
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
