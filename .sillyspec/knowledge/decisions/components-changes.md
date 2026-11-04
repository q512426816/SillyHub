# 决策知识 — components-changes

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-components-changes-001@v1 2026-10-15-assets-graph-narrow-typecheck——问题实证（探针法钉死）：`"anchor" in data` 联合收窄在 data 类型经 `env?.available ? env.data ?? null
状态：implemented
变更：2026-10-15-assets-graph-narrow-typecheck
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-15-assets-graph-narrow-typecheck/design.md
文件：frontend/src/components/changes/detail/change-assets-graph.tsx, frontend/src/lib/__tests__/knowledge-graph-guard.test.ts, frontend/src/lib/knowledge.ts
最近确认：未记录
理由：问题实证（探针法钉死）：`"anchor" in data` 联合收窄在 data 类型经 `env?.available ? env.data ?? null : null` 推断链产生时失效——TS 5.5.4 把非 neighbors 成员保留在真值分支并交叉 `Record<"anchor", unknown>`，导致 change-assets-graph.tsx 对 `data.nodes`/`data.edges` 的访问报 TS2339（pre-push ci-fast-gate 首次拦下；同文件同模式的图谱页 page.tsx 因 data 走 `GraphQueryOut["data"]` 参数标注路径而幸免）。与其依赖 `in` 收窄行为怪癖，改为显式类型谓词守卫：knowledge.ts 新增 `isGraphNeighborsData`，change-assets-graph.tsx 改用守卫收窄——谓词收窄不依赖 `in` 语义，行为判定面（`!!d && "anchor" in d`）与原写法等价，组件运行时语义零变化。
