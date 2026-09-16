---
author: WhaleFall
created_at: 2026-09-04 13:58:00
---

# components_daemon 模块变更索引

- ql-20260904-019-b4f4 | machine-card sillyspec_update 横幅四态扩五态——新增 up_to_date（success 色阶 CheckCircle2「已是最新版（X），无需升级」+ 副行说明点击时检查过版本、10min 自动消失），daemon 手动升级已最新的明确反馈终态；补横幅用例（45/45 绿，tsc 0）
- ql-20260916-005-0fc5 | 会话页进入 /runs 请求扇出收敛——onTurnCompleted 刷新类副作用（runsMeta 快照/用量信号/队列/列表）改「同 run 首条 turn_completed」门控（历史回灌终态轮播种 completedSideEffectRunIdsRef，首连对账/5s 复核的重放合成不再逐条扇出，修进入瞬间 ~2T 条并发）；失败轮错误详情拉取 in-flight 共享（同批 F 个失败重放收敛 1 条）；runsPromise 经 runsSnapshot 注入 streamSession（缺口同步复用不自拉）。新增回归 session-panel-runs-request-dedup（4 用例：重放不扇出/新完成照常/失败共享/注入透传），相关面 230+39 用例绿，tsc 0
