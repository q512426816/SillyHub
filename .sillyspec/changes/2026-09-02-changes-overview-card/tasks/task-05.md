---
id: task-05
title: '前端类型链——pnpm gen:types（node_modules 健康预检）→ api-types.ts + openapi.json + lib/daemon.ts 机器数据读取扩展'
title_zh: '前端类型链——pnpm gen:types（node_modules 健康预检）→ api-types.ts + openapi.json + lib/daemon.ts 机器数据读取扩展'
author: 'qinyi'
created_at: 2026-09-03 08:46:57
priority: P0
depends_on: ['task-03']
blocks: [task-06]
requirement_ids: [FR-07]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/lib/daemon.ts
goal: >
  前端类型链接入——task-03 机器视图嵌套 sillyspec_status 落 OpenAPI 后，pnpm gen:types
  （node_modules 健康预检先行）再生 api-types.ts + backend/openapi.json，并给 lib/daemon.ts
  的 DaemonMachineRead 扩展 sillyspec_status 嵌套字段，为 task-06 卡片 / task-07 挂载
  提供类型与读取形态。
implementation:
  - node_modules 健康预检——pnpm exec tsc --version 可跑且 node_modules/.bin 有 openapi-typescript shim；半坏则 pnpm install --force 重建（普通 install 命中缓存不修 shim），防假 CSSProperties / Cannot find module 报错误导（CLAUDE.md 规则 21）
  - cd frontend && pnpm gen:types——脚本内部先跑 backend dump_openapi.py 刷新 backend/openapi.json 再生成 src/lib/api-types.ts（backend 需可启动导出），两产物同提交
  - lib/daemon.ts 仿 sillyspec_update 嵌套先例（DaemonMachineRead 内既有写法）追加 sillyspec_status 可选字段，类型引用 api-types 生成版嵌套 schema 联合 null（预期名 MachineSillySpecStatusRead，对齐 MachineSillySpecUpdateRead 命名先例，以 task-03 实际生成名为准），禁止手写 DTO；注释锚定本变更 B'——null=CLI 能力缺失（清除语义，卡片显「总览不可用」占位）、undefined=旧后端缺字段按占位消费
  - gen:types 暴露的与本次无关旧测试债（mock 缺字段类）按项目惯例顺手补字段修好，不为躲报错改回手写
acceptance:
  - api-types.ts 含机器视图嵌套 sillyspec_status 的类型化 schema（嵌套类型化非裸 Record/any），backend/openapi.json 同步刷新（git diff 两文件均有变更）
  - node_modules 预检步骤先行留痕——tsc --version 通过后才执行 gen:types
  - cd frontend && pnpm exec tsc --noEmit 0 错误
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec eslint src/lib/daemon.ts
constraints:
  - 不改 UI 组件与页面（task-06/07 范围）；不手写 api-types 字段、不手编 openapi.json（gen:types 联动产物）
  - 本 task 不新增测试不跑全量（类型面以 tsc + eslint 守门，组件/页面测试归 task-06/07；全量留 CI）
expects_from:
  - task-03: 机器视图嵌套 sillyspec_status 读取模型落 OpenAPI（心跳摘要 schema，嵌套形态对齐 sillyspec_update 先例）
provides:
  - contract: MachineSillySpecStatusType
    fields: [DaemonMachineRead.sillyspec_status 嵌套类型（ok/errors_count/warnings_count/generated_at/active_changes/healthy_count/ghost_count/conflict_count/conflict_types/changes 截断 N=50/pending_conflicts），机器读取形态 listDaemonMachines]
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
