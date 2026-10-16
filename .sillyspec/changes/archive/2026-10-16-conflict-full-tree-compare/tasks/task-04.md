---
id: task-04
title: '前端行级「标记已处理」：resolveSpecConflict 客户端 + registry 行关闭入口'
title_zh: '前端行级「标记已处理」：resolveSpecConflict 客户端 + registry 行关闭入口'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-16 17:26:11
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-003@v1, D-012@v1]
expects_from:
  task-02:
    - contract: "SpecConflictRead"
      needs: [id, status]
allowed_paths:
  - frontend/src/lib/spec-workspaces.ts
  - frontend/src/components/changes/platform-sync-section.tsx
  - frontend/src/components/changes/__tests__/platform-sync-section.test.tsx
target_files:
  - frontend/src/lib/spec-workspaces.ts
  - frontend/src/components/changes/platform-sync-section.tsx
  - frontend/src/components/changes/__tests__/platform-sync-section.test.tsx
related_tests:
  - frontend/src/components/changes/__tests__/platform-sync-section.test.tsx
goal: >
  给注册表冲突行一个手动关闭出口：可操作者点「标记已处理」→ 二次确认 → 调既有 resolve 接口把平台行置 resolved → 该行从列表消失。
implementation:
  - frontend/src/lib/spec-workspaces.ts:328-337 旁新增 resolveSpecConflict(workspaceId, conflictId, status="resolved") → POST /api/workspaces/{workspace_id}/spec-conflicts/{conflict_id}/resolve，body {status}（对齐 backend/app/modules/spec_profile/schema.py:69-73 SpecConflictResolve）
  - frontend/src/components/changes/platform-sync-section.tsx:336-368 registryVersionRows 行对象补 id（SpecConflictItem.id）
  - 行按钮区（access.canOperate && !succeeded，:880-930 区）对 row.id 存在的注册表行新增「标记已处理」：modal.confirm（标题「关闭该冲突记录？」；正文写明关闭范围=整条注册表记录（含并列展示的兄弟变更名行）、不改本机文件、冲突若仍存在下次同步会重新登记）→ resolveSpecConflict → 成功 notify + invalidate [...QUERY_KEY_ROOT,"spec-conflicts",workspaceId]（:277 键，QUERY_KEY_ROOT=["platform-sync-section"]）
  - 墓碑行（isTomb）/机器快照行不提供该按钮；只读视角（!canOperate）不可见
  - 测试：注册表行渲染「标记已处理」；确认后按 (workspaceId, row.id, "resolved") 调用且查询失效重取（行消失）；只读视角无按钮；失败分支给出提示
acceptance:
  - 单测：mock 注册表开放行 → 渲染「标记已处理」；点击并在确认弹窗确认 → resolveSpecConflict 以 (workspaceId, row.id, "resolved") 调用；成功后该行从列表消失（invalidate 触发重取）
  - 单测：canOperate=false → 无「标记已处理」；墓碑行（isTomb）无该按钮
  - 既有 platform-sync-section.test.tsx 断言（按钮集合/行数）同步更新后全绿
verify:
  - cd frontend && pnpm test -- src/components/changes/__tests__/platform-sync-section.test.tsx
  - cd frontend && pnpm exec tsc --noEmit && pnpm lint
constraints:
  - 关闭仅置 resolved、禁止删行/改本机文件；确认文案必须写明整条记录范围含兄弟变更名行（D-012@v1）
  - invalidate 键必须 [...QUERY_KEY_ROOT,"spec-conflicts",workspaceId]（禁止自造 "platform-sync" 键）
  - 不改后端 resolve 端点契约与权限门（WORKSPACE_WRITE 既有）
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
