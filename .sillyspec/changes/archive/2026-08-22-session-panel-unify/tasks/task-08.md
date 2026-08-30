---
id: task-08
title: update-team-task11-anchors
title_zh: 合入后更新团队任务卡锚点
author: qinyi
created_at: 2026-08-22 13:50:00
priority: P1
depends_on: [task-07]
blocks: []
requirement_ids: [FR-08]
decision_ids: [D-006@v1]
expects_from:
  task-07:
    - contract: regression-green
      needs: [vitest-tsc-lint-zero-fail]
allowed_paths:
  - .sillyspec/changes/2026-08-22-team-session-unify/tasks/task-11.md
goal: >
  本变更代码合入 main 后，把 team-unify task-11.md 中指向已删适配层的代码
  锚点更新为新结构表述，完成 D-006@v1 P1 顺序门收尾（plan 全局验收 6）。
implementation:
  - task-11.md 第 18 与 21 行——allowed_paths 中适配层及其测试路径改为 SessionPanel dialog 分支与改名后 session-panel-dialog 系列测试的等价表述
  - 文件内其余适配层提及同步等价改写，团队任务的范围与验收语义不变
  - grep 团队全部任务卡复核无其它适配层引用，实测唯一即 task-11
acceptance:
  - team-unify 任务卡 grep 无 interactive-session-panel 残留引用
  - task-11 语义不变仅锚点更新
verify:
  - grep -rn interactive-session-panel .sillyspec/changes/2026-08-22-team-session-unify/tasks/ 无结果
constraints:
  - 仅文档改动——必须在本变更代码合入 main 之后执行，即 D-006@v1 P1 门收尾
  - 不动团队代码与分支与其它 change 记录
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
