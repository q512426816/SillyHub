---
id: task-06
title: 'SessionConfigBar mobile 模型名/徽章排列收紧（FR-04）'
title_zh: 'SessionConfigBar mobile 模型名/徽章排列收紧（FR-04）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 23:19:47
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/sessions/session-config-bar.tsx
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
target_files:
  - frontend/src/components/sessions/session-config-bar.tsx
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
goal: >
  治手机端底部供应商行拥挤（截图②「智谱 GLM-LGX + glm-5.3-fla… + 设置 + 4% + 48%」
  模型名截断）：沿用既有 variant/mobile 机制收紧 mobile 排列——模型名截断宽度放宽或
  换行式布局，用量徽章（QuotaPill/CtxUsageBar compact）排列不挤压；desktop 零变化。
implementation:
  - mobile 分支：模型选择控件 max-w-[110px]（:970 符号定位）放宽至 132px 或改 flex 换行策略（以真机 430pt 实测取优）
  - 用量徽章 compact 排列：间距/换行点调整，保证四元素（供应商/模型/设置/徽章）不互相挤压截断
  - desktop 分支零改动（锚定用例断言 max-w-[140px] 等既有类不变）
  - 测试：mobile 模型名宽度断言更新 + desktop 锚 + 徽章排列断言
acceptance:
  - mobile 下模型名可读字符数 ≥12（430pt 视口）或完整显示
  - 既有 session-config-bar 套件全绿（desktop 用例零改动通过）
verify:
  - cd frontend && pnpm vitest run src/components/sessions/__tests__/session-config-bar.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不动「设置」展开钮收纳机制（ql-20260915-011 用户约束：收入口不砍功能）
  - 不改 desktop 的 compact 完整形态（ql-20260915-013 既有锚）
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
