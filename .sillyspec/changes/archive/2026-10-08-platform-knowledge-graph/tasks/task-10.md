---
id: task-10
title: '端到端验收：五查询闭环/三主题截图/六键降级/lite 探测/截断保真/图卡跳转'
title_zh: '端到端验收：五查询闭环/三主题截图/六键降级/lite 探测/截断保真/图卡跳转'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-08 17:50:00
priority: P1
depends_on: [task-09]
blocks: []
requirement_ids: [FR-01, FR-05, FR-07, FR-08]
decision_ids: [D-001@v2, D-006@v1, D-008@v2]
allowed_paths:
  - .sillyspec/changes/2026-10-08-platform-knowledge-graph/verify-e2e.md
target_files: []
  # 产物 verify-e2e.md 落主仓变更目录（verify 阶段铁律：报告绝不写 worktree 的 .sillyspec 副本），
  # worktree 对账面（diff-base..HEAD）不适用——review pass 已按主仓在场落盘
goal: >
  真实环境全链路验收（backend+daemon 绑定+frontend 本地起服）：五查询闭环、三主题换肤、六键降级三态实测、
  lite/补全探测、清单截断保真、图卡跳转；记录留 verify-e2e.md。
implementation:
  - 起服：backend（uv run uvicorn）+ 前端（pnpm dev）+ 已绑定 daemon（真实环境在位；本机 sillyspec 3.32.1+ 已含 summary/nodes——注意全局安装是否 link 到 sillyspec 仓源码，若是 npm 安装需 npm link 或发布后升级）
  - 五查询闭环：图谱页逐个跑 neighbors/path/impact/orphans/dangling，断言与 CLI --json 同义（抽 orphans 对照 count）
  - 三主题换肤截图（blue/ai-native/dark 三张，无硬编码色残留）
  - 六键降级实测：停 daemon→offline；解绑/换用户→unbound；（可用时）恶意锚点 `; rm` 提交→invalid_input
  - lite 与补全：overview summary 有值→lite 胶囊在、簇气泡渲染；点代表节点→切片切换；补全下拉出现
  - 截断保真：orphans/dangling 清单「共 N 条（显示前 50）」与 CLI count 一致
  - 图卡跳转：OpsDashboard 图·孤儿卡点开清单→跳图谱页 orphans preset
  - 全程记录 verify-e2e.md（步骤/结果/截图路径/偏差）
acceptance:
  - verify-e2e.md 留档且全部检查项过（或偏差有解释与后续工单）
  - 无白屏/未捕获错误（浏览器 console 零红）
verify:
  - 浏览器实测（browser-use 技能）+ 截图存变更目录
constraints: >
  真实环境实测留档 verify-e2e.md；浏览器 console 零红
---
# task-10
