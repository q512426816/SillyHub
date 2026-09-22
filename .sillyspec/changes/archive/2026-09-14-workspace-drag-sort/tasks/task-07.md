---
id: task-07
title: '前端依赖与封装——引入 @dnd-kit/core + sortable，moveWorkspace() 封装'
title_zh: '前端依赖与封装——引入 @dnd-kit/core + sortable，moveWorkspace() 封装'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 14:04:23
priority: P0
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-010@v1]
expects_from:
  task-06:
    - contract: api-types
      needs: [WorkspaceMoveRequest, WorkspaceMoveResponse]
provides:
  - contract: moveWorkspace
    fields: [moveWorkspace, WORKSPACE_PAGE_SIZE]
allowed_paths:
  - frontend/package.json
  - frontend/pnpm-lock.yaml
  - frontend/src/lib/workspaces.ts
target_files:
  - frontend/package.json
  - frontend/pnpm-lock.yaml
  - frontend/src/lib/workspaces.ts
goal: >
  为拖拽排序落地前端依赖与 API 封装（FR-04/D-010）——引入 @dnd-kit/core +
  @dnd-kit/sortable，并在 lib/workspaces.ts 封装 move 调用与页大小单一常量，
  供 task-08/09 消费。moveWorkspace 签名钉死不得偏离——export async function
  moveWorkspace(id: string, body: { after_id?: string; before_id?: string;
  to?: "next_page_head" | "prev_page_tail"; page_size?: number }):
  Promise<WorkspaceMoveResponse>（响应类型取 api-types 生成类型，task-06 产出）；
  同时导出 export const WORKSPACE_PAGE_SIZE = 12——与后端 move 请求 page_size
  默认值同源的单一常量（风险 R-08 防漂移）。
implementation:
  - frontend 目录 pnpm add @dnd-kit/core @dnd-kit/sortable（D-010@v1）——dependencies 写入 frontend/package.json；frontend/pnpm-lock.yaml 已被 git 跟踪，随安装更新并一并提交（不落锁文件会致 CI/他人安装漂移）
  - frontend/src/lib/workspaces.ts 新增导出 WORKSPACE_PAGE_SIZE 常量（值 12）——后端 move 端点 page_size 默认值（design 接口定义）与前端页大小的同源单一常量（R-08），供 page.tsx 与 task-08/09 引用；page.tsx 现有本地 PAGE_SIZE（frontend/src/app/(dashboard)/workspaces/page.tsx:44）的替换接线归 task-09，本卡不动 page.tsx
  - 同文件 Schemas 派生区补类型别名——WorkspaceMoveRequest 与 WorkspaceMoveResponse 从 components schemas 派生（对齐 ScanResponse/WorkspaceListResponse 惯例；源头为 task-06 gen:types 产物，禁手写）
  - 新增 moveWorkspace 封装（签名按 goal 钉死）——apiFetch 发 POST /api/workspaces/{id}/move（json=body），可选字段缺省不进请求体（对齐 scanGenerate 的条件展开惯例），返回 WorkspaceMoveResponse（含 workspace/rebalanced/rank）
acceptance:
  - frontend/package.json dependencies 含 @dnd-kit/core 与 @dnd-kit/sortable，frontend/pnpm-lock.yaml 同步更新，pnpm install 幂等无 diff
  - lib/workspaces.ts 导出 moveWorkspace（签名与 goal 钉死版逐字一致）与 WORKSPACE_PAGE_SIZE=12，tsc 通过
  - moveWorkspace 走 apiFetch POST 且 URL/序列化正确——after_id/before_id/to/page_size 均可选、缺省不携带
  - 未消费新导出时既有调用（listWorkspaces/updateWorkspace 等）零行为变化
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint --file src/lib/workspaces.ts
  - cd frontend && pnpm install --frozen-lockfile（校验 lockfile 与 package.json 一致、安装可复现）
constraints:
  - 本卡只动 package.json/pnpm-lock.yaml/lib/workspaces.ts 三处——不动 page.tsx（接线归 task-09）、不写组件（task-08）、不加测试（task-10）
  - 直接依赖只加 @dnd-kit/core 与 @dnd-kit/sortable 两包（@dnd-kit/utilities 等为 sortable 传递依赖随锁文件自动带入，不加 direct 依赖）
  - 响应类型必须取 api-types 生成类型（CLAUDE.md 规则 21 禁手写 DTO）；api-types 含 WorkspaceMoveRequest/Response 是 task-06 前置
  - 禁跑全量测试（CLAUDE.md 规则 0）；本卡无测试产出
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
