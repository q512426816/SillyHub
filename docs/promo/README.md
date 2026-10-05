# SillyHub 平台宣传片 · 纯代码拍片

一个单文件的"宣传视频"网页：**没有任何一帧视频文件、没有任何音频文件**——
影片画面由 Canvas 2D 按主时钟逐帧实时渲染，配乐由 WebAudio 振荡器实时合成。
拍摄思路致敬 [lemomo-ai/lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar)（Claude Code 纯代码拍短片）。

## 打开方式

双击 `sillyhub-promo.html` 即可（零外部网络依赖，离线可放）；或本地起个静态服务：

```bash
python -m http.server 8791 --directory docs/promo
# 浏览器打开 http://127.0.0.1:8791/sillyhub-promo.html
```

## 影片结构（8 幕 · 01:38）

| # | 时间 | 幕名 | 讲什么 |
|---|------|------|--------|
| 1 | 00:00–00:11 | 序幕 · 失控的代码 | 终端告警 + 混沌 Agent 群：没人管得住的 Agent 写代码 |
| 2 | 00:11–00:19 | SillyHub | 粒子汇聚成标题：多智能体协作管理平台 |
| 3 | 00:19–00:33 | 规范驱动 · SillySpec | brainstorm→plan→execute→verify→archive 五阶段流水线与评审门禁 |
| 4 | 00:33–00:49 | 云端调度 · 本机执行 | 架构图动画：浏览器→backend→存储；daemon 在本机拉起 Agent |
| 5 | 00:49–01:03 | 12 宿主 · 一套编排 | 12 种宿主 Agent 星座 + 并行 worktree 车道 |
| 6 | 01:03–01:15 | 实时可视 | SSE 事件流、组件拓扑、看板 |
| 7 | 01:15–01:27 | 团队与安全 | RBAC 盾、工具级/阶段级双层审批、项目隔离 |
| 8 | 01:27–01:38 | 启程 | `$ make up` 容器栈就绪 + 平台数据 + 片尾卡 |

## 播放器操作

- **空格 / K**：播放 / 暂停
- **← / →**：上一幕 / 下一幕
- **M**：静音（WebAudio 合成配乐）
- **F**：全屏
- 进度条：点击 / 拖动定位（确定性渲染，seek 后画面精确重放）；悬浮显示章节名与时间
- 播完出现片尾卡：重播全片 或 按幕跳转

## 技术要点

- **画面 = 时间的确定性函数**：所有粒子/日志/动画由种子化整数哈希派生，任一时刻 seek 都能精确重放（无积分状态）
- **配乐实时合成**：和弦按剧情铺排（暗涌→释放→推进→收束），pad/bass/琶音/底鼓/镲/riser/impact 全部振荡器与噪声节点生成，章节切换自动转场音效
- **视觉**：AI-Native 品牌色（紫 `#7C3AED` / 青 `#0891B2`）+ 遮幅黑条 + 胶片颗粒 + 暗角 + 转场闪
- **调试句柄**：控制台 `__promoFilm`（`play()/pause()/seek(t)/CHAPTERS/DUR`）

## 修改指南

- 章节时间轴：`CHAPTERS` 数组（每幕 `{t0,t1,name}`）
- 字幕：`CAPTIONS` 数组（`{t0,t1,text}`）
- 配乐和弦/情绪：`BAR_CHORDS` 与 `intensityAt()`
- 各幕绘制函数：`sceneCold / sceneTitle / sceneSpec / sceneArch / sceneAgents / sceneLive / sceneTeam / sceneOutro`
- 文案事实源：仓库根 `README.md`（12 宿主、6 协议、双层审批、Docker Compose 一键起）
