---
id: task-07
title: '前端删除入口（DeleteChangeConfirm + 操作列 + 详情危险按钮 + 移动端 + deleteChange + gen:types）'
title_zh: '前端删除入口（DeleteChangeConfirm + 操作列 + 详情危险按钮 + 移动端 + deleteChange + gen:types）'
author: 'qinyi'
created_at: 2026-08-29 12:57:58
priority: P0
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-05d]
decision_ids: [D-002@v1]
expects_from:
  task-06:
    - contract: 'DELETE /api/workspaces/{workspace_id}/changes/{change_id}'
      needs: ['ChangeDeleteResponse {ok, backup_dir, file_count}；无权限 403、不存在 404、已删幂等 409']
allowed_paths:
  - 'frontend/src/components/delete-change-confirm.tsx'
  - 'frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx'
  - 'frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx'
  - 'frontend/src/app/m/workspaces/[id]/changes/page.tsx'
  - 'frontend/src/lib/changes.ts'
  - 'frontend/src/lib/api-types.ts'
  - 'backend/openapi.json'
  - 'frontend/src/components/__tests__/delete-change-confirm.test.tsx'
goal: >
  前端删除入口（design §6.3 / FR-05d）：DeleteChangeConfirm 受控确认弹层（输入变更名
  末段才可确认）+ 桌面列表操作列 + 详情页 PageHeader 危险按钮 + 移动端同步 + deleteChange
  API + gen:types 再生成；入口仅权限可见者渲染（前端启发式、后端权威），删除成功后
  changes 查询前缀失效重取，行从当前 tab 消失。
implementation:
  - '新增 components/delete-change-confirm.tsx 受控弹层（照 admin/users/page.tsx DeleteConfirm 范式 :89/:207-220/:589-614 的 fixed overlay 结构）：props 含 target(ChangeSummary 或 change_key/owner_name) 与 onCancel/onConfirm；警示文案对照原型 prototype-delete-and-pull.html（不可恢复/镜像移 30 天备份区/工作区全员不再可见）；「输入变更名末段」输入框——change_key 去掉 YYYY-MM-DD- 日期前缀后的段完全相等才启用确认按钮（原型 placeholder=change-delete-closure-and-spec-pull）；危险按钮与警示色走 brand-*/danger 语义阶 + 主题 token（CLAUDE.md 规则 20 铁律，双主题 ai-native/blue 对照原型）'
  - 'lib/changes.ts 加 deleteChange(workspaceId, changeId)：apiFetch<ChangeDeleteResponse>(`/api/workspaces/${workspaceId}/changes/${changeId}`, { method: "DELETE" })，apiFetch 范式照 listChanges（:92-110）；类型从再生成的 api-types 取'
  - '桌面列表 page.tsx：columns（:320-407）加「操作」列渲染删除入口，仅权限可见者渲染——前端启发式（后端权威）：summary.owner_id === 当前用户 id（useSession user.id）或 is_platform_admin 或当前用户在本工作区角色为 workspace_owner（既有只读 API：fetchMe() 返回的 workspaces[].role_key，或 lib/workspace-members listMembers——只导入调用，不改动这些文件）；点击开 DeleteChangeConfirm，useMutation 调 deleteChange，成功后 queryClient.invalidateQueries({ queryKey: ["changes", workspaceId] }) 前缀失效（列表/计数/详情同前缀全刷，page.tsx:276 既有范式）'
  - '详情页 [cid]/page.tsx：PageHeader（:255-290）actions slot（page-header.tsx:20/:34 右侧操作区）加独立危险按钮（不混入审批卡）；确认删除成功后 router.push 跳回变更列表'
  - '移动端 m/workspaces/[id]/changes/page.tsx：列表行同步删除入口 + 复用同一弹层组件与 mutation 失效逻辑'
  - 'pnpm gen:types 再生成 frontend/src/lib/api-types.ts + backend/openapi.json 并提交（CLAUDE.md 规则 21：gen:types 前先确认 node_modules 健康——pnpm exec tsc --version 能跑、.bin 有 shim；半坏先 pnpm install --force 修复，防假的 CSSProperties/Cannot find module 报错误判为代码问题）'
  - '测试：components/__tests__/delete-change-confirm.test.tsx——名称末段防呆（输入不符确认禁用/相符启用/取消不触发请求）+ 删除成功 invalidate 与 403/404/409 错误 toast 分支（照 admin-user-drawer 等既有组件测试范式）'
acceptance:
  - '输入与目标变更名末段（去日期前缀段）完全一致前确认按钮 disabled，一致后可点击；取消不触发任何请求'
  - '操作列/详情危险按钮/移动端入口仅对可见者渲染（owner 本人/工作区所有者/平台管理员），其余用户不可见；后端组合权限 403 仍为权威兜底'
  - '删除成功后弹层关闭、["changes", workspaceId] 前缀查询失效重取、行从当前 tab 消失；详情页删除后跳回列表'
  - '403/404/409 错误分支有中文 toast 提示，不白屏'
  - 'deleteChange 走 apiFetch 鉴权请求；ChangeDeleteResponse 类型来自再生成的 api-types，不手写'
  - 'api-types.ts 与 backend/openapi.json 已再生成提交（含 DELETE 端点契约）'
  - '双主题（ai-native/blue）下弹层与危险按钮观感对照原型，无品牌蓝硬编码'
verify:
  - 'cd frontend && pnpm exec tsc --noEmit'
  - 'cd frontend && pnpm exec vitest run src/components/__tests__/delete-change-confirm.test.tsx'
constraints:
  - '不做恢复 UI/回收站 tab、不做批量删除（D-002@v1 Non-Goal）'
  - '前端可见性只是启发式（owner_id/角色判断），不在前端做权限判定兜底——后端组合权限为权威'
  - '不动活动徽标/最后信号（task-12 领地，同页面文件后续 Wave 独立实现）、不动下载文档包按钮（task-09，workspace-config-card）'
  - 'gen:types 产物必须提交；若暴露与本次改动无关的旧测试债按惯例顺手修，不为躲报错改回手写（CLAUDE.md 规则 21）'
  - '遵守 CLAUDE.md 规则 0：只跑本组件相关 vitest 与 tsc，全量留 CI'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
