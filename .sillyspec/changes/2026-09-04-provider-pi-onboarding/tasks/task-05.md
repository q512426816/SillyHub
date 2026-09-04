---
id: task-05
title: '前端引擎白名单两处+provider 选择可用性测试'
title_zh: '前端引擎白名单两处+provider 选择可用性测试'
author: 'qinyi'
created_at: 2026-09-04 11:38:51
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-04]
decision_ids: []
allowed_paths:
  - frontend/src/components/sessions/pre-session-picker.tsx
  - frontend/src/components/daemon/runtime-session-helpers.tsx
  - frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx
goal: >
  前端引擎可选性白名单两处加 pi（B-02：门户主路径 pre-session-picker.tsx:44 硬编码
  {claude,codex}；对话框路径 runtime-session-helpers.tsx:64）+选择器渲染测试（FR-04）。
implementation:
  - pre-session-picker.tsx :44 引擎集合加 'pi'（实读确认当前写法后最小改动）
  - runtime-session-helpers.tsx :64 同款加 'pi'
  - 群聊两处白名单（create-group-wizard/member-panel）本期不动（design §5.4 明示后续）
  - 新建/扩展测试：PI 出现在引擎选择器（两路径渲染断言）；pi 态 caps 门控 UI 正确（附件按钮可见[multimodal=true]、团队派工隐藏[subagent=false]——验证查表裁剪红利）
acceptance:
  - 门户与对话框两路径都能选 PI 引擎
  - pi 态 UI 按 caps 裁剪正确（multimodal 可用/subagent 隐藏）
  - 既有 session-panel/选择器测试零回归+tsc 绿
verify:
  - cd frontend && pnpm exec vitest run src/components/sessions/__tests__/pre-session-picker.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 只动两处白名单+测试；不改 caps 表值（task-04 域）
  - 群聊白名单不动（记后续）
  - 日期 zh-CN；lint 过
expects_from:
  - task-04: caps pi 键（getProviderCaps('pi') 可用）
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
