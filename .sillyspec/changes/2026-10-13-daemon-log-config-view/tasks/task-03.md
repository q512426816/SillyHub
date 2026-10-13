---
id: task-03
title: '前端诊断弹窗（测试先行同卡 + 文档同步）——machines.ts client + 弹窗组件 + 机器卡入口 + page 串联 + vitest'
title_zh: '前端诊断弹窗（测试先行同卡 + 文档同步）——machines.ts client + 弹窗组件 + 机器卡入口 + page 串联 + vitest'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-13 17:07:07
priority: P0
depends_on: ['task-02']
blocks: []
related_tests:
  - frontend/src/components/daemon/__tests__/machine-card.test.tsx
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08]
decision_ids: [D-001@v2, D-002@v1, D-003@v1, D-007@v1]
allowed_paths:
  - frontend/src/lib/daemon/machines.ts
  - frontend/src/components/daemon/daemon-diagnostic-dialog.tsx
  - frontend/src/components/daemon/machine-card.tsx
  - frontend/src/components/daemon/__tests__/machine-card.test.tsx
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - frontend/src/components/daemon/__tests__/daemon-diagnostic-dialog.test.tsx
target_files:
  - frontend/src/lib/daemon/machines.ts
  - NEW:frontend/src/components/daemon/daemon-diagnostic-dialog.tsx
  - frontend/src/components/daemon/machine-card.tsx
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - NEW:frontend/src/components/daemon/__tests__/daemon-diagnostic-dialog.test.tsx
goal: >
  在 /runtimes 机器卡新增「日志」「配置」入口并实现诊断弹窗（双 Tab：日志尾部查看/配置掩码查看），
  覆盖五类边界态提示与下载（配置恒脱敏，D-007）；完成模块文档同步。测试先行同卡。
implementation:
  - 先写 frontend/src/components/daemon/__tests__/daemon-diagnostic-dialog.test.tsx（红）：双 Tab 渲染/掩码态展示与遮蔽字段高亮/「显示明文」切换触发 reveal 重新拉取（明文态下载仍脱敏，D-007）/422 升级提示条/exists:false 前台运行提示/truncated 提示/离线错误条/下载触发（log 片段与脱敏 JSON）
  - frontend/src/lib/daemon/machines.ts：新增 fetchMachineLogTail(instanceId, tail) 与 fetchMachineConfig(instanceId, reveal)——沿用 apiFetch 风格，错误由 frontend/src/lib/api.ts 的 ApiError（持 status/code）承载，弹窗按 status===422 || code==='HTTP_422_DAEMON_DIAG_UNSUPPORTED' 判定升级提示
  - 新建 frontend/src/components/daemon/daemon-diagnostic-dialog.tsx：antd Modal 双 Tab（日志：行数 Select 100/500/2000+刷新+下载片段+元信息行+等宽滚动区自动滚底；配置：只读标注+JSON 展示掩码高亮+明文切换+下载按钮——恒以 reveal=false 取数不复用明文 state）；五类边界态提示条（422/exists:false/truncated/离线/401-403-404 通用错误条）；下载用 Blob 模式（先例 frontend/src/lib/explorer.ts:105-109）
  - frontend/src/components/daemon/machine-card.tsx：操作区新增「日志」「配置」按钮（机器离线时空态禁用+tooltip）+ 新增 onOpenDiagnostic 可选 prop（optional——既有 machine-card.test.tsx 用例的 typed defaultProps 免改）
  - frontend/src/app/(dashboard)/runtimes/page.tsx：顶层 state diagTarget（值为 {instance, tab} 或 null）串联弹窗（对齐 aliasEditing 模式 :1084/:1510），machine-card 传回调
  - 模块文档同步（module-map 相关模块 md 更新）；跑 frontend 测试与 typecheck 全绿
acceptance:
  - daemon-diagnostic-dialog.test.tsx 全绿（双 Tab/掩码切换/明文态下载仍脱敏/五类边界态/下载触发）
  - frontend 全量 vitest 通过（含既有 machine-card*/runtimes 页用例，onOpenDiagnostic 可选设计保其不回归）+ pnpm typecheck 零错误
  - UI 全中文、只读标注在场（D-003）；无配置编辑入口
verify:
  - cd frontend && pnpm test
  - cd frontend && pnpm typecheck
constraints:
  - 不改既有 MachineCardProps 必填面（新 prop 可选）；如个别既有用例因新增按钮渲染而需微调，改动限 machine-card.test.tsx 内
  - 不引入新第三方依赖；样式走既有 antd + tailwind + brand-* 语义色（AI-Native 双主题）
  - 下载恒脱敏（明暗态一致，D-007）；默认打开不请求 reveal=true（默认路径不传明文）
---
