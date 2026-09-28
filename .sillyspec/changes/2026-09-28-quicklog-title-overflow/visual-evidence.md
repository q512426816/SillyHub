# 视觉证据（Visual Evidence）— 2026-09-28-quicklog-title-overflow

## A. 基准（修复前，生产实测）

- 环境：生产 crrcdt.ppdmq.top，sillyspec 工作区（c84182bc）快速修复（存量）tab，搜索"2026-09-24-b"，Chromium 1600×900
- 用户实证截图（钉钉传图）与本侧复现截图比对确认同型：标题列灰色长文越过单元格压进负责人/影响模块/执行/时间列
- 量化（Playwright `getBoundingClientRect`，逐单元格扫描）：
  - 标题 span（block truncate）elRight **875** > 所在单元格 cellRight **854**（越界 21px，窄视口更甚）
  - ql_id mono 行同类越界；表格 20 行中 8+ 个文本元素越界
- 截图：`before-prod-quicklog-1600.png`（本目录）

## B. jsdom 回归锁定

- quicklog-table.test.tsx 追加 3 用例：fixed 布局内联样式锚（table 元素 table-layout=fixed）/ 标题按钮 block w-full min-w-0 类名锚 / 状态备注外层 flex + max-w-full truncate 结构锚
- 19/19 绿（16 既有 + 3 新增）；tsc 0 错；flow done lint 门禁 ruff/mypy/pnpm lint/typecheck 全过

## C. 部署后原生复测

- （部署后填写）

## 降级裁决

无视觉降级——fixed 布局为显式设计取舍（定宽列严格执行、标题列分得剩余宽度），420px 宽屏上限保留作者原意，极窄视口裁切风险已在 design 槽4 声明（本表仅桌面消费，移动端另有独立页面）。
