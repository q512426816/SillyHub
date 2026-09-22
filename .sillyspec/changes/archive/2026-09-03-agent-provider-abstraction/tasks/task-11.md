---
id: task-11
title: '三端 provider 门控收敛查表（session-panel + daemon/session/service.py，行为不变）'
title_zh: '三端 provider 门控收敛查表（session-panel + daemon/session/service.py，行为不变）'
author: 'qinyi'
created_at: 2026-09-03 23:55:50
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
  - backend/app/modules/daemon/session/service.py
  - frontend/src/lib/provider-caps.ts
  - backend/app/modules/agent/provider_caps.py
  - frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx
  - backend/app/modules/daemon/tests/test_session_provider_caps.py
goal: >
  散落硬编码 provider 门控收敛为查 ProviderCaps 表（前端 session-panel 附件/团队派工/resume/
  vision 门控；backend daemon/session/service.py 同款），纯重构行为不变（FR-06 / D-002@v1）。
implementation:
  - session-panel.tsx：现 `=== 'claude'` 门控点（:2937/:3218/:3544/:5373/:5673/:5685 附近，以实读为准）逐个改 getProviderCaps(provider).multimodal/.subagent/.resume 等；caps 表 claude/codex 取值必须与原硬编码逐一相等
  - backend daemon/session/service.py：同款门控点（:1361/:2311/:2845/:6335 附近）改 get_provider_caps；报错文案不变
  - 行为不变断言测试：frontend session-panel-provider-caps.test.tsx（门控两态渲染对照）+ backend test_session_provider_caps.py（门控函数输入输出对照原判定）
acceptance:
  - grep 验证 session-panel.tsx 与 daemon/session/service.py 无残留 provider 字面量门控（`=== 'claude'` / `== "claude"`，探测试探性字符串断言除外）
  - 每个门控点行为与改造前逐一相等（断言测试，P2 纯重构验收）
  - 既有 session 相关测试零回归
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-panel-provider-caps.test.tsx
  - cd backend && python -m pytest app/modules/daemon/tests/test_session_provider_caps.py -q
constraints:
  - 纯重构：不改任何门控的布尔结果；vision 模型正则等复杂判定保持原式仅包一层 caps 判定
  - provider-caps.ts/provider_caps.py 若需补 helper 随改（守护测试同步）
  - 不动权限审批链与 lease 派发
expects_from:
  - task-02: ProviderCaps 三端表
  - task-05: InteractiveProvider 键空间（registry 推导）
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
