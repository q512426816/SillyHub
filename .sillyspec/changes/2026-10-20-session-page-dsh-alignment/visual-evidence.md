# 渲染对照证据（visual-evidence）

> UI 触达变更的执行期留档。证据全部为 **dev 路由真实渲染 + 水合后 DOM 导出/截图**（D-017 / D-018：禁止手绘、禁止 SSR 抓稿）；本文件只做「在场 + 对照结论」，不产新证据。
> 生成时间：2026-10-21（execute 期）

## 1. 证据清单（均在本变更目录）

| 文件 | 内容 | 关键实测 |
|---|---|---|
| `proto-final-2026-10-21.png` | 定稿会话页整屏（ai-native 主题，1600×1000） | 22.5KB·1600×1000，正文 15px |
| `proto-final-2026-10-21-turn-gap.png` | 轮间留白对照（28px 留白 vs 旧 hairline） | `turn-block` 无边框、全部带 `pb-7` |
| `proto-theme-blue-2026-10-21.png` | blue 主题整屏（1600×1000） | 正文 14.76:1 / 过程行 3.27:1（均达标） |
| `proto-theme-dark-2026-10-21.png` | dark 主题整屏（1600×1000） | 正文 18.25:1 / 过程行 5.26:1（均达标） |
| `proto-narrow-768-2026-10-21.png` | 窄屏 768×1024（`body[data-variant=mobile]` 生效面） | 正文实测 **14px**（mobile 档压过桌面 15px → 块序约束成立） |
| `proto-trajectory-2026-10-21.png` | 轨迹页整屏（三泳道 + 账本 + 检查器） | `GET /proto/session-trajectory` 200 |
| `proto-trajectory-lanes-2026-10-21.png` | 三泳道时间轴特写（输入/模型/工具） | `trajectory-lane-label` 3、`trajectory-bar` 618 |
| `proto-trajectory-zoom-2026-10-21.png` | 滚轮缩放后视野（刻度补秒 + 刷子位置） | 轴右缘与账本右缘 Δ=0.00px（改前 308px） |
| `proto-file-card-2026-10-21.png` | 文件变更卡（折叠/展开/降级/100 文件四态） | 折叠行 28px、文件行 24px、限高 240px |
| `proto-file-card-100files-2026-10-21.png` | 100 文件长列表态（内滚不顶走正文） | 列表 `max-h-[240px]` 内滚 |
| `prototype-session-final.html` | 定稿静态稿（水合后 DOM） | `.wmde-markdown` 138 / `turn-meta-detail` 20 / `turn-block` 20 全带 `pb-7` 无线 / `<template>` 0 / script 1 / link 0 |
| `prototype-session-trajectory.html` | 轨迹页静态稿（泳道形态） | 2,924,039B / 856 行账本 / 618 bar / 1 段 vanilla shim |
| `prototype-file-changes.html` | 文件卡离线稿（`--with-js`） | 561,812B / 1 段 shim / 7 处 `file-changes-card` |
| `prototype-ab-annotated.html` | A/C 双形态标注对照（2.04MB，留档） | 单文件零网络 |

## 2. 对照结论（逐条对 design / 用户裁决）

1. **线 A 五处层次问题（D-016）**：轮元信息合并为一行（`turn-meta-detail` 20 处、对话视图 0 处独立行）；正文与过程分级（正文 15px/1.8，过程 11.5px + `muted-foreground/80`）；工具行去框改 2px 左规线；用户气泡降噪（`primary/[0.08]` + 56% 宽）；左栏 chip 统一 9px + 轮数右贴。→ 与 `prototype-session-final.html` 逐项一致。
2. **轮间节奏（D-020）**：20 个 `turn-block` 中带 hairline 的 **0** 个、缺 `pb-7` 的 **0** 个 → 「只留白不画线」成立。
3. **三主题（D-015@v2）**：ai-native / blue / dark 三张整屏截图均渲染成功，语义 token 无写死色值；对比度正文 ≥14.76:1、过程行 ≥3.27:1，**无需回退 `/90`**（R-01 处置路径不触发）。
4. **窄屏（R-03）**：mobile 字阶生效（正文 14px），但**布局**为现状缺陷（AppShell 桌面壳 + 320px 左栏未折叠，中栏被压到 ~188px、正文严重折行）——按 R-03「本变更不承诺窄屏观感达标」仅留档。
5. **轨迹（D-024/D-026）**：三泳道共享绝对轴、缩放/平移/刷子/命中带在场；轴与账本右缘 Δ=0.00px；模型覆盖 53.3min（9.2%）、条数 183。模型泳道口径标注两态：有 timing → 「真实占用」、无 → 「近似（无 TTFT 采样）」（D-032 说明实际恒 approx）。
6. **文件变更卡（D-023）**：折叠 28px / 展开 24px / 限高 240px 与原型一致；降级态「仅工具编辑」、`partial` 行级破折号、`binary` 破折号、`sharedWorkspace` 恒显并行会话横幅——与卡面原型（`prototype-file-changes.html`）同形态，数据链路为 1b 真实快照。
7. **沉浸感基线**：桌面三档主题下整屏信息层级（左栏 / 会话流 / 输入区）与 DSH 参照一致；无一处使用写死色值（`frontend/src/components/daemon/**` 与 `file-changes/**` 零 hex/rgb 字面量）。

## 3. 未覆盖 / 已知缺口

- 768 窄屏**布局**（见 §2.4）——现状留档，不在本变更范围。
- 轨迹视图目前只挂在 `/proto/session-trajectory`（dev-only），产品 `/sessions` 页未接轨迹档 1（design 非目标）。
- 「真实占用」文案下 daemon 自标 `basis="approx"`（D-032）：当前 UI 按「有 timing 即 observed」渲染，与 daemon 侧口径存在 1 档偏差，已在发布说明与 decisions 披露。
