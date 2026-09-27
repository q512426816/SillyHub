---
author: flow-machine-draft
created_at: 2026-09-27T10:15:36.194Z
---
# 提案书（Proposal）— 2026-09-27-session-portal-ia-restructure

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:d00e259d1e28ec5524a05a9fd05df52f5337864e8952ad259c5b187c3c8db514:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-session-portal-ia-restructure 留痕重锚 -->
任务原话转写：会话页面功能太乱、风格不好看，要求结构重组改进。

动机：用户明确反馈会话门户功能组织混乱（中栏头部 9+ 元素挤一行、底部最多 8 层垂直堆叠、同类信息散落多处、左栏筛选区 5 控件纵排、右栏大多时空置），上一轮 core-pages-visual-redesign 仅做展示层样式统一（红线禁动结构），本轮做信息架构重组。

成功标准：
- 三栏全量功能清点清单（100+ 功能点）逐项对照零丢失
- 中栏头部降噪分层（元信息降级为次行）、底部堆叠收敛（用量/任务执行收纳进右栏）、右栏升级常驻详情面板、左栏筛选紧凑化
- 状态机/数据流/轮询/WS 逻辑零改动（仅 render 组织层）
- 三主题 token 化零硬编码色
- 既有测试改断言不改意图全绿，tsc/eslint 零新增
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:53c2420d033eb57a8744893827c4eddbc58046be930b477fa99dd92d027ff042:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-session-portal-ia-restructure 留痕重锚 -->
按成功标准机械推导，共 7 条验收面：
1. 三栏全量功能清点清单（100+ 功能点）逐项对照零丢失
2. 中栏头部降噪分层（元信息降级为次行）、底部堆叠收敛（用量
3. 任务执行收纳进右栏）、右栏升级常驻详情面板、左栏筛选紧凑化
4. 状态机/数据流/轮询/WS 逻辑零改动（仅 render 组织层）
5. 三主题 token 化零硬编码色
6. 既有测试改断言不改意图全绿，tsc
7. eslint 零新增
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:d3e72353bd8ccfa3a45db9c0a85d85664dfaac5656c8b3641913635a0b144232:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-session-portal-ia-restructure 留痕重锚 -->
1. 三栏全量功能清点清单（100+ 功能点）逐项对照零丢失
2. 中栏头部降噪分层（元信息降级为次行）、底部堆叠收敛（用量
3. 任务执行收纳进右栏）、右栏升级常驻详情面板、左栏筛选紧凑化
4. 状态机/数据流/轮询/WS 逻辑零改动（仅 render 组织层）
5. 三主题 token 化零硬编码色
6. 既有测试改断言不改意图全绿，tsc
7. eslint 零新增
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
