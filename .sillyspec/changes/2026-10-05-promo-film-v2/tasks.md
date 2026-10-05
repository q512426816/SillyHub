---
author: flow-machine-draft
created_at: 2026-10-05T12:34:48.340Z
---
# 任务注册表（Tasks）— 2026-10-05-promo-film-v2

> 镜像行（task-01…task-NN）是成功标准逐条镜像=任务锚：勿删勿改写（收口对照它），完成实现路径
> 需要更细步骤时在镜像行**后追加细化行**（保持 `- [ ] task-NN:` 行形态，编号从镜像行末尾顺延——
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决）。
> 边干边勾：完成一条 = 实现到位 + 相关测试跑绿 → 当场勾（sillyspec task tick --change 2026-10-05-promo-film-v2 --task task-NN 即时回显进度与下一任务，或 Edit 翻格），勿攒到收口一把勾（收口硬门拒单拍多格勾选；--allow-batch-tick 可显式旁路留痕）。⚠️ harness 的 TodoWrite 类工具不替代本文件——平台进度/收口哨兵只读 tasks.md。
> `flow status --change 2026-10-05-promo-film-v2` 为自愿查看/恢复面。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: 产出 docs/promo/v2/index.html + assets/（26 张真实界面截图），相对路径双击即开
- [ ] task-02: 影片约 300 秒、11 幕，主角为真实界面截图（浏览器窗口框+Ken Burns 推拉+区域高亮标注），文案人话化、事实与线上环境一致
- [ ] task-03: 卡顿修复：禁用逐帧 shadowBlur（辉光精灵化）、静态层缓存（底色/暗角/遮幅）、颗粒降频降合成、自适应画质三档+帧率降级；1080p 实测稳定 ≥55fps
- [ ] task-04: 播放器沿用 v1 交互（播放/暂停/章节进度条/跳转/静音/重播/快捷键）
- [ ] task-05: WebAudio 合成配乐扩展至全片（约 120 小节，分章情绪），幕起始带音效
- [ ] task-06: 浏览器实测：无 JS 报错、全时间轴扫描零异常、≥10 时间点截图视觉验收无乱码无缺陷
- [x] task-07: 线上环境截图采集（28 张，含新项目接入两张）与文档四件套落稿
- [ ] task-08: visual-evidence.md 帧率与截图证据 + README 更新 + 显式 pathspec 提交
