# 决策知识 — lib-menu-permissions

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-11-assertion-surface-guard
锚点：未记录
最近确认：1371e6516cb78420290369d5147f25f16f951350
理由：最大风险：DIFF 内容锚的误拦（注释/重构碰巧命中锚形态）逼开发者做无意义测试 touch 或生绕心——已用窄锚压制（⑧要求常量形态 `^\s*[A-Z_]+: 'daemon:`、③要求 TABS 条目行 `\{.*key:.*path:`），残余误拦属低频且指引面给了处置话术；长期若误拦率高再按面加白名单。第二风险：规则清单三处登记（knowledge/脚本 RULES/源码注释）漂移——已在三处互指并写进通用口径登记约定。放弃的方案：①CI 侧拦（后端全量 20 分钟才见红，反馈太迟，且 daemon/前端 CI 还要各配一份——不做）；②husky/自写 .git/hooks（仓库已用 pre-commit 框架，另起炉灶双轨维护——不做）；③白名单豁免机制（--force/SKIP 类）——规则 10 禁绕钩，加豁免口子等于劝人绕（不做，真需豁免时改脚本规则走评审）。
