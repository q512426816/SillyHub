---
id: task-10
title: '供应商+模型级联（候选=model/default_fallback/role_mappings 去重保序+「默认」首项）+ injectSession(model)（provisional 暂存/Codex 锁定）+ lib/daemon.ts 扩参'
title_zh: '供应商+模型级联（候选=model/default_fallback/role_mappings 去重保序+「默认」首项）+ injectSession(model)（provisional 暂存/Codex 锁定）+ lib/daemon.ts 扩参'
author: 'qinyi'
created_at: 2026-08-29 02:52:55
priority: P0
depends_on: ['task-02', 'task-09']
blocks: []
requirement_ids: [FR-03-2, FR-03-3, FR-03-5]
decision_ids: [D-002@v1, D-004@v1]
allowed_paths:
  - frontend/src/components/sessions/session-config-bar.tsx
  - frontend/src/lib/daemon.ts
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
goal: >
  供应商块级联模型子下拉（候选=model/default_fallback/role_mappings 去重保序+「默认」首项；「不指定」隐藏子下拉），injectSession 扩 model（含 provisional 暂存与 Codex 锁定）。
implementation:
  - 候选集合 useMemo（provider 字段去重）
  - 切换提交 model（空串=默认）+ config_snapshot.model 展示
  - lib/daemon.ts injectSession 参数与类型
acceptance:
  - 级联交互照原型；切模型走既有切换链路（idle 守卫）
  - Codex 锁定/「不指定」两态正确
verify:
  - cd frontend && pnpm exec vitest run src/components/sessions/__tests__/session-config-bar
constraints:
  - 候选不做上游 /v1/models 实时拉取（D-002）
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
