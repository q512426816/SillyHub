---
id: task-03
title: 'Sync openapi contract and regenerate api-types'
title_zh: '契约同步——导出 openapi.json + gen:types 再生成 api-types（Permission 联合类型收录 system_status:read）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 00:21:05
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
target_files:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - backend/app/modules/agent/provider_caps.py
  - frontend/src/lib/provider-caps.ts
provides:
  - contract: PermissionKey
    fields: [system_status:read]
expects_from:
  task-01:
    - contract: Permission.SYSTEM_STATUS_READ
      needs: [system_status:read]
goal: >
  让前端 PermissionKey 联合类型编译期收录新权限 system_status：导出后端 openapi.json，
  pnpm gen:types 再生成 frontend/src/lib/api-types.ts（规则 21 禁手写）。
implementation:
  - 先确认前端 node_modules 健康（pnpm exec tsc --version 能跑；不健康先 pnpm install --force，防假 CSSProperties 报错误判）
  - 导出 backend/openapi.json（仓库既有导出命令/脚本，见 frontend package.json gen:types 脚本链）
  - cd frontend && pnpm gen:types 再生成 api-types.ts，确认 Permission 联合类型含 system_status:read
  - 若 gen:types 暴露与本次无关的旧测试债（mock 缺字段类），按惯例顺手补字段修好，不为躲报错回退手写
acceptance:
  - frontend/src/lib/api-types.ts 的 Permission schema 联合类型包含 system_status:read
  - backend/openapi.json 与 api-types.ts 同一提交（不让类型落后后端形成债）
  - gen:types 后前端 tsc --noEmit 无新增错误
verify:
  - cd frontend && pnpm gen:types && pnpm exec tsc --noEmit
constraints:
  - 禁止手写编辑 api-types.ts（只经 gen:types 产出）
  - 不顺带重构无关类型
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
