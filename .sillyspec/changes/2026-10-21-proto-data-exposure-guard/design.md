---
author: flow-machine-draft
created_at: 2026-10-20T23:36:08.889Z
---
# 设计记录（Design Record）— 2026-10-21-proto-data-exposure-guard

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

三步收口两条风险：①真实会话导出数据从 `frontend/public/__proto/` 移至 `frontend/.proto-staging/`——Next.js 只静态服务 `public/`，移出即断「免鉴权可下载」暴露通道，且该目录不进构建产物（数据从此物理上无法随部署分发）；②`staged-session-export.ts` 读取路径常量随迁（`["public","__proto",...]` → `[".proto-staging",...]`），`view.tsx` 移除对 public URL 的运行时 fetch 兜底（数据不在可 fetch 面，兜底成死码），4 处注释同步真实位置；③根/前端 `.gitignore` 补 `/.tmp/`、`backend/pytest-of-*/`、`frontend/.proto-staging/`、`frontend/public/__proto/`、`*.TMP`——审查实证这五类残留全部裸奔在 untracked 面，多 agent 共享仓下「禁目录级 add」只是纪律，gitignore 才是机制。

选「移出」而非「脱敏后留 public/」：导出含 1271 条真实日志，逐条脱敏成本高，而 dev 预览恰恰依赖真实文本形态（字号/密度/长文本折行都是评审对象）；移出服务面零成本达成同等安全目标，SSR 读盘路径保留真实数据可用性。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `loadStagedSessionExport()`（frontend/src/app/proto/session-redesign/staged-session-export.ts）：对外签名与返回类型零变化（`StagedSessionExport | null`，shape 校验三条件不变）；唯一变化=读取位置由 `public/__proto/session-export.json` 改为 `.proto-staging/session-export.json`（相对 `process.cwd()`，Next dev cwd=frontend 不变）。
- `view.tsx` ProtoPage：移除 `payload===null` 时的 `fetch("/__proto/session-export.json")` effect——SSR 未读到即恒占位符（该兜底原就与 SSR 读同一份文件，文件在则 SSR 必中，兜底实际不可达；移除后行为差异仅剩「SSR 失败且文件在」这一原就自相矛盾的场景）。
- 无 API 端点/命令/文件格式变化；数据文件本身原样搬移（字节不动）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不适用——纯文件位置迁移与读取路径常量替换，无事件流/时序假设；SSR 读盘是请求时同步行为，与「文件先在或后到」无交错面（后到=下次请求生效）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   主要并发面不是文件写，而是**共享仓并行变更**——被改的 4 个 proto 文件属进行中变更 2026-10-20-session-page-dsh-alignment 的未提交交付物，其会话可能同时在编辑。缓解：改动压到最小（1 常量 + 1 effect 删除 + 注释），Edit 前已重读最新态，且该变更尚未 flow start（无 tasks.md），spec 层无冲突。数据文件本身只读（人工 staging 放盘），无双写。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   staging 文件缺失/损坏时 `loadStagedSessionExport` 维持既有 fail-soft（try/catch → null），页面占位不崩——容错语义与迁移前逐字节一致；dev server 运行中放/移文件，下次请求按新状态读取。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   `.proto-staging/` 界定在 frontend/ 内且 gitignore 覆盖——不进 git、不进构建、不随部署分发；多机/多实例各自本地 staging 天然不串台（数据本就不随仓走）。`backend/pytest-of-*/` 与 `/.tmp/` 同理是各机本地产物。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险=与 dsh-alignment 进行中变更的未提交文件并发编辑冲突（同文件他侧再改会覆盖或被覆盖）。缓解如上（最小 diff+重读后编辑）；若其后续提交流程发现路径常量被改，本变更档案即依据说明。

试过但放弃的方案：
- 「留在 public/、仅靠纪律不提交」——否决：纪律防线（AGENTS.md 规则 11）挡不住任何一次目录级 add 失误，且 dev server 当下就在免鉴权 serve 真实数据；
- 「脱敏/裁剪后留 public/」——否决：脱敏成本高且 dev 预览依赖真实文本形态，移出服务面零成本等价；
- 「给 /proto 路由加 NODE_ENV 门禁」——本次不做：数据移出 public 后，生产构建里 staging 文件不存在（gitignore 挡提交），/proto 路由最多渲染空占位壳、无数据可泄；路由门禁属 dsh-alignment 变更已登记的 D-010 故障面决策，留其定稿时处置，本变更不越权改其交付语义。
