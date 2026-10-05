# 视觉验证记录（visual-evidence）— 2026-10-05-promo-film-page

- 验证日期：2026-10-05
- 验证环境：Windows 10 · ZCode 内置浏览器（Chromium 内核，视口 1600×900，DPR 适配）
- 验证方式：本地 HTTP 服务（127.0.0.1:8791）加载 `docs/promo/sillyhub-promo.html`；
  页面内注册调试句柄 `window.__promoFilm`，脚本化 seek 驱动确定性渲染逐点采样 + 截图 + 视觉模型逐张审读 + 真实点击交互。

## 1. 全时间轴渲染扫描（JS 异常）

- 方法：`for t in 0..98 step 0.25 → __promoFilm.seek(t)`，捕获渲染异常（393 个采样点，覆盖 8 幕全部代码路径）。
- 首轮扫描发现 2 个缺陷（见 §4），修复后复扫：**0 异常 / 393 点**。
- 结论：全片任一时刻 seek 均可精确重放（确定性渲染成立）。

## 2. 画面视觉验收（截图 → 视觉模型审读）

截图存于本目录 `evidence/`（JPEG q78）：

| 截图 | 时间点 | 审读结论 |
|---|---|---|
| 00-poster.jpg | 海报页 | 标题/副标/口号/播放按钮/五枚元信息胶囊齐全，紫青渐变品牌视觉，无乱码无缺陷 |
| 01-cold-6.2s.jpg | 第 1 幕 6.2s | 终端告警窗口（红黄绿窗点+逐行输出）、右侧混沌粒子群（紫青红+碰撞火花）、代码字符背景、底部字幕「可没人说得清…」正常 |
| 02-title-15.5s.jpg | 第 2 幕 15.5s | SillyHub 大标题渐变+辉光、青色下划线光束、中文副标（带字距）、口号、底部三枚价值徽章正常 |
| 03-spec-26s.jpg | 第 3 幕 26s | 五节点流水线（brainstorm→archive 英文名+中文名+图标）、连接进度线、评审门「✓ 评审」、底部字幕正常 |
| 04-arch-41s.jpg | 第 4 幕 41s | 浏览器→backend·FastAPI→三数据库圆柱（PostgreSQL/Redis/MinIO）、右侧 daemon+「开发者的电脑」括注+Agent 芯片、连线与脉冲正常 |
| 05-agents-56s.jpg | 第 5 幕 56s | 中心六边形 hub(S)+12 个 Agent 芯片全部可读（claude…openclaw）、底部三条 worktree 车道+main 干线正常 |
| 06-live-69s.jpg | 第 6 幕 69s | LIVE·SSE 日志流（[agent]/[tool]/[test]/[spec] 彩色前缀）、右上拓扑、右下三列看板正常 |
| 07-team-81s.jpg | 第 7 幕 81s | RBAC 盾+三角色芯片环绕、双层审批门（工具级/阶段级+✓ 印章）、项目 A/B/C 隔离箱、字幕正常 |
| 08-outro-95s.jpg | 第 8 幕 95s | 六边形 S logo、$ make up、六容器 ✓ 就绪芯片、12/6/5/1 数据行、片尾字幕正常 |

- 所有截图：**无乱码、无方块字、无截断、无元素重叠遮挡、无黑屏**；主色 violet-600 系 + cyan 点缀，与 `frontend/src/styles/themes.ts` ai-native 主题血缘一致（FR-06）。
- 注：首轮第 1 幕截图恰逢海报 0.8s 淡出过渡（截图过早）出现海报残影，非缺陷；等待过渡结束后重拍干净（01 号图）。

## 3. 播放器交互实测

| 项 | 方法 | 结果 |
|---|---|---|
| 播放推进 | `play()` 后 1.2s 采样 | T 从 20 → 21.2 ✅ |
| 暂停冻结 | `pause()` 后 0.4s 采样 | T 不变、playing=false ✅ |
| seek 确定性 | `seek(50)` 后回读 | |T-50|<0.01 ✅ |
| 静音开关 | `setMuted(true/false)` | 标志位与 master 增益切换正确（gain 走 setTargetAtTime 渐进，属预期）✅ |
| 播完片尾卡 | 97.6s 起播至结束 | endcard.show 出现、停在 98s、playing=false ✅ |
| 时间/进度 UI | 读 timeLabel / head | `01:37 / 01:38`、head 99.99% 同步 ✅ |
| 进度条点击 | 真实坐标点击 50% 处 | T=49 精确跳转 ✅ |
| 进度条悬浮 | 真实坐标 hover | 提示「12 宿主 · 一套编排 · 00:49」（章节名+时间）✅ |

## 4. 过程中发现并修复的缺陷

1. **`ctx.lineWidth(1.4)` 误写为函数调用**（sceneTeam 文档过门动画）：导致 77.7–80.5s 区间渲染中断（InvalidStateError 类异常被时间轴扫描捕获）。已改为赋值 `ctx.lineWidth=1.4`，复扫通过。
2. **Music.pad() 振荡器先 stop 后 start**：`o2.stop()` 先于 `o2.start()` 调用，音频引擎一启动即抛 `InvalidStateError: cannot call stop without calling start first`。已调整为先双双 `start` 再排程 `stop`，实测 play 后无异常。

## 5. 文案事实核对（FR-03，对照 README.md）

- 「12 种宿主 Agent」（claude/codex/copilot/opencode/hermes/gemini/pi/cursor/kimi/kiro/antigravity/openclaw）＝ README「多 Provider 适配」原文名单 ✅
- 「6 种协议适配」＝ README「6 种协议适配」✅
- 生命周期 brainstorm→plan→execute→verify→archive ＝ README「核心能力·变更全生命周期」✅
- 「worktree 隔离」「双层审批（工具级+阶段级）」「SSE 流式输出」「RBAC + Git 凭据网关」「Docker Compose 一键起（make up）」「daemon 本机执行/文件系统策略」均出自 README「为什么用 SillyHub」「核心能力」 ✅
- 架构图（浏览器→backend→PG/Redis/MinIO；daemon WebSocket；spawn+MCP）＝ README「架构概览」✅

## 6. 结论

FR-01～FR-07 验证全部通过；无遗留视觉缺陷；无需用户裁决的降级项（未发生静默降级）。
