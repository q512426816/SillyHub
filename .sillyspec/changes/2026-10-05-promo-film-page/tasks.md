---
author: flow-machine-draft
created_at: 2026-10-05T11:25:37.369Z
---
# 任务注册表（Tasks）— 2026-10-05-promo-film-page

> 镜像行（task-01…task-NN）是成功标准逐条镜像=任务锚：勿删勿改写（收口对照它），完成实现路径
> 需要更细步骤时在镜像行**后追加细化行**（保持 `- [ ] task-NN:` 行形态，编号从镜像行末尾顺延——
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决）。
> 边干边勾：完成一条 = 实现到位 + 相关测试跑绿 → 当场勾（sillyspec task tick --change 2026-10-05-promo-film-page --task task-NN 即时回显进度与下一任务指针，或 Edit 翻格），勿攒到收口一把勾（收口硬门拒单拍多格勾选；--allow-batch-tick 可显式旁路留痕）。⚠️ harness 的 TodoWrite 类工具不替代本文件——平台进度/收口哨兵只读 tasks.md。
> `flow status --change 2026-10-05-promo-film-page` 为自愿查看/恢复面。本文件收口前随交付显式 pathspec 提交。

- [ ] task-01: 产出单文件自包含 HTML（零外部网络依赖，双击即开），放在 docs/promo/ 下
- [ ] task-02: 影片分多幕场景动画，覆盖平台核心价值：规范驱动（SillySpec 生命周期）、架构（backend/daemon/agent）、多 Agent 编排、实时可视、团队协作与安全
- [ ] task-03: 文案与平台事实一致（12 种宿主 Agent、worktree 隔离、双层审批、Docker Compose 一键起等，取自 README）
- [ ] task-04: 提供播放器交互：播放/暂停、可拖动进度条、章节标记与跳转、静音、重播
- [ ] task-05: 含 WebAudio 合成背景音乐（无音频文件），支持静音开关
- [ ] task-06: 视觉使用平台 AI-Native 品牌色（紫 #7C3AED / 青 #0891B2）
- [ ] task-07: 在浏览器实际打开验证：无 JS 报错、多时间点截图动画正常、文字无乱码
- [x] task-08: 撰写 requirements FR 正文与 design 四节（含文件变更清单）
- [ ] task-09: 浏览器验证留痕 visual-evidence.md + docs/promo/README.md + 显式 pathspec 提交
