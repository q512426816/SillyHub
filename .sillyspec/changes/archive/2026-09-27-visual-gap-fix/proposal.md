---
author: flow-machine-draft
created_at: 2026-09-26T23:20:17.494Z
---
# 提案书（Proposal）— 2026-09-27-visual-gap-fix

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:d01bb46088a01d25663ab5f6655e05fa7fd1564c88d7d7b508105561b3782233:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-visual-gap-fix 留痕重锚 -->
任务原话转写：线上五页与原型骨架差距修复（D-004 降级矫枉）：工作区卡片重写为 GitHub Repositories 紧凑行式条目（单行状态点+名称+slug+守护标签+计数+时间，props 契约不变）；工作区概览主体改两栏（活跃变更主列+About MetaPanel 侧栏，统计换 StatGrid）；会话门户左栏条目两段式紧凑化。
成功标准：
- 工作区列表每行为单行紧凑条目（无 dl 字段表/独立 footer），hover 显操作，拖拽/别名/重扫/删除行为全部保留
- 概览页呈 统计四格+左主右辅两栏，Hero 之后的旧卡片流结构收敛
- 会话左栏条目高密度两段式，选中态清晰
- 相关测试全绿 + tsc 0
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:8bc640206d8e435e9caef22ed2217e6686ceb4d74032c55dc7d452226de35ab4:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-visual-gap-fix 留痕重锚 -->
按成功标准机械推导，共 4 条验收面：
1. 工作区列表每行为单行紧凑条目（无 dl 字段表/独立 footer），hover 显操作，拖拽/别名/重扫/删除行为全部保留
2. 概览页呈 统计四格+左主右辅两栏，Hero 之后的旧卡片流结构收敛
3. 会话左栏条目高密度两段式，选中态清晰
4. 相关测试全绿 + tsc 0
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:d6307df93d93a765a1c062b7fb868bacd50e5c6b29526b2ce38d6daef56b4bdf:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-visual-gap-fix 留痕重锚 -->
1. 工作区列表每行为单行紧凑条目（无 dl 字段表/独立 footer），hover 显操作，拖拽/别名/重扫/删除行为全部保留
2. 概览页呈 统计四格+左主右辅两栏，Hero 之后的旧卡片流结构收敛
3. 会话左栏条目高密度两段式，选中态清晰
4. 相关测试全绿 + tsc 0
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
