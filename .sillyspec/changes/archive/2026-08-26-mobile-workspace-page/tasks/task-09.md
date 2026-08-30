---
id: task-09
title: '变更详情移动页 changes/[cid]/page.tsx（钻取、返回顶栏）（FR-04/FR-09）'
title_zh: '变更详情移动页 changes/[cid]/page.tsx（钻取、返回顶栏）（FR-04/FR-09）'
author: 'qinyi'
created_at: 2026-08-27 01:45:00
priority: P0
depends_on: ['task-01', 'task-02', 'task-08']
blocks: ['task-16']
requirement_ids: [FR-04, FR-09]
decision_ids: [D-001@V1, D-002@V1, D-004@V1]
allowed_paths:
  - src/app/m/workspaces/[id]/changes/[cid]/page.tsx
  - src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx
goal: >
  新增变更详情钻取移动页 changes/[cid]/page.tsx：自渲染返回顶栏（无底部 Tab）装配 task-08 的
  MobileChangeDetail，页面级 useQuery getChange 提供变更名与加载/错误态（FR-04/FR-09）。
expects_from:
  task-08:
    - contract: MobileChangeDetail
      needs: [changeId, workspaceId, onOpenSession, 内部 useQuery getChange + submitStageReview + FilePreviewModal]
implementation:
  - 新建页面："use client" + useParams 取 id/cid；路由命中 task-01 DRILL_ROUTES 裸容器（无底部 Tab），页面自渲染返回顶栏（FR-09）
  - 顶栏用 MobileTopBar（mobile-top-bar.tsx:16 props title/onBack）：返回 → router.push 回列表页 /m/workspaces/[id]/changes；标题变更名；⋯ 菜单（MobileActionMenu 承载：重解析/复制变更名，对齐 design §5.3 与桌面既有动作）
  - 页面级 useQuery getChange(workspaceId, cid)（lib/changes.ts:112）与 MobileChangeDetail 内部查询同 key（react-query 共享缓存不双请求），驱动顶栏标题与整页加载骨架/错误重试态
  - 主体渲染 '<MobileChangeDetail changeId={cid} workspaceId={id} onOpenSession={() => router.push(`/m/workspaces/${id}/sessions`)} />'（task-08 契约）
  - 测试：返回按钮导航断言、加载/错误态渲染、MobileChangeDetail 透传 props、onOpenSession 跳会话列表
acceptance:
  - 深链 /m/workspaces/[id]/changes/[cid] 直出详情，无底部 Tab（DRILL_ROUTES 生效）
  - 顶栏返回回列表页，标题显示变更名；加载中出骨架、失败出错误态可重试
  - 详情内容全部来自 MobileChangeDetail（阶段条/审批/文档/时间线等由 task-08 提供），页面零重复实现
  - 关联会话入口跳 /m/workspaces/[id]/sessions
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- 'src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx'
constraints:
  - 页面只做壳（返回顶栏/状态门控/装配），详情区块全部复用 task-08 的 MobileChangeDetail
  - 不改桌面 (dashboard) 变更详情文件与后端；MobileChangeDetail 契约以 task-08 产出为准
  - 纯前端，无 API/DTO 改动；样式走语义 token
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
