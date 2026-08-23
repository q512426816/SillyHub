---
id: task-09
title: 'add-run-detail-file-artifacts-section'
title_zh: '前端任务详情页「产出文件」区——按 run 查询文件制品 + 卡片网格 + 组件测试'
author: 'qinyi'
created_at: 2026-08-23 09:37:06
priority: P1
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-010@v1]
allowed_paths:
  - frontend/src/lib/agent.ts
  - frontend/src/components/changes/detail/run-file-artifacts.tsx
  - frontend/src/components/changes/detail/__tests__/run-file-artifacts.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/tasks/[tid]/page.tsx
expects_from:
  task-03:
    - contract: GET /api/agent/file-artifacts
      needs: [files, id, original_name, size, mime_type, description, created_at]
  task-08:
    - contract: FileMessageCard
      needs: [fileId, name, size, mime, description]
goal: >
  批任务 run 的产出文件对用户可见可下载——run 详情下方新增「产出文件」区，数据源
  GET /api/agent/file-artifacts?run_id=（不复用 /api/file/list，D-010@v1）。
implementation:
  - 'lib/agent.ts 新增 listAgentFileArtifacts(runId)——apiFetch GET /api/agent/file-artifacts?run_id=<id>（JWT 自动带），响应 files 数组（FileMetaResp 含 description/created_at，服务端按 created_at 倒序）；类型本卡本地声明，api-types.ts 生成归 task-10 不手改'
  - '新建 changes/detail/run-file-artifacts.tsx——props 收 runIds 列表；逐 run 拉取合并（file id 去重、created_at 倒序）；区头「📁 产出文件 · N 个」+ FileMessageCard 网格（task-08 provides）；空态「暂无产出文件」、失败态错误行，均不阻断页面'
  - '任务详情页接线——design §6 原行 agent/page.tsx（run 详情区）已随智能体控制台移除（2026-08-18 commit 6011d822，该页现为 5 行 stub），落点改任务详情页 changes/[cid]/tasks/[tid]/page.tsx「智能体运行详情」区（:728-777）之下，agentRuns（:165 listAgentRuns）非空时渲染 RunFileArtifacts 并传全部 run id；verify 阶段回写 design 该行'
  - '新建 __tests__/run-file-artifacts.test.tsx——mock lib/agent 列表函数，覆盖正常列表渲染卡片与数量/多 run 合并去重排序/空态/失败态'
acceptance:
  - '任务详情页 run 详情下方出现「产出文件」区，数据仅来自 GET /api/agent/file-artifacts?run_id=（多 run 合并、file id 去重、created_at 倒序）'
  - '卡片复用 FileMessageCard（图片缩略图/通用下载两形态），下载走既有 downloadFile'
  - '空态与加载失败均有兜底展示，不阻断任务详情页其余区块；组件测试覆盖以上分支'
verify:
  - cd frontend && pnpm vitest run src/components/changes/detail/__tests__/run-file-artifacts.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - '数据源禁用 /api/file/list（非 admin owner 分支把 owner_id 当 workspace id 鉴权会 404，D-010@v1）；下载走既有 downloadFile（GET /api/file/{file_id}，JWT）'
  - '不改 task-08 卡内文件（file-message-card/session-log-assembler/turn-segment-views）——同波并行无共享文件，仅消费其 provides 契约；不手改 api-types.ts（task-10 gen:types 后对齐）'
  - 'UI 遵循 FRONTEND_PAGE_STYLE.md 与 AI-Native 双主题（brand-* 语义阶/主题 token/阴影 var 化），参考原型 prototype-agent-file-upload-mcp.html 产出文件区；Date.toLocaleString 显式传 zh-CN'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
