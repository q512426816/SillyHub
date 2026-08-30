---
id: task-08
title: 'build-mobile-change-detail-component'
title_zh: 'MobileChangeDetail 组件（阶段步骤条/审批卡 submitStageReview/文档卡 FilePreviewModal/时间线/日志折叠/会话入口/任务桌面引导条）（FR-04）'
author: 'qinyi'
created_at: 2026-08-27 01:45:00
priority: P0
depends_on: ['task-05']
blocks: ['task-09']
requirement_ids: [FR-04]
decision_ids: [D-001@V1, D-002@V1]
allowed_paths:
  - frontend/src/components/mobile/mobile-change-detail.tsx
  - frontend/src/components/mobile/mobile-change-detail.test.tsx
provides:
  - contract: MobileChangeDetail
    fields: ['changeId', 'workspaceId', 'onOpenSession', '内部 useQuery getChange + submitStageReview + FilePreviewModal']
expects_from:
  task-05:
    - contract: PENDING_REVIEW_LABEL
      needs: [PENDING_REVIEW_LABEL]
goal: >
  新建移动版变更详情区块组件（阶段条/审批/文档/时间线/日志折叠/会话入口/任务引导条），
  审批走 submitStageReview 真实生效、文档走 FilePreviewModal 全屏预览（FR-04）。
implementation:
  - '新建 frontend/src/components/mobile/mobile-change-detail.tsx，props 按 design §7：changeId/workspaceId/onOpenSession；内部 useQuery getChange(workspaceId, changeId)（lib/changes.ts:112）'
  - '首步通读 components/changes/detail/ 子组件（change-stage-header/stage-actions/files-card/step-timeline/agent-run-log/sessions-card/task-board-card/review-history-card/quicklog-linked-card/run-file-artifacts），按 X-03 准则逐个标注「纯内容复用 / 布局耦合重绘」，落位清单写入组件头注释供 verify 对账（R-04）'
  - '阶段步骤条自绘横向滚动紧凑版（桌面 change-stage-header.tsx:70 flex flex-wrap，390px 六阶段折行拥挤，C-15）'
  - '审批操作卡：有待办默认展开，通过/驳回 mutation 调 submitStageReview(workspaceId, changeId, action, comment?)（lib/changes.ts:536，action 词表 proposal_approve/plan_approve/test_pass/archive_confirm 等），成功后 invalidate ["changes", workspaceId] 前缀并 refetch 详情；待办态标题用 PENDING_REVIEW_LABEL 映射（expects_from task-05）'
  - '文档卡：ChangeFilesCard（props workspaceId/changeId，:26）按 X-03 结论复用或重绘壳；chip 点击构造 FilePreviewTarget（fetch/meta/download）→ FilePreviewModal（file-preview-modal.tsx:61 props：target/open/onClose/defaultFullscreen=true 全屏直出）'
  - '时间线 ChangeStepTimeline（steps/focusStage，:273 纯内容复用）+ 执行日志 ChangeAgentRunLog + quicklog 关联 折叠卡（自绘 sec-card 壳，内容按 X-03 结论复用/重绘）；关联会话卡点击调 props.onOpenSession（宿主跳移动会话列表）；任务区渲染桌面引导条（D-002：「任务看板请到电脑端操作」，不复刻 change-task-board-card）'
  - '新增 colocate 测试 mobile-change-detail.test.tsx：审批通过/驳回（mock submitStageReview 断言 action/comment 入参 + invalidate 断言）、文档点击打开 FilePreviewModal（defaultFullscreen=true）、引导条渲染、步骤条横向滚动容器、onOpenSession 回调'
acceptance:
  - 审批通过/驳回真实调 submitStageReview 并 invalidate ["changes", workspaceId] 前缀后刷新详情
  - 文档点击打开 FilePreviewModal 全屏预览（defaultFullscreen=true）
  - 任务区渲染桌面引导条（D-002）；关联会话卡经 onOpenSession 跳移动会话列表；待办态经 PENDING_REVIEW_LABEL 复用
  - X-03 落位清单产出：detail/ 每个子组件的复用/重绘决定有记录，供 verify 对账
verify:
  - cd frontend && pnpm test -- src/components/mobile/mobile-change-detail.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - components/changes/detail/ 子组件按 X-03 准则逐个落位（纯内容渲染直接复用；lg:grid/固定宽/桌面交互耦合的按结论重绘移动版）并产出落位清单
  - 禁止修改 components/changes/detail/ 与 components/files/ 既有文件（FilePreviewModal/ChangeFilesCard 原样消费）
  - 审批一律走 submitStageReview（submitReview/approveChange 为退役链路，changes.ts:594/:129 注释明示不再驱动推进，禁用）
  - 零后端改动、不新增 API（D-001 纯渲染层）；详情页壳/返回顶栏归 task-09 装配，本卡只做区块组件
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
