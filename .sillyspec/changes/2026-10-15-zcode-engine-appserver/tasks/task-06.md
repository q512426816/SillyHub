---
id: task-06
title: 'backend 枚举——schema.py InteractiveProviderLiteral 加 "zcode" + pnpm gen:types 与 sillyhub-daemon gen:types 双义务提交（api-types.ts + openapi.json）（FR-02）'
title_zh: 'backend 枚举——schema.py InteractiveProviderLiteral 加 "zcode" + pnpm gen:types 与 sillyhub-daemon gen:types 双义务提交（api-types.ts + openapi.json）（FR-02）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 13:50:04
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
target_files:
  - backend/app/modules/daemon/schema.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
provides:
  - InteractiveProviderLiteral 含 "zcode"（backend 校验 + openapi 透出 → 双端 api-types）
expects_from: []
goal: >
  backend provider 枚举扩展 + gen:types 双义务提交（CLAUDE.md 规则 21：frontend 与
  sillyhub-daemon 的 api-types 同变更内重生成，不让类型落后后端形成债）。
implementation:
  - backend/app/modules/daemon/schema.py:129 附近 InteractiveProviderLiteral 加 "zcode"
  - pnpm gen:types（frontend/src/lib/api-types.ts）+ pnpm -C sillyhub-daemon gen:types（sillyhub-daemon/src/api-types.ts）+ openapi.json 重生成一并提交
acceptance:
  - provider='zcode' 的会话创建请求通过 backend 校验；'unknown' 仍被拒
  - 双端 api-types 与 openapi.json 含 zcode 枚举且 diff 仅限枚举增量
verify:
  - cd backend && uv run pytest -q --no-cov -k "interactive_provider or provider_literal"（无既有用例则跑 schema 相关聚焦）
  - git diff --stat 检查四个文件均更新
constraints:
  - 仅枚举增量；先确认前端 node_modules 健康（pnpm exec tsc --version 可跑）再 gen:types
  - gen:types 暴露无关旧测试债时顺手补字段修好而非改回手写
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
