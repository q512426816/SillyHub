---
author: flow-machine-draft
created_at: 2026-09-27T11:00:06.985Z
---
# 决策记录（Decisions）— 2026-09-27-session-portal-ia-restructure

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：session-panel-page.tsx（4615 行）JSX 大块迁移时破坏隐蔽行为——占位轮 SSE 抢先认领、触顶加载锚钉回、跳转抑制窗、发送窗口期打断回退等防呆逻辑都缝在 render 与 effect 的交界处。对策：只移动 JSX 块的容器位置，不动任何 hooks/回调/数据派生；每完成一个 task 跑相关测试再进下一步；收口时对 diff 逐行审查确认「仅 render 组织层」。实际暴露（独立评审 P1）：desktop 非 portal 宿主（分身浮层/悬浮助手）不传 onOpenSubagent，右列初版绑定宿主 props 导致它们的用量条与任务面板消失——已修复（右列容器与子代理 Provider 解耦，desktop 一律有右列）。另注：本变更工作区基线叠加于上一轮 2026-09-26-core-pages-visual-redesign 未提交的 staged 快照之上，冻结件 change.patch 因此含上一轮 38 文件捆绑（主仓库已分两笔 commit 剥离归属：先 staged 快照落地为上一轮 commit，再本变更独立 commit）。 试过放弃的方案：①ChatGPT 式单栏+抽屉布局（推翻三栏）——深链/群聊/文件模式/四分支全部重做，风险与收益不成比，放弃；②把 SessionConfigBar/CtxUsageBar 也收进右栏——配置与压缩上下文是输入前高频操作，收进右栏断操作流，放弃；③portal 层做统一四栏容器——群聊分支与文件树模式联动复杂，波及面大，放弃（改为 panel 层内解决）；④TaskExecutionPanel/UsageBar 彻底只留右栏——mobile 无右列会丢功能，放弃（mobile 维持原位）。
