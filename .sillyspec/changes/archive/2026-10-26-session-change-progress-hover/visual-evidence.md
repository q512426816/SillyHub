# 视觉证据（visual-evidence）— 2026-10-26-session-change-progress-hover

> UI 触达变更的渲染对照证据（execute 期落盘，verify 收口验在场）。

## 证据 1：真实渲染捕获原型（主证据）

- 产物：`prototype-session-change-progress.html`（变更目录内，31 行骨架 + 五区块组件渲染产物）。
- 通道：**真实渲染捕获**（design R-06 三通道之一）——`react-dom/server renderToStaticMarkup` 渲染已落地组件（change-progress-row.tsx / change-total-progress-ring.tsx），非手绘；临时生成器跑完即删（不留测试面）。
- 五区块：全量 5 圈主路径（占比/打勾/耗时/execute 任务 8/12）/ 异常态（revising 修订2 + failed 异色状态字）/ 轻量 ①②③ 相位行（executing·已批准·任务 4/12·总时长 3.0时）/ 升厚切换（已升厚→走全量 + 自头脑风暴转入）/ 入口总圈（全量 42% + 轻量 47%）。
- 素材来源声明在原型文件头注释（token 源 themes.ts 语义阶 / 组件来源 / 入口位置）。

## 证据 2：组件测试断言（DOM 结构层）

- `change-progress-row.test.tsx` 14 用例：data-testid 锚（progress-circle-* / progress-task-count / progress-thin-phase-* / progress-upgraded-tag）+ 异常态文字（等待中/修订2/失败）+ 降级不渲染。
- `change-total-progress-ring.test.tsx` 21 用例：stroke-dasharray 按比值填充（2πr×ratio 精确断言）+ 中心百分比文字 + aria-label 文本化。
- `session-change-files-hover.test.tsx` 14 用例：进度行内嵌/归档不挂 + 徽标双态 class（bg-blue-600 / bg-emerald-600）+ 总圈挂载与缺失降级。

## 证据 3：多主题口径（静态核对）

- 组件输出类名全走语义 token（stroke-brand-500 / text-brand-600 / stroke-border / bg-warning / bg-error / text-success / text-muted-foreground），无裸 hex；blue-600 仅计数徽标一处（D-012@v2 真信息蓝固定阶，不随主题换肤）。测试断言徽标双态 class（change-files-hover.test.tsx「计数徽标双态」用例）。
