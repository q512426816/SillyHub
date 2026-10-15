# 决策知识 — runtime-handler

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-09-graph-text-backslash
锚点：未记录
最近确认：4fa6ce567d22b4d41f5b07583630510edd340a77
理由：最大风险：合法锚点若含反斜杠会被误拒——已核正常节点 id 字符集（/ # : @ - _ . 与中文，实测样本 decision:decisions/x.md#D-1@v1、src/foo.js、FR-core-engine-001）零含反斜杠，Windows 路径形态锚点本就带 : 与 \ 会被拒，但该形态从不在合法锚点域（用例 ③ 钉住放行面）。试过放弃：(a) 拼串侧对反斜杠做 shell 转义——放弃，黑名单字符级拒绝是与既有 9 类元字符同构的消毒语义，混入转义逻辑引入「部分放行」面；(b) 只拒尾反斜杠——放弃，字符级黑名单无法表达位置语义且中缀形态同样可疑，全拒更保守一致。
