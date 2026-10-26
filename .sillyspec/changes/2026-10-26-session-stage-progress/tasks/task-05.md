---
id: task-05
title: '收尾验收与文档同步（design 成功标准+模块文档+原型同源提交）'
title_zh: '收尾验收与文档同步（design 成功标准+模块文档+原型同源提交）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 03:49:36
priority: P0
depends_on: ['task-02', 'task-03', 'task-04']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-004@v1]
allowed_paths:
  - .sillyspec/docs/multi-agent-platform/modules/backend.md
  - .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md
  - .sillyspec/docs/multi-agent-platform/modules/frontend.md
  - .sillyspec/changes/2026-10-26-session-stage-progress/
  - frontend/src/components/prototype/session-stage-progress-view.tsx
  - frontend/scripts/prototype-build.mjs
  - frontend/prototype-dist/session-stage-progress.html
target_files: []  # 模块卡登记属主仓文档义务（CLI 铁律：模块卡一律写主仓，worktree 副本随 cleanup 蒸发）——target_files 对账口径只看 worktree diff，主仓路径结构性 missing；登记事实由 module-impact.md 更新结果表 + verify-result.md 任务完成度承载（constraints 原文授权「以 module-impact 为准更正 target_files」）
goal: >
  收尾：design.md 成功标准逐条对账 + 三端模块文档登记 + 原型产物与源码同源提交核对。
implementation:
  - 对照 design.md「成功标准」（proposal.md 可验证条目）逐条核验，结果记入变更目录 verify 清单（结论由 verify 阶段 verify-result.md 承载，本任务只做执行侧对账）
  - 三端模块文档 main_symbols/最近变更登记：backend.md（TurnPhaseReportRequest/turn-phase 端点/publish_turn_phase_event）、sillyhub-daemon.md（notifyTurnPhase/五阶段上报）、frontend.md（PHASE_LABEL/TurnStatusBar 阶段文案）——模块文档实际路径 .sillyspec/docs/multi-agent-platform/modules/（postcheck 拦出的幻觉路径已更正，daemon 模块文档名是 daemon.md）
  - 原型对账：frontend/src/components/prototype/session-stage-progress-view.tsx 与 frontend/prototype-dist/session-stage-progress.html 及变更目录 prototype-session-stage-progress.html 三处同源（重编译后 git diff 为空；design 清单原型两文件由本卡覆盖收口）
acceptance:
  - design 成功标准全部有对账结论（或显式记录偏差与理由）
  - 三端模块文档各含本变更符号登记
  - 原型三处产物同源（重编译 diff 为空，禁止手改产物 HTML）
verify:
  - git status 确认产物齐备；cat 三端模块文档新登记行
constraints:
  - 本任务不改源码（发现缺陷回流对应实现 task 修复，不在本卡 hotfix）
  - 模块文档路径若与 module-impact.md 解析不一致，以 module-impact 为准并在此更正 target_files
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
