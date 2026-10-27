---
author: qinyi
created_at: 2026-10-26 23:55:00
---

# 渲染对照证据（Visual Evidence）— 2026-10-26-mobile-four-page-layout-fix

> 执行环境无真机/浏览器截图通道，本文件以「改动点 × 预期效果 × 测试断言锚」文字对照形式落盘；用户真机截图复验（verify 收尾动作 NFR-03）补齐视觉实证。全部改动为 className 分支与条件渲染，无 DOM 结构级重排。

## 逐卡对照表

| 卡 | 截图问题 | 改动 | mobile 预期效果 | 断言锚（测试证据） |
|---|---|---|---|---|
| task-01 | ①③ 列表末项被 TabBar 遮 | 外壳 pb 固定 112px → calc(76px+safe-area)；胶囊 bg-card/95+blur → 实底 bg-card | 真机 safe-area(34px) 下避让 110px 末项完整可见；滚动穿行不透字 | mobile-tab-bar.test 10 用例（实底断言） |
| task-02 | ① 控件偏大（根因面） | m-app 密度变量 36px/12px/44px 一处定义 | W3 页面引用后控件降档 | globals.css grep（无裸元素选择器） |
| task-03 | ② 运行状态条右侧被裁 | 宽度基准扣 ml-9（右缘恒溢出 36px 根因修复）+ mobile 隐藏 LIVE | 胶囊完整落在视口内 | marquee 37 用例（3 新增：LIVE 显隐+宽度类） |
| task-04 | ② 轮次胶囊超宽 | mobile 胶囊可收缩折行 + ↑78,489→↑78.5k | 长数字胶囊折行不溢出 | round-divider 13 用例（缩写边界+desktop 锚） |
| task-05 | ② 链路（透传） | TurnTimeline.variant → TurnRow/SegmentedTurnBody.mobile | mobile 会话页真实命中缩写 | token-speed 7 用例（端到端 ↑78.5k 断言） |
| task-06 | ② 模型名「glm-5.3-fla…」截断 | mobile select 110→150px + flex-wrap 折行兜底 | 模型名可读字符数翻倍 | session-config-bar 78 用例 |
| task-07 | ② 占位文字被切 | 排队态 mobile 短句「已排队，结束后自动发送…」 | 430pt 输入框完整显示 | page.test 53 用例（2 新增） |
| task-08 | ④「平台同步」竖排 | mobile 统计块纵向堆叠 | 标题单行不挤 | platform-sync 27 用例（flex-col 断言） |
| task-09 | ④ 搜索框被裁 | 搜索框 w-full 独占一行，按钮折第二行（两 tab 同改） | placeholder 完整可见 | m/changes 28 用例全绿 |
| task-10 | ① 单屏 1~2 卡 | 按钮/筛选 44→36px、三筛选一行、slug+负责人合并 | 单屏 ≥3~4 卡（估算 ~6） | m/workspaces 7 用例全绿 |
| task-11 | ③ FAB 压卡片文字 | 列表末 h-20 spacer（净距 72px+余量）；header padding 微收 | 滚动到底最后卡片完整可见 | m/sessions 13 用例 + header 44px 触控断言不破坏 |

## desktop 零变化锚（PC 端保障证据）

- 全部新 prop（mobile/variant）缺省值 = 既有行为；desktop 锚定用例逐组件断言（marquee LIVE 照旧 / RoundDivider 不缩写单行 shrink-0 / SessionConfigBar 150px 不变 / PlatformSyncSection flex-wrap 照旧 / page.test 53 用例 desktop 占位逐字符不变）。
- 既有测试零改动通过的比例：除 mobile-tab-bar 胶囊形态 1 用例按新契约更新（毛玻璃→实底，本变更设计决策）外，其余全部既有用例未改动通过。
- TurnSegmentViews（PC 悬浮面板宿主）零改动（D-004 裁决）——悬浮宿主形态间接断言：session-panel-variant 22 用例全绿。

## 待用户真机复验清单（NFR-03）

1. 四页面滚动到底：列表末项不被 TabBar/FAB 遮挡（①③）
2. 会话页运行中：状态条完整、轮次胶囊 78.5k 缩写、输入占位短句、模型名可读（②）
3. 变更中心：「平台同步」标题单行、搜索框完整（④）
4. 工作区选择页：单屏 ≥3 卡片（①）
5. PC 端抽查：桌面会话页/变更中心观感与改前一致
