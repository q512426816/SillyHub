---
author: flow-machine-draft
created_at: 2026-10-12T00:18:35.482Z
---
# 设计记录（Design Record）— 2026-10-11-assertion-surface-guard

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

共享断言面漏同步钉子测试是复发 4+ 次的模式，提醒性手段（源码注释 + knowledge 条目，2026-10-08 登记）实证拦不住——本周 CI 清偿又见四处漏跟（迁移锚/TABS 数/菜单声明序/MSG 计数）。修法：机制化闸门前置到提交时刻——`scripts/check-assertion-surfaces.py`（Python stdlib，纯函数 evaluate 与 git 管道分离便于单测）实现 8 条规则（六面清单 + 本周新登记⑦⑧），挂进既有 pre-commit 框架（backend/.pre-commit-config.yaml，check-only 与 ruff 双钩同款）。选 pre-commit 而非 CI：漏同步在提交时刻拦下成本最低（修 1 次提交面），CI 拦下要等全量跑完；选 fail-closed 而非警告：警告类（注释/知识注入）已被实证无效，仓库规则 10 本就禁止绕钩。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

新增：scripts/check-assertion-surfaces.py（CLI：无参，读 staged 面，exit 0/1）；backend/tests/test_check_assertion_surfaces.py（pytest 单测 12 例）；backend/.pre-commit-config.yaml 增 assertion-surfaces 钩子（always_run、check-only）。行为变化 = 触碰 8 断言面源文件而未同步配对钉子测试的 git commit 会被拦（本地 pre-commit 生效；CI 不跑 pre-commit，行为不变）。既有生产代码/端点/格式零变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不适用——闸门只看本提交 staged 面（git diff --cached 快照），无跨提交/事件序假设；拆两提交分别改源和改测试会被拦（这正是设计语义：同步必须在同一提交）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   并行会话共享仓各写各的 index 场景：pre-commit 只读自己的 staged 快照，脚本全程只读（check-only 不改文件不写盘），与既有 ruff 双钩同安全面；并行会话各自提交互不感知对方 staged 面，属 git 既有语义非本闸新增风险。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   不适用——单进程短命脚本，无状态；被拦时工作区零改动（提示面明示 check-only），中断/重试无残留。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   规则路径全部为仓库相对路径（backend/、frontend/、sillyhub-daemon/ 前缀锚定），worktree 场景下 git diff --cached 天然限定本 worktree；无跨仓读取。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：DIFF 内容锚的误拦（注释/重构碰巧命中锚形态）逼开发者做无意义测试 touch 或生绕心——已用窄锚压制（⑧要求常量形态 `^\s*[A-Z_]+: 'daemon:`、③要求 TABS 条目行 `\{.*key:.*path:`），残余误拦属低频且指引面给了处置话术；长期若误拦率高再按面加白名单。第二风险：规则清单三处登记（knowledge/脚本 RULES/源码注释）漂移——已在三处互指并写进通用口径登记约定。放弃的方案：①CI 侧拦（后端全量 20 分钟才见红，反馈太迟，且 daemon/前端 CI 还要各配一份——不做）；②husky/自写 .git/hooks（仓库已用 pre-commit 框架，另起炉灶双轨维护——不做）；③白名单豁免机制（--force/SKIP 类）——规则 10 禁绕钩，加豁免口子等于劝人绕（不做，真需豁免时改脚本规则走评审）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 新增 | scripts/check-assertion-surfaces.py | 8 规则闸门脚本（evaluate 纯函数 + git 管道） |
| 新增 | backend/tests/test_check_assertion_surfaces.py | 单测 12 例（importlib 加载先例） |
| 修改 | backend/.pre-commit-config.yaml | assertion-surfaces 钩子（check-only/always_run） |
| 修改 | .sillyspec/knowledge/testing-gotchas.md | 登记⑦⑧ + 通用口径补机制化闸门 |
| 修改 | sillyhub-daemon/src/protocol.ts | 断言面⑧同步提醒注释 |
| 修改 | frontend/src/lib/menu-permissions.ts | 断言面⑦同步提醒注释 |
