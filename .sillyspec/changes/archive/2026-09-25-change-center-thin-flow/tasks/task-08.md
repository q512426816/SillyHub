---
id: task-08
title: 'Thin explanation cards desktop and mobile'
title_zh: '前端 thin 说明卡与 quick 退役文案'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-25 07:14:58
priority: P1
depends_on: ['task-07']
blocks: []
requirement_ids: [FR-06, FR-07]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/changes/detail/change-stage-actions.tsx
  - frontend/src/components/mobile/mobile-change-detail.tsx
target_files:
  - frontend/src/components/changes/detail/change-stage-actions.tsx
  - frontend/src/components/mobile/mobile-change-detail.tsx
goal: >
  变更详情为 thin 阶段提供两段式只读说明卡（桌面+移动对等），quick 说明卡文案转「已退役·存量收尾」。
implementation:
  - frontend/src/components/changes/detail/change-stage-actions.tsx:129-143 quick 分支旁加 currentStage==="thin" 分支：两段式说明卡（协议 1/2 flow start 含过门格式提示 → 干活填槽 → 协议 2/2 flow done 断点续/fail-closed 提示，命令以说明文本呈现变更键），形态对齐 quick 卡样式与原型 prototype-change-center-thin-flow.html B 面
  - 同文件 :139 quick 卡文案改「已退役·存量收尾」（现状指路 sillyspec run quick 已退役）
  - frontend/src/components/mobile/mobile-change-detail.tsx:498-608 补 thin 说明卡分支（现状 quick/thin 均落通用「当前无可审批事项」折叠卡）
acceptance:
  - 桌面与移动 thin 阶段变更详情均显示「轻量变更」说明卡（两段式+断点续提示）
  - quick 卡不再出现 sillyspec run quick 指路文案；quicklog tab 徽标存量语义不与本卡冲突
verify:
  - cd frontend && pnpm exec tsc --noEmit && pnpm test -- change-stage-actions
constraints:
  - 说明卡为只读说明不派发动作；显示名一律「轻量变更」（D-002@v1）
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
