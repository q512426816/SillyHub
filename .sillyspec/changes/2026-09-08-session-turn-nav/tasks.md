---
author: WhaleFall
created_at: 2026-09-08 11:02:33
---

# tasks.md — 2026-09-08-session-turn-nav

> 任务在 plan 阶段拆 Wave；此处为 brainstorm 期初版清单（粗粒度），plan 会细化依赖与验收。

- [ ] task-01 TurnRow 锚点与受控高亮：turn-timeline.tsx 根节点加 `data-turn-key={turn.realRunId ?? turn.runId}`；TurnTimelineProps 加 `highlightTurnKey`，命中行 `ring-2 ring-brand-200 bg-brand-50`（2.2s 自清由父级控制）；三宿主 className 回归断言
- [ ] task-02 TickRail 刻度轨组件：新文件 turn-catalog.tsx（TurnCatalogEntry 类型 + 刻度渲染/状态态 + hover 飞出卡与定位钳制 + 触屏直跳门控），配套单测 turn-catalog.test.tsx
- [ ] task-03 目录数据派生：session-panel-page.tsx 复用既有 runsMeta（不新增 useQuery）+ catalogEntries useMemo（runsMeta 定序定号、displayTurns 覆盖摘要、孤儿尾部追加、runsMeta 空降级为仅已加载）
- [ ] task-04 跳转链路：handleJumpToTurn（已加载直跳双 rAF+scrollIntoView；未加载循环 loadEarlier ≤8 页 + suppress ref + hasEarlier 镜像 ref + 两档 toast 兜底）；触顶自动加载 hook 接 suppress 参数；TurnRow fragment 双分支根均加锚点 + highlightTurnKey per-row 布尔派生
- [ ] task-05 布局挂载 desktop：sessionBody 包 flex 行 + TickRail ~30px 常驻（无折叠/无 localStorage，D-007）；**同步有意更新 session-panel-variant.test.tsx desktop 父链断言**（mobile 分支不动）
- [ ] task-06 多宿主：mobile ⋯ 菜单「轮次导航」项 + antd Drawer（行式列表形态，getContainer 面板根、宽 min(78vw,300px)、onJump 自动关）；floating 宿主确认零改动（desktop variant 刻度轨直接生效）
- [ ] task-07 滚动联动：activeTurnKey 计算（视口顶部最近轮）+ 目录 active 条目 scrollIntoView(nearest)
- [ ] task-08 测试补齐：session-panel-page 追加跳转/抑制/菜单用例；跑相关测试子集 + tsc
