---
author: flow-machine-draft
created_at: 2026-09-30T08:05:20.452Z
---
# 提案书（Proposal）— 2026-09-30-breadcrumb-dedupe-zh

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:ccff787dc04db284573a00a6f7b19c652b6365e8d2cc4ddbb4f3d6308c2909cc:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-breadcrumb-dedupe-zh 留痕重锚 -->
任务原话转写：页内面包屑与外层顶栏面包屑重复，且顶栏面包屑存在英文段名，需去重并统一中文。
成功标准：
- 变更中心列表页页头不再渲染 multi-agent-platform / 变更中心 页内面包屑
- 任务详情页不再渲染 变更中心/changeKey/任务看板/task_key 页内面包屑
- 顶栏面包屑路由段名全部映射为中文（changes→变更中心 等，MCP/Git/API 等专业术语除外）
- 段名中文标签与侧边栏菜单/工作区页签既有命名一致，不新造叫法
- 受影响测试通过（仅跑相关测试，不跑全量）
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:d7a37eb40ba111e60cc30b9cce53cca535a96d91781b3cf30f2fa8a77017de54:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-breadcrumb-dedupe-zh 留痕重锚 -->
按成功标准机械推导，共 5 条验收面：
1. 变更中心列表页页头不再渲染 multi-agent-platform / 变更中心 页内面包屑
2. 任务详情页不再渲染 变更中心/changeKey/任务看板/task_key 页内面包屑
3. 顶栏面包屑路由段名全部映射为中文（changes→变更中心 等，MCP/Git/API 等专业术语除外）
4. 段名中文标签与侧边栏菜单/工作区页签既有命名一致，不新造叫法
5. 受影响测试通过（仅跑相关测试，不跑全量）
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:1143839bf832b400c6a9dc2d8aba3dd511852b35955e180bd4e244166b42e7d8:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-breadcrumb-dedupe-zh 留痕重锚 -->
1. 变更中心列表页页头不再渲染 multi-agent-platform / 变更中心 页内面包屑
2. 任务详情页不再渲染 变更中心/changeKey/任务看板/task_key 页内面包屑
3. 顶栏面包屑路由段名全部映射为中文（changes→变更中心 等，MCP/Git/API 等专业术语除外）
4. 段名中文标签与侧边栏菜单/工作区页签既有命名一致，不新造叫法
5. 受影响测试通过（仅跑相关测试，不跑全量）
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
