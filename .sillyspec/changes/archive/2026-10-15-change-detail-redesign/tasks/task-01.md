---
id: task-01
title: "Tab container and shared tab-set contract"
title_zh: "tab 容器与共享契约（DetailTab / visibleTabs / UnderlineNav）"
author: qinyi
created_at: 2026-10-16 00:25:57
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02, FR-03, FR-04]
decision_ids: [D-002@v1, D-007@v1, D-013@v1, D-015@v1, D-016@v1]
allowed_paths:
  - NEW:frontend/src/components/changes/detail/change-tabs.tsx
  - NEW:frontend/src/components/changes/detail/__tests__/change-tabs.test.tsx
target_files:
  - NEW:frontend/src/components/changes/detail/change-tabs.tsx
  - NEW:frontend/src/components/changes/detail/__tests__/change-tabs.test.tsx
goal: >
  出 tab 容器与共享契约（DetailTab 类型 + visibleTabs(archived) 判定 + primer UnderlineNav 渲染），供页面编排与各面板以 import type 消费；本卡不碰 page.tsx，使 tab 契约在 W1 即冻结。
implementation:
  - "新建 frontend/src/components/changes/detail/change-tabs.tsx：导出 type DetailTab = \"overview\" | \"assets\" | \"process\" | \"files\"、visibleTabs(archived: boolean): DetailTab[]（archived 为真 -> 去掉 files，其余顺序恒为 overview->assets->process->files）、TAB_LABELS（概览/产出/过程/文件与对账）与 ChangeTabs 受控组件（props {archived, value, onChange}）"
  - "ChangeTabs 内部用 @/components/primer 的 UnderlineNav 渲染（用法对齐既有先例 frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx 的 UnderlineNav 段）；本页 tab 不带计数，不传 counter"
  - "DetailTab 与 visibleTabs MUST 与组件同文件导出（各面板 type-only 消费 -> 不产生运行时循环依赖）；MUST NOT 拆到独立 types 文件"
  - "单测 frontend/src/components/changes/detail/__tests__/change-tabs.test.tsx：visibleTabs 两态成员与顺序、ChangeTabs 渲染 tab 数与 aria-selected、点击回调入参"
acceptance:
  - "visibleTabs(false) 恒等于 [overview, assets, process, files]；visibleTabs(true) 恒等于 [overview, assets, process]（成员与顺序双断言）"
  - "ChangeTabs 在 archived=false 时渲染 4 个 role=\"tab\" 按钮、archived=true 时渲染 3 个；aria-selected 仅等于 value 的那项为 true"
  - "点击任一 tab 触发 onChange 且入参为该 tab 的 DetailTab 值；组件不改自身 value（受控纯组件）"
  - "本体不读 URL、不读 react-query、不取数（URL 钳制职责在 task-07 的页面层）"
verify:
  - "cd frontend && pnpm exec tsc --noEmit"
  - "cd frontend && pnpm exec vitest run frontend/src/components/changes/detail/__tests__/change-tabs.test.tsx"
constraints:
  - "禁止把 DetailTab/visibleTabs 拆到独立文件（类型循环依赖免疫依赖同文件导出）"
  - "禁止在本卡改 page.tsx（四面板接线属 task-07）"
  - "不改移动端任何文件；不引入新依赖；禁硬编码 hex（走 themes.ts token 与 brand-* 语义阶）"
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
