---
id: task-07
title: 'frontend 单聊引擎选项——session-list-panel.tsx SESSION_ENGINE_OPTIONS 加 zcode + 快照测试 （FR-07）'
title_zh: 'frontend 单聊引擎选项——session-list-panel.tsx SESSION_ENGINE_OPTIONS 加 zcode + 快照测试 （FR-07）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 13:50:04
priority: P0
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-07]
decision_ids: []
allowed_paths:
  - frontend/src/lib/daemon/runtimes.ts
  - frontend/src/lib/daemon/__tests__/runtimes.test.ts
target_files:
  - frontend/src/lib/daemon/runtimes.ts
  - NEW:frontend/src/lib/daemon/__tests__/runtimes.test.ts
expects_from:
  - task-06: api-types 含 zcode 枚举
# 事实修正（execute 期发现）：SESSION_ENGINE_OPTIONS 的单一源在 frontend/src/lib/daemon/runtimes.ts 的 SESSION_SUPPORTED_PROVIDERS（runtimes.ts:171-183，panel 仅消费派生值）；session-list-panel/portal 两处测试均 mock 该模块不受影响。文件指向由 panel 修正为 runtimes.ts，任务目标不变。
goal: >
  单聊创建入口的引擎下拉出现 zcode 选项（图标/标签，中文显示名）；
  群聊 ENGINE_OPTIONS 不变。
implementation:
  - frontend/src/lib/daemon/runtimes.ts SESSION_SUPPORTED_PROVIDERS 加 "zcode"（单一源：panel 智能体筛选/pre-session-picker/runtime 白名单三消费方自动生效；可见性由 runtime 探测门控）+ PROVIDER_META 加 zcode 条目（label/icon/color）
  - 直测文件（真实模块不 mock）：白名单五引擎有序含 zcode、ENGINE_OPTIONS 派生 label、META 三字段、防裸 key 回退；群聊 ENGINE_OPTIONS 在 create-group-wizard.tsx:93 独立硬编码（不含 zcode，零变化）
acceptance:
  - SESSION_ENGINE_OPTIONS 含 zcode（真实模块直测）；群聊 ENGINE_OPTIONS/GROUP_SUPPORTED_PROVIDERS（create-group-wizard.tsx:93/100）零变化
  - 快照更新仅含新增选项
verify:
  - cd frontend && pnpm vitest run src/lib/daemon/__tests__/runtimes.test.ts
constraints:
  - 仅枚举追加，无布局/结构/流程变化（原型跳过的依据）
  - 图标与标签风格对齐现有引擎条目
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
