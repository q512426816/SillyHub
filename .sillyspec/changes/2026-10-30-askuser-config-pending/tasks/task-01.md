---
id: task-01
title: '组件待生效高亮——session-config-bar 四控件 pending 态（ring+bg-brand-50+title，无角标；禁用态 title 优先 D-009；mobile 折叠区跟随）+ 测试先行 + 原型三件登记提交'
title_zh: '组件待生效高亮——session-config-bar 四控件 pending 态（ring+bg-brand-50+title，无角标；禁用态 title 优先 D-009；mobile 折叠区跟随）+ 测试先行 + 原型三件登记提交'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-30 12:05:15
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-05]
decision_ids: ['D-001@v2', 'D-007@v1', 'D-009@v1']
allowed_paths:
  - frontend/src/components/sessions/session-config-bar.tsx
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-staged-list-refresh.test.tsx
  - frontend/src/components/prototype/session-config-pending-view.tsx
  - frontend/scripts/prototype-build.mjs
  - .sillyspec/changes/2026-10-30-askuser-config-pending/prototype-config-pending.html
target_files:
  - frontend/src/components/sessions/session-config-bar.tsx
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
goal: >
  SessionConfigBar 四控件（供应商/模型/思考档位/档案）在暂存模式下对有暂存字段的
  控件渲染待生效高亮（FR-01），弥补 2026-10-25 D-001@v1 静默决策的感知缺口；
  同时把已交付的真码原型三件（视图源码/构建脚本注册/变更目录产物 html）随本任务提交。
implementation:
  - 测试先行：frontend/src/components/sessions/__tests__/session-config-bar.test.tsx 增用例——①暂存供应商后供应商控件胶囊含 ring-1 ring-brand-400 与 bg-brand-50 类名、title=「已记住，将随下一条消息发送时生效」且无文字角标节点；②模型/思考档位/档案各一例同断言；③cancel 暂存（选回生效值）后控件回现状类名（无 ring/bg-brand-50）；④未挂 onStagedSwitch 的存量调用面渲染无高亮（回归锚）；⑤禁用态（ended）+有暂存时 title 显示禁用原因文案（D-009 优先级）
  - 实现组件改动（frontend/src/components/sessions/session-config-bar.tsx）：ctrlButton（971-1011 行区间）与思考档位胶囊按钮（1146-1186 行区间）接受 pending 参数——staged 对应键（llm_provider_id/model/thinking_level/agent_profile_id）!== undefined 时类名切「text-foreground bg-brand-50 ring-1 ring-brand-400」、title 用 pending 文案；禁用态（ctrlDisabled/thinkingCtrlDisabled）文案优先（D-009）；mobile 折叠区（mobileReveal 门控）同一 pending 参数跟随
  - 跑 session-config-bar.test.tsx 与 session-panel-staged-list-refresh.test.tsx（连带面：staged 模式控件类名断言若失效在本任务内修复，文件已在 allowed_paths）
  - git 提交本任务文件（含原型三件：frontend/src/components/prototype/session-config-pending-view.tsx、frontend/scripts/prototype-build.mjs 的 VIEWS 注册行、.sillyspec/changes/2026-10-30-askuser-config-pending/prototype-config-pending.html）
acceptance:
  - session-config-bar.test.tsx 新增用例全绿：暂存四控件各亮 ring-1 ring-brand-400+bg-brand-50、title=pending 文案、无「待生效」文字角标节点；cancel 后回现状类名；存量调用面无高亮
  - 禁用态（ended）title 显示禁用原因而非 pending 文案（D-009）
  - mobile 折叠区（mobileReveal=false 默认收起）内控件同样携带高亮（组件测试 jsdom 下按 mobile prop 断言）
  - 高亮视觉对照原型 .sillyspec/changes/2026-10-30-askuser-config-pending/prototype-config-pending.html 四态一致（人工比对，D-007）
  - session-panel-staged-list-refresh.test.tsx 既有用例零回归（连带面全绿）
verify:
  - cd frontend && pnpm exec vitest run src/components/sessions/__tests__/session-config-bar.test.tsx src/components/daemon/__tests__/session-panel-staged-list-refresh.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 无文字角标/常驻汇总行（D-001@v2 用户裁决，高亮本体即标记）
  - 禁止改 SessionConfigBar props 签名（staged/onStagedSwitch 既有，视觉层内部消化）
  - 未挂 staged 的调用面行为与外观逐字不变（FR-05 回归锚）
  - brand 语义阶类名（ring-brand-400/bg-brand-50），禁止字面色（token 铁律）
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
