---
author: flow-machine-draft
created_at: 2026-10-05T11:25:37.369Z
---
# 提案书（Proposal）— 2026-10-05-promo-film-page

## 动机

任务原话转写：为 SillyHub 平台制作宣传视频网页，参考 lemomo-ai/lemo-opuscar 的纯代码拍片思路：不用视频模型，单文件 HTML 内用 Canvas 纯代码渲染一部动态宣传影片。
成功标准：
- 产出单文件自包含 HTML（零外部网络依赖，双击即开），放在 docs/promo/ 下
- 影片分多幕场景动画，覆盖平台核心价值：规范驱动（SillySpec 生命周期）、架构（backend/daemon/agent）、多 Agent 编排、实时可视、团队协作与安全
- 文案与平台事实一致（12 种宿主 Agent、worktree 隔离、双层审批、Docker Compose 一键起等，取自 README）
- 提供播放器交互：播放/暂停、可拖动进度条、章节标记与跳转、静音、重播
- 含 WebAudio 合成背景音乐（无音频文件），支持静音开关
- 视觉使用平台 AI-Native 品牌色（紫 #7C3AED / 青 #0891B2）
- 在浏览器实际打开验证：无 JS 报错、多时间点截图动画正常、文字无乱码

## 变更范围

按成功标准机械推导，共 7 条验收面：
1. 产出单文件自包含 HTML（零外部网络依赖，双击即开），放在 docs/promo/ 下
2. 影片分多幕场景动画，覆盖平台核心价值：规范驱动（SillySpec 生命周期）、架构（backend/daemon/agent）、多 Agent 编排、实时可视、团队协作与安全
3. 文案与平台事实一致（12 种宿主 Agent、worktree 隔离、双层审批、Docker Compose 一键起等，取自 README）
4. 提供播放器交互：播放/暂停、可拖动进度条、章节标记与跳转、静音、重播
5. 含 WebAudio 合成背景音乐（无音频文件），支持静音开关
6. 视觉使用平台 AI-Native 品牌色（紫 #7C3AED / 青 #0891B2）
7. 在浏览器实际打开验证：无 JS 报错、多时间点截图动画正常、文字无乱码

## 成功标准（可验证）

1. 产出单文件自包含 HTML（零外部网络依赖，双击即开），放在 docs/promo/ 下
2. 影片分多幕场景动画，覆盖平台核心价值：规范驱动（SillySpec 生命周期）、架构（backend/daemon/agent）、多 Agent 编排、实时可视、团队协作与安全
3. 文案与平台事实一致（12 种宿主 Agent、worktree 隔离、双层审批、Docker Compose 一键起等，取自 README）
4. 提供播放器交互：播放/暂停、可拖动进度条、章节标记与跳转、静音、重播
5. 含 WebAudio 合成背景音乐（无音频文件），支持静音开关
6. 视觉使用平台 AI-Native 品牌色（紫 #7C3AED / 青 #0891B2）
7. 在浏览器实际打开验证：无 JS 报错、多时间点截图动画正常、文字无乱码
