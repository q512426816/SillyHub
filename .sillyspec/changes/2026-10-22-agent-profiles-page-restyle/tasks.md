---
author: flow-machine-draft
created_at: 2026-10-22T05:23:58.762Z
---
# 任务注册表（Tasks）— 2026-10-22-agent-profiles-page-restyle

- [x] task-01: PageHeader 加可选 icon prop（缺省不渲染，兼容断言）；page.tsx 页头组装 ◆图标+统计胶囊（grid onStatsChange 上报单源）+新建按钮；用例「页头统计胶囊」绿
- [x] task-02: card-grid 筛选条收拢一张卡（搜索+三筛选+计数同栏）+ 网格 3 列改 2 列 + onStatsChange 回调；既有搜索/筛选用例全绿（行为断言不动）
- [x] task-03: agent-profile-card：默认档案品牌光晕+★默认胶囊；系统预置紧凑整卡（虚线/占位文案两行/只读/空白压 1/3）；新用例绿
- [x] task-04: 提示词左竖线引用式排版（去灰底块）；技能芯片等宽+超 4 项 +N；无技能自定义卡「无技能（不挂载）」占位；新用例绿
- [x] task-05: 卡脚操作降躁（常态 muted 悬停提亮），设/取消默认/编辑/复制/删除回调与不冒泡回归全绿；grep 无新增硬编码 hex（FR-06）
- [x] task-06: 全量回归：card/card-grid/page 三测试文件 + tsc + lint 全绿
- [x] task-07: 实页视觉对照：dev server 三主题截图对比原型（默认光晕/系统紧凑卡/2 列/工具栏卡）落 visual-evidence.md；Docker frontend 重建部署 + 发布记录
- [x] task-08: 卡片墙改按屏宽自适应列数（D-001@v2：auto-fill minmax(380px,1fr)，2K 屏 ≥3 列）——多视口截图验证 + Docker 重建 + 发布记录
