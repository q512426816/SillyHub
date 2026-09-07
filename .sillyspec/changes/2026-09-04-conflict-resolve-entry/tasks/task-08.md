---
id: task-08
title: 'frontend API and types (lib/daemon.ts trigger functions + pnpm gen:types regeneration)'
title_zh: '前端 API 与类型（lib/daemon.ts 两触发函数 + pnpm gen:types 再生成）'
author: 'qinyi'
created_at: 2026-09-04 22:40:15
priority: P0
depends_on: ['task-02', 'task-03']
blocks: ['task-09', 'task-10']
requirement_ids: [FR-02, FR-03, FR-05]
decision_ids: []
allowed_paths:
  - frontend/src/lib/daemon.ts
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
goal: >
  前端接入层交付——lib/daemon.ts 新增 triggerMachineSillySpecResolve 与 triggerMachineSillySpecGhostCleanup
  两触发函数（仿 triggerMachineSillySpecUpdate 先例 daemon.ts:241-248），pnpm gen:types 重生成
  api-types.ts 与 backend/openapi.json 随变更提交，供 task-09/10 消费。
implementation:
  - gen:types 前确认 node_modules 健康——pnpm exec tsc --version 可跑且 frontend/node_modules/.bin 有 shim；半坏（假报 CSSProperties 缺属性 / Cannot find module 类错误）先 pnpm install --force 修复再生成（CLAUDE.md 规则 21）
  - 跑 pnpm gen:types 重生成 frontend/src/lib/api-types.ts 与 backend/openapi.json（前提 task-02/03 后端 schema 已落地）；核对产物含两新端点与 sillyspec_command_result 读模型类型
  - lib/daemon.ts 新增 triggerMachineSillySpecResolve(instanceId, body)——POST sillyspec-resolve 端点（body 为 change+strategy，请求类型用生成产物禁手写）；triggerMachineSillySpecGhostCleanup(instanceId)——POST sillyspec-ghost-cleanup 端点无 body；均 apiFetch + encodeURIComponent(instanceId)，返回 sent 布尔，JSDoc 标注 404 归属 / 504 DaemonRuntimeOffline（仿 triggerMachineSillySpecUpdate :241-248 与 triggerMachineCleanup :254-261）
  - gen:types 暴露与本次无关的旧测试债（mock 缺字段等）按惯例顺手补字段修好而非改回手写（CLAUDE.md 规则 21）；涉 allowed_paths 外文件先补列本卡再修
  - 不做 UI——组件/挂载/文案归 task-09/10，本卡仅 API 层 + 类型产物
acceptance:
  - api-types.ts 含 sillyspec-resolve 与 sillyspec-ghost-cleanup 两端点类型（请求模型 change+strategy、响应 sent 布尔）与机器读模型 sillyspec_command_result 嵌套类型——全部生成非手写
  - backend/openapi.json 与 api-types.ts 由同一次 gen:types 产出并随变更提交（类型不落后后端）
  - 两触发函数 URL 经 encodeURIComponent、POST 语义、返回 sent 布尔、JSDoc 标注 404/504，风格与既有 trigger 系列一致
  - tsc --noEmit 0 错且 gen:types 幂等（二次运行产物无 diff）
verify:
  - cd frontend && pnpm gen:types
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec eslint src/lib/daemon.ts
constraints:
  - api-types.ts 只经 pnpm gen:types 生成禁手写；gen:types 前必验 node_modules 健康
  - 不做 UI 组件与页面挂载（task-09/10）；不改后端源码（schema 由 task-02/03 落地）
  - 仅跑 gen:types / tsc / 单文件 eslint，不跑前端全量测试（CLAUDE.md 规则 0）
expects_from:
  - 'task-02 两端点 OpenAPI 形态——路径/请求模型（change+strategy）/响应 sent/422 与 504 语义'
  - 'task-03 机器读模型新增 sillyspec_command_result 嵌套类型（MachineSillySpecCommandResultRead）'
provides:
  - 'triggerMachineSillySpecResolve 与 triggerMachineSillySpecGhostCleanup（lib/daemon.ts 导出，task-09 按钮/弹窗调用）'
  - 'api-types 生成的两请求模型与 sillyspec_command_result 读模型类型（task-09 回显与下发消费）'
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
