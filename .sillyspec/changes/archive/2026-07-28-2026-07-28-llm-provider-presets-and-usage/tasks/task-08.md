---
id: task-08
title: "新建 frontend/src/components/llm-providers/usage-footer.tsx：多 tier 余额条（逐 UsageData 渲染 plan_name/used/remaining/unit + 进度条 + 重置时间）+ is_valid=false 翻红 + 保留上次成功值 10 分钟（照 cc-switch queries.ts:192 resolveDisplayUsage 纯函数移植）+ 不支持文案「该供应商暂不支持余额查询」（不带 cc-switch 字样）"
title_zh: 新建用量展示组件（多tier余额条+保留上次值+不支持文案）
author: qinyi
created_at: 2026-07-28 10:37:44
priority: P0
depends_on: [task-06]
blocks: [task-09]
requirement_ids: [FR-05, FR-07]
decision_ids: [D-005@v1, D-007@v1, D-010@v1]
allowed_paths:
  - frontend/src/components/llm-providers/usage-footer.tsx
provides:
  - contract: UsageFooter
    fields: [props]
expects_from:
  task-06:
    - contract: UsageResult
      needs: [success, data, error]
    - contract: UsageData
      needs: [plan_name, is_valid, total, used, remaining, unit, extra]
goal: >
  新建用量展示组件，多 tier 余额条逐条渲染，瞬时失败保留上次成功值
  10 分钟，确定性失败翻红，不支持显示中性文案。
implementation:
  - 组件 props 接收 task-06 的 UsageResult（success/data/error）+ 查询状态（loading/查询时间）+ 一个 onRefresh 回调；默认导出 UsageFooter。
  - 成功态逐条渲染 UsageData（多 tier）：plan_name 标题 + used/remaining/unit 数值 + total/used 算出百分比画进度条 + 重置时间放 extra（5h窗/周/月各自一行，照 cc-switch UsageFooter UsagePlanItem block 模式）。
  - is_valid=false 翻红（remaining/plan_name/进度条变红 + 显示 invalid_message），照 cc-switch isExpired 分支。
  - 移植 resolveDisplayUsage（queries.ts:192）为纯函数：用 useRef 持 prevLastGood（{data,at} 快照），Date.now() 注入 now，KEEP_LAST_GOOD_MS=10min；瞬时失败（success:false 但 isTransientUsageError）+ lastGood 在 10min 窗口内 → 展示旧值不翻红；确定性失败（401/403/未知供应商）→ 清空 lastGood 并翻红透出；rejected 标志处理 react-query 缓存旧值（仅窗口内当新鲜）。
  - 不支持用量（detect 不到 / data=null / usageEnabled=false）显示中性灰文案「该供应商暂不支持余额查询」，不报错、不带 cc-switch 字样（D-010）。
  - 加载中显示 spinner（RefreshCw 旋转）；遵循设计系统样式（卡片 border/bg-card/shadow-sm + tabular-nums 数值），前端中文文案。
  - brownfield 新组件，仅 task-09 list 挂载时引用，不改动既有组件。
acceptance:
  - 成功且多 tier：data 数组逐条成行（plan_name/used/remaining/unit + 进度条 + 重置时间）。
  - 瞬时失败（网络/5xx/429）：10min 内展示上次成功值、不翻红、保留刷新入口；超窗后翻红。
  - 401/403 确定性失败：is_valid=false 翻红并清空 lastGood（下次抖动不复活旧值）。
  - 不支持用量：显示中性灰文案「该供应商暂不支持余额查询」，不抛错、全文无 cc-switch 字样。
  - 文案/UI 符合设计系统，中文。
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test src/components/llm-providers
constraints:
  - 保留上次成功值逻辑用纯函数移植 cc-switch resolveDisplayUsage（useRef 持 lastGood + 10min 窗口判定，不引入新状态库）。
  - 全部对外文案不带 cc-switch 字样（D-010）。
  - 遵循设计系统样式（卡片+tabular-nums），数值/单位对齐 cc-switch 渲染。
  - brownfield 新组件，不改既有 list/form/api；依赖 task-06 前端类型契约。
---
