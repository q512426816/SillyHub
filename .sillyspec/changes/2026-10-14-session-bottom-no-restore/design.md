---
author: flow-machine-draft
created_at: 2026-10-15T01:27:32.423Z
---
# 设计记录（Design Record）— 2026-10-14-session-bottom-no-restore

## 做法概述

滚动写入审计+对照实验锁定第五层根因：切换会话路径渐进贴底序列健康（387→13594 delta=0），故障为刷新专有——Chrome scroll restoration 恢复上次容器滚动位置，恢复晚到时覆盖初始贴底 scrollTo 且恢复写入（scrollTop 骤减+scrollHeight 稳定）走 handleScroll 正常分支清 isNearBottomRef，贴底链全死，停在上次位置（落位随上次停留位置随机）。修法：TurnTimeline 挂载期间 history.scrollRestoration=manual（斩断恢复通道），卸载还原。刷新=重新打开会话，落底与切换语义一致。

## 接口契约

无接口/导出变化；一个内部 effect（浏览器 history API 状态），对消费方透明。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到：恢复通道被禁后无迟到写入者；贴底链各触发器时序（前四层修复）不变。
2. 并发写：history 属性赋值幂等；多挂载点（page/dialog 不共存）无并发面。
3. 切换/生命周期：卸载还原挂载前值（通常 auto）——SPA 内导航离开会话页后其它页面刷新体验不受影响；key 重挂载（会话切换）同 effect 重跑幂等。
4. 作用域：history 为当前标签页作用域，无跨页/跨仓面。

## 风险与死路

最大风险：用户期望「刷新回到上次阅读位置」的语义被改（现改为落底）——与产品贴底跟随设计及用户本次诉求（刷新应落底）一致，且切换会话本就落底，语义统一。放弃方案：①识别恢复写入并重新贴底（恢复事件 isTrusted=true 无法与用户滚动区分，只能加时序启发式，脆弱）；②挂载后延时强贴底（时序赌注，恢复时机无上界）。
