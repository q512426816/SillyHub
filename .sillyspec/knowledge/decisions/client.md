# 决策知识 — client

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-11-queue-wakeup-origin-guard
锚点：未记录
最近确认：845aafad21e9a98ee571837f09f648ac2bcd4dcf
理由：最大风险：服务凭证判别依赖「API key 仅管理员签发给 daemon」的既有治理事实——若未来开放普通用户自助 API key，需同步收紧（已在 auth_deps helper 的 docstring 钉死该前提）。 试过但放弃的方案：① 入口拒收/剥离用户前缀——daemon 与用户走同一端点、后端无法按端点区分，剥错方向必伤一边；② 专用内部端点——权限模型里 daemon 的 API key 就是普通 User 权限（runtime owner），无独立服务主体可 gate，新端点同样被用户可达，等于换皮不换实质；③ 内容前缀 + API-key 双条件——省 wire 改动但仍把安全语义绑在内容上，与「结构化判定」的审查结论相悖。
