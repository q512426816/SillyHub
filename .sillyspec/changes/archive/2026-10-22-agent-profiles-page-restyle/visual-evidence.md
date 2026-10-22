# 视觉证据（Visual Evidence）— 2026-10-22-agent-profiles-page-restyle

> 实页渲染对照定稿原型（`.sillyspec/explore/prototype-agent-profiles-page-restyle.html`，
> 用户四轮反馈定稿：2×2 网格 → 系统预置紧凑整卡 → 空白压 1/3）。
> 验证：frontend dev server（next dev -p 3001，后端 docker :8000）真实渲染
> `/agent-profiles`，DOM 断言 + 截图视觉模型核验。

## 实页核验结论（暗夜主题截图 artifacts `call_…-b6eaf8d8…png`）

| 核验项 | 结果 |
| --- | --- |
| 页头 ◆图标+标题+副标题+统计胶囊「共 4 个档案 · 默认 1」（数字高亮）+新建按钮 | PASS（视觉模型逐项确认） |
| 工具栏卡：搜索+三筛选+「共 4 个档案」计数同栏收拢 | PASS |
| 卡片墙按屏宽自适应列数（`repeat(auto-fill, minmax(380px, 1fr))`：2K 5 列 / 1280 两列 / 窄屏单列，task-08 D-001@v2） | PASS（DOM 断言 + 多视口截图） |
| 默认档案品牌光环（border-brand-300 + ring-brand-300/50）+「★ 默认」胶囊 | PASS（DOM 断言：ring-brand-300/50、★ 默认 在场） |
| 系统预置紧凑卡：虚线/★头像/「（未设置系统提示词，按引擎默认人设执行）」/「按引擎默认能力执行」/只读/无操作按钮 | PASS（DOM 断言 + 视觉确认，高度约为大卡 2/3） |
| 提示词左竖线引用式（去灰底块）；技能芯片 +N 截断；操作链接灰色降躁 | PASS |
| onStatsChange 单源上报（pill=共 4 个档案 · 默认 1） | PASS（DOM 断言） |
| blue 主题抽查（登录默认态） | PASS（无错配，随主题换色） |

## 评审 P1 修复（2026-10-23，汇总上报自激）

独立评审判定 FAIL（1×P1）：`agent-profile-card-grid` 的统计上报 effect 依赖 `profiles`
数组引用，而 hook 在数据未就绪时返回 `q.data ?? []`（每次渲染新建空数组）——上报 →
父页 setStats → 重渲染 → 再上报形成自激；且 effect 在 loading/error 早退之前，加载期
会用 0/0 覆盖胶囊。修复：

- grid：改为依赖原始值 `[loading, error, profiles.length, defaultCount]`（defaultCount
  经 useMemo 计算），loading/error 分支直接早退不上报；
- page：`handleStatsChange` 用 `useCallback` 稳定引用 + setStats 等值短路（值未变保持
  原 state 引用）；
- 新增 2 个回归用例（grid 测试）：loading 不上报、数据到达后上报 {total, defaultCount}。
  修复后 4 文件 45 用例全绿、tsc 0、eslint 0 error。

## 复审 P3 修复（2026-10-23）

- 芯片边框 `border-border-soft` 改为已定义的 `border-border`（前者无 token 定义，回退
  currentColor；全仓仅此一处使用）。
- 「设为默认」用例补 `onPreview` 未调用断言，与其余四项操作的不冒泡口径一致（FR-05）。

## 三主题证据边界（FR-06）

- 实页截图覆盖：暗夜主题（完整核验）+ blue 主题（登录默认态抽查）；
- ai-native 浅色主题：本机后端容器当前不可用（:8000 502），未能补拍实页截图。该主题
  的配色正确性由取值单一源保证——所有新增颜色类均为 `brand-*`/语义 token 或 CSS 变量
  引用（grep 无新增 hex），随 `html[data-theme]` 换肤，与暗夜/blue 同一套 token 链路；
- 残余：ai-native 主题实页截图待后端可用时补齐（不影响本变更样式实现与既有断言）。

## 与定稿原型的等效实现决策（非降级）

1. 工具栏计数沿用既有文案「共 N 个档案（已从 M 个筛选）」并移入工具栏右端——原型的
   「匹配 N / 4」为新措辞，保持既有断言锚与语义兼容。
2. 默认档案光环用 `ring-1 ring-brand-300/50` 替代原型 box-shadow 光晕——tailwind token
   化等价（无 hex），观感一致。
3. 系统预置紧凑度：占位区去两行储备+内边距收紧（实测高度约为大卡 2/3，原型为 ~80%），
   属原定「压至约 1/3（空白部分）」的落地口径。

## 用户裁决记录

- 原型四轮反馈定稿：①3 列孤卡太空 → 2×2；②系统卡空壳 → 横条（太窄否决）→ 紧凑整卡
  +提示文案；③空白再压至 1/3。用户确认「可以 开始」进入实现（flow approve --user-confirmed）。
- 实现中无视觉降级（仅上列等效实现决策）。
