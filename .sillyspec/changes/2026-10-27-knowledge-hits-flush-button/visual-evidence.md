# UI 视觉证据 — 2026-10-27-knowledge-hits-flush-button

## 变更面

「📦 沉淀资产」卡（变更详情页主栏）新增**一处** UI：展开区顶部右对齐操作行的「同步变更」小按钮（chip 形态：`rounded-full border border-border/60 px-2.5 py-0.5 text-[10px]`，主题 token 类，随双主题换肤；hover 走 brand-300/brand-50 语义阶）。既有六分组、卡头、弹窗零改动——按钮位落展开区顶部独立行而非卡头，因卡头整块是折叠 `<button>`（HTML 禁止 button 嵌套）。

## 形态与交互（真码实现，非手绘原型）

- 常驻显示（不随分组空态隐藏）：归档变更「知识触达空但 total>0」的断流形态没有空态文案可挂，常驻入口才能兜住补数场景（design「做法概述」第 3 件）。
- pending：文案「同步中…」+ `disabled:cursor-not-allowed disabled:opacity-50`（防连点）。
- 回执三态提示（antd message）：成功（含 in_flight 去重秒回文案区分）/ 未触发 warning（离线·未绑定等人话原因）/ 失败 error；成功后 invalidate `changeAssets` 查询整卡刷新。
- `title` 悬停说明：把本机执行期的知识注入命中遥测上报平台，补齐「知识触达」（需绑定的机器在线）。

## 验证证据

- 交互测试 5 用例全绿（`frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx`「ChangeAssetsCard：同步变更按钮」组：成功+invalidate 刷新 / in_flight 文案 / 离线 warning / upload_failed error / pending 禁用防连点），41/41 passed。
- 布局回归：既有 36 用例（四组渲染/空态/失败降级/跨仓清单等）全数通过，零视觉回归（展开区 fragment 包裹不改变原 DOM 树序）。
- 降级面无视觉态变化：端点所有失败路 HTTP 200 结构化回执，卡片本身不进入错误态（与主查询失败降级路径互不影响）。

## 降级裁决

无视觉降级——按钮形态按设计落地，未发生结构收敛/范围缩小/样式统一级偏差。
