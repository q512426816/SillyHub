---
id: task-06
title: '前端 API 层——gen:types 再生（api-types.ts + openapi.json）+ lib/daemon.ts `triggerMachineSillySpecUpdate`（depends_on: task-03）'
title_zh: '前端 API 层——gen:types 再生（api-types.ts + openapi.json）+ lib/daemon.ts `triggerMachineSillySpecUpdate`（depends_on: task-03）'
author: 'qinyi'
created_at: 2026-08-31 08:31:16
priority: P0
depends_on: [task-03]
blocks: [task-07, task-08]
requirement_ids: [NFR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/lib/daemon.ts
goal: >
  前端 API 层接入：pnpm gen:types 从后端 OpenAPI 再生类型（api-types.ts + openapi.json 同步提交），
  lib/daemon.ts 新增 triggerMachineSillySpecUpdate——为 task-07 机器卡 UI 提供类型与调用函数。
implementation:
  - gen:types 前确认前端 node_modules 健康（pnpm exec tsc --version 可跑；坏则 pnpm install --force 修复，防假 CSSProperties 报错）
  - 跑 pnpm gen:types（backend 需可启动导出 OpenAPI；产物含 DaemonMachineRead 3 新字段 + 新端点类型）提交 api-types.ts + backend/openapi.json
  - lib/daemon.ts 仿 triggerMachineSelfUpdate（:203）加 triggerMachineSillySpecUpdate(instanceId)：POST /api/daemon/machines/{id}/sillyspec-update，返回 {sent: boolean}；接口类型一律引用 api-types 再生产物，禁止手写新类型
acceptance:
  - api-types.ts 含 sillyspec_version/sillyspec_latest_version/sillyspec_update（嵌套类型化非裸 Record）与新端点函数类型
  - tsc --noEmit 0 错；gen:types 暴露的无关旧测试债按惯例顺手修不回避
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec eslint src/lib/daemon.ts src/lib/api-types.ts
constraints:
  - 不改 UI 组件（task-07）；不手写 api-types 字段
  - openapi.json 为 gen:types 联动产物，不手编
expects_from:
  - task-03: MachineSillySpecView（DaemonMachineRead 3 字段 + sillyspec-update 端点 OpenAPI 形态）
provides:
  - contract: FrontendSillySpecApi
    fields: [triggerMachineSillySpecUpdate, DaemonMachineRead sillyspec 字段类型]
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
