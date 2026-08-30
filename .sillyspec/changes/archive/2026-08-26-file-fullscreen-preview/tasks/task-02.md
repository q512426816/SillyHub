---
id: task-02
title: Add fetchChangeFileRaw lib and regen api types
title_zh: gen:types 同步 + 前端 lib fetchChangeFileRaw
author: 'qinyi'
created_at: 2026-08-26 20:13:49
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-009@v1]
allowed_paths:
  - frontend/src/lib/change-files.ts
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/scripts/gen-api-types.mjs
goal: >
  前端补齐 raw 端点取数函数 fetchChangeFileRaw（裸 fetch+Bearer 返回 Blob）并经 pnpm gen:types 再生成 openapi.json 与 api-types.ts（CLAUDE.md 规则 21，类型不落后后端）。
implementation:
  - change-files.ts 新增 fetchChangeFileRaw(workspaceId, changeId, path) 返回 Promise<Blob>（D-009 预览恒走 raw），URL 拼 /api/workspaces/{wid}/changes/{cid}/files/raw 且 path 经 encodeURIComponent
  - 实现范式对齐 explorer.ts fetchDownload（L68-94）——裸 fetch 带 Bearer 头（useSession 取 token），401 经 ensureFreshAccessToken 单飞刷新后重试一次，非 2xx 抛 ApiError；不走 apiFetch（JSON 封装不适用 blob）
  - 跑 cd frontend && pnpm gen:types（脚本先刷 backend/openapi.json 再生成 api-types.ts），git diff 核对 openapi paths 出现 files/raw 且 api-types.ts 同步；若暴露无关旧测试债按惯例顺手补齐而非改回手写
acceptance:
  - fetchChangeFileRaw 取回后端 body 的 Blob，blob.type 等于后端 media_type；401 刷新后重试一次，失败抛 ApiError
  - backend/openapi.json 与 frontend/src/lib/api-types.ts 为 gen:types 产物（含 files/raw），无手写类型
  - cd frontend && pnpm exec tsc --noEmit 零错误
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm gen:types 后 git diff 核对 backend/openapi.json 与 frontend/src/lib/api-types.ts 产物已更新
constraints:
  - 不改 apiFetch 与 change-files.ts 既有封装（listChangeFiles 等），新函数独立追加；不动 change-file-tree 与预览组件（属 task-04/05 范围）
  - gen:types 前先确认 node_modules 健康（pnpm exec tsc --version 能跑且 .bin 有 shim，坏则 pnpm install --force）；api-types.ts 禁止手写
provides:
  - contract: fetchChangeFileRaw
    fields: [workspaceId, changeId, path, blob]
expects_from:
  task-01:
    - contract: files_raw_endpoint
      needs: [media_type, body]
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
