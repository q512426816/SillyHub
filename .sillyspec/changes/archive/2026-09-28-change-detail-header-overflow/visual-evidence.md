# 视觉证据（Visual Evidence）— 2026-09-28-change-detail-header-overflow

## 基准（修复前，生产实测）

- 环境：生产 crrcdt.ppdmq.top，变更 `fr-review-batch`（e07474ed，描述 282 字），Chromium 1600×900
- 现象与用户截图一致：详情页头部灰色描述一行拉通无省略号，页面底部横向滚动条
- 量化（Playwright `getBoundingClientRect` / `documentElement`）：
  - `scrollWidth 2219 > clientWidth 1600`（横向滚动成立）
  - 溢出链：header 1228px → 左列 div（无 min-w-0）**1861px** → 描述 span 盒 1861px、`clipped=false`
- 截图：`before-prod-1600.png`（本目录）

## 修复验证 A：生产现场注入（部署前预验证）

在未部署修复的线上页面，用 `el.style.minWidth = "0px"` 现场注入两处修复（PageHeader 左列 + 详情页标题 span）：

| 断言 | 注入前 | 注入后 @1600 | 注入后 @1280 |
|---|---|---|---|
| scrollWidth vs 视口 | 2219 > 1600 ❌ | 1600 == 1600 ✅ | 1280 == 1280 ✅ |
| 左列宽度 | 1861px（溢出） | 1186px ✅ | 866px ✅ |
| 描述行截断 | 无省略号 | 省略号截断 ✅ | 省略号截断 ✅ |

## 修复验证 B：jsdom 回归锁定

- 新增 `frontend/src/components/layout/__tests__/page-header.test.tsx`（3 用例）：左列 min-w-0 类名锚 + 详情页同款长描述收缩链结构断言 → 3/3 绿
- 详情页既有测试 `changes/[cid]/__tests__` 3 文件 28 用例全绿；`tsc --noEmit` 0 错

## 修复验证 C：部署后原生复测（2026-09-28 23:05，镜像 COMMIT_SHA=389282de4）

- 部署：本地 build-and-save（PROD_API_URL=https://crrcdt.ppdmq.top）→ scp → load-and-up.sh，容器 healthy
- 详情页 fr-review-batch（描述 282 字）无任何注入实测：
  - @1600：`scrollWidth 1600 == clientWidth 1600`（横向滚动清零），左列 `min-w-0` 类在位、宽 1186px，描述行省略号截断 ✅
  - @1280：`scrollWidth 1280 == clientWidth 1280`，左列 866px，截断 ✅
- 列表页回归：无横向滚动、6 行 0 叠压（上一轮列表修复不受影响）✅
- 截图：`after-prod-1600.png`（本目录）

## 降级裁决

无视觉降级——改动仅补 flex 收缩约束，对正常宽度内容零视觉影响（41 个 PageHeader 使用方同语义）。
