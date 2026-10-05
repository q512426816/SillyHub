---
author: flow-machine-draft
created_at: 2026-10-05T11:25:37.369Z
---
# 需求规格（Requirements）— 2026-10-05-promo-film-page

## 功能需求

> FR 由你撰写：每条 = `### FR-NN: 标题` + 一句带强度词的行为规定（必须=硬性；禁止=红线；
> SHOULD=建议须注理由；可以=可选）；边界情形加场景块 `#### 场景：名` + Given/When/Then 行。
> 标题行是成功标准锚（勿改写——收口做门柱对比）；正文与场景块归你。

### FR-01: 产出单文件自包含 HTML（零外部网络依赖，双击即开），放在 docs/promo/ 下

- 必须：宣传视频网页以单一 HTML 文件交付于 `docs/promo/sillyhub-promo.html`，所有样式、脚本、动画、音频合成逻辑内联于该文件；禁止引用任何外部网络资源（CDN 脚本、外链字体、外链图片、远程音频），用浏览器直接打开本地文件即可完整播放。
- 可以：附带一份 `docs/promo/README.md` 说明打开方式与影片结构（非播放依赖）。

#### 场景：离线双击打开

- Given 用户在无网络环境的 Windows/macOS 机器上
- When 双击打开 `docs/promo/sillyhub-promo.html`
- Then 海报页与影片完整呈现，控制台无资源加载失败（net::ERR）类报错

### FR-02: 影片分多幕场景动画，覆盖平台核心价值：规范驱动（SillySpec 生命周期）、架构（backend/daemon/agent）、多 Agent 编排、实时可视、团队协作与安全

- 必须：影片由 Canvas 2D 实时渲染的 ≥6 幕场景组成，总时长 ≥90 秒，且至少覆盖：SillySpec 生命周期（brainstorm→plan→execute→verify→archive 五阶段）、平台架构（浏览器/backend/数据库/daemon/Agent 分层）、多 Agent 编排（12 宿主星座）、实时可视（流式日志/拓扑/看板）、团队协作与安全（RBAC/双层审批）五个价值面；每一幕必须有可辨识的专属视觉主体与幕标题，禁止以纯静态轮播图代替动画。

#### 场景：章节结构

- Given 影片时间轴定义为幕（chapter）数组
- When 用户查看播放器进度条或章节列表
- Then 每幕有名称与时间区间，可按幕跳转，跳转后画面与该幕时间点严格对应（确定性渲染，seek 后不跳变）

### FR-03: 文案与平台事实一致（12 种宿主 Agent、worktree 隔离、双层审批、Docker Compose 一键起等，取自 README）

- 必须：影片全部文案（幕标题、字幕、数字、术语）以仓库根 README.md 为唯一事实源：宿主 Agent 数=12（claude/codex/copilot/opencode/hermes/gemini/pi/cursor/kimi/kiro/antigravity/openclaw）、协议适配=6、变更生命周期与产品定位表述与 README 一致；禁止编造平台不存在的功能或数字。

#### 场景：数字可溯源

- Given 影片出现「12 种宿主 Agent」「6 种协议」「Docker Compose 一键起」等表述
- When 对照 README.md「核心能力」「为什么用 SillyHub」章节
- Then 每个数字/能力表述均能在 README 找到原文依据

### FR-04: 提供播放器交互：播放/暂停、可拖动进度条、章节标记与跳转、静音、重播

- 必须提供：播放/暂停切换（按钮+空格键）、进度条拖动与点击定位（拖动中实时预览画面）、进度条上的章节分隔标记与悬浮章节名、上一幕/下一幕跳转（按钮+方向键）、静音开关（按钮+M 键）、播完出现重播入口；暂停时画面冻结、恢复后从暂停点继续，seek 后音频轨道与画面对齐。

#### 场景：拖动进度条

- Given 影片播放中
- When 用户将进度条拖到任意中间时间点
- Then 画面立即切换为该时间点的确定帧，松手后从该点继续播放，音乐和弦落在该时间点所属小节

### FR-05: 含 WebAudio 合成背景音乐（无音频文件），支持静音开关

- 必须：背景音乐由 WebAudio 振荡器/噪声节点实时合成（无任何音频文件与采样），随剧情推进有情绪分段（序幕紧张→标题释放→中段推进→尾声收束），在幕切换处有转场音效；必须支持静音开关键（M），且音频仅在用户点击播放后初始化（浏览器自动播放策略合规）。

#### 场景：静音

- Given 影片播放中，音频正常
- When 用户按 M 或点击静音按钮
- Then 立即静音且画面不受影响；再按一次恢复

### FR-06: 视觉使用平台 AI-Native 品牌色（紫 #7C3AED / 青 #0891B2）

- 必须：影片主视觉以 AI-Native 品牌紫 `#7C3AED`（及其 violet 阶）与交互青 `#0891B2`（cyan 阶）构建在深色电影底上；危险/告警语义允许用红、成功语义可用绿，但品牌识别元素（logo、标题、主要光效）必须以品牌紫为主、青为辅。

#### 场景：品牌一致性

- Given 影片任意时间点截图
- When 与 `frontend/src/styles/themes.ts` 的 ai-native 主题色对照
- Then 主色为 violet-600 系、点缀色为 cyan 系，无第三方品牌色系主导画面

### FR-07: 在浏览器实际打开验证：无 JS 报错、多时间点截图动画正常、文字无乱码

- 必须：交付前用真实浏览器打开该文件完成验证：控制台 0 个 JS 错误；在至少 6 个不同时间点（覆盖每一大幕）截图确认动画主体可见、无黑屏/错位；所有中文文本正常渲染无乱码方块；验证截图与结论落盘到变更目录 `visual-evidence.md`。

#### 场景：验证留痕

- Given 影片文件已交付
- When 执行浏览器验证流程
- Then `.sillyspec/changes/2026-10-05-promo-film-page/visual-evidence.md` 记录时间点、截图与结论

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：纯静态展示页，无项目测试工具链触及面；以浏览器实测（FR-07）+ 无外链人工核查代替
FR-02: 不适用：视觉动画无自动化断言面；以多时间点截图证据（visual-evidence.md）代替
FR-03: 不适用：文案事实核对为人工对照 README；依据记录在 visual-evidence.md 的事实清单
FR-04: 不适用：浏览器交互行为，人工实测播放/暂停/拖动/跳转/静音并记录于 visual-evidence.md
FR-05: 不适用：音频听觉效果无法自动化断言；实测静音键行为并记录于 visual-evidence.md
FR-06: 不适用：色彩一致性人工比对 themes.ts，记录于 visual-evidence.md
FR-07: 不适用：本条即验证流程本身，产出物为 visual-evidence.md + 截图
