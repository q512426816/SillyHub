---
id: task-06
title: 'gen:types + frontend modal workspace_id passthrough'
title_zh: '契约同步与前端下传'
author: 'qinyi'
created_at: 2026-09-09 21:29:54
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/components/changes/conflict-compare-modal.tsx
  - frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx
target_files:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/components/changes/conflict-compare-modal.tsx
  - frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx
expects_from:
  task-04:
    - contract: MachineSillySpecResolveRequest
      needs: [workspace_id]
goal: >
  后端契约落盘后同步前端类型产物，裁决弹窗把已有 workspaceId 下传进 resolve
  请求体——前端最后一环。
implementation:
  - 先确认前端 node_modules 健康：cd frontend && pnpm exec tsc --version（失败则 pnpm install --force 修复，防假 CSSProperties 报错误判）
  - cd frontend && pnpm gen:types 重新生成 src/lib/api-types.ts + backend/openapi.json；一并提交防类型债
  - conflict-compare-modal.tsx 裁决下发处（~L228）：triggerMachineSillySpecResolve(instanceId, { change, strategy, workspace_id: workspaceId })（prop 已有 L61）
  - machines.ts triggerMachineSillySpecResolve 签名不变（body 类型自动更新）
  - 更新 __tests__/conflict-compare-modal.test.tsx：断言 resolve 请求 body 含 workspace_id
acceptance:
  - gen:types:check 无 diff（api-types.ts 与 openapi.json 同步提交）
  - resolve 请求体携带 workspace_id（前端测试断言）
  - 既有 modal 用例回归全绿
verify:
  - cd frontend && pnpm vitest run src/components/changes/__tests__/conflict-compare-modal.test.tsx
  - cd frontend && pnpm lint
constraints:
  - 不改 UI 布局/样式（纯数据流）
  - 不手写 api-types.ts（一律 gen:types）
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
