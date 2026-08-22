# 决策记录（Decisions）

## D-001@v1: 会话面板基元统一方向 = antd
- type: architecture
- priority: P0
- status: accepted
- supersedes:
- source: user
- question: 两套基元（page 分支 antd / dialog 分支 shadcn）统一到哪套？
- answer: 用户拍板 antd（AskUserQuestion 2026-08-22）。
- normalized_requirement: session-panel 两分支 + SessionInputBar + TurnStatusBadge 全部使用 antd 基元；零手写 hex，色走 ConfigProvider token；非 shadcn 原生控件不转换。
- impacts: [FR-03, FR-04, FR-05, FR-07, task-02, task-03, task-04]
- evidence: 用户问答回合；Grill X-03 修正依据（page 分支 :1101/1167/1208/1239 + /sessions 外壳 antd + PPM §0 主流；如实披露 4 弹窗外壳为 shadcn/Radix，统一后 antd 嵌 shadcn 外壳，用户知悉）；D-304 跨区备案 design §4.B.7。

## D-002@v1: 实施方式 = 一次性原子改造
- type: architecture
- priority: P1
- status: accepted
- supersedes:
- source: user
- question: 删适配层与 antd 统一分两阶段（先搬移后样式）还是一次做完？
- answer: 用户选方案 A：同一变更内一次做完，单轮验收。
- normalized_requirement: 搬移与样式统一同变更交付；回归定位靠逐文件小步提交语义 + 全量回归 + 5 面人工冒烟。
- impacts: [FR-01, FR-03, tasks 骨架不分阶段]
- evidence: 用户方案选择回合（两方案预览对比后选 A）。

## D-003@v1: TurnStatusBadge 纳入 antd 化（Grill U-01）
- type: boundary
- priority: P1
- status: accepted
- supersedes:
- source: user
- question: 消息流状态小徽标（纯样式 span）是否纳入统一范围？
- answer: 用户拍板一并换 antd（贯彻「整个会话 UI 家族统一」）。
- normalized_requirement: turn-timeline.tsx:930-983 内部渲染改 antd Badge status（running/interrupting→processing、completed→success、failed/killed→error、pending→default），签名与调用方零变化；3 个断言测试适配禁删用例。
- impacts: [FR-04, task-03]
- evidence: Grill U-01 用户问答回合；Grill v2 复审 X-05 消解核对（6 状态映射全覆盖）。

## D-004@v1: 按钮尺寸 = 主操作 32px / 打断 small 24px（Grill U-02）
- type: definition
- priority: P1
- status: accepted
- supersedes:
- source: user
- question: 弹窗操作按钮高度（现 36px；page 主按钮 32px、打断/重开 24px）？
- answer: 用户拍板：主操作 antd 默认 32px，打断对齐 page 惯例 small 24px。
- normalized_requirement: 新建/结束/团队分析 = 默认尺寸；打断 = size="small"；「布局零变化」界定为区域结构/信息层级/流程不变，高度微调属基元替换固有变化。
- impacts: [FR-03, task-02]
- evidence: Grill U-02 用户问答回合；page 惯例锚点 session-panel.tsx:1208/1239。

## D-005@v1: 📎 附件按钮 antd 映射 = type="text"（Grill U-03）
- type: definition
- priority: P2
- status: accepted
- supersedes:
- source: code
- question: SessionInputBar 📎 ghost 按钮（:169）换 antd 哪种形态？
- answer: 设计内定 type="text"（对应 ghost 无边框语义）。
- normalized_requirement: 发送 :196 → type="primary"；📎 :169 → type="text"；chips 原生 button :140 不动。
- impacts: [FR-05, task-04]
- evidence: session-input-bar.tsx 三处行号实测（Grill X-07）。

## D-006@v1: 与 team-unify 的顺序 = 本变更先行的 P1 硬前置门（Grill X-04）
- type: risk
- priority: P1
- status: accepted
- supersedes:
- source: code
- question: team-unify task-11 allowed_paths 与本变更正面重叠（session-panel.tsx/适配层/测试）如何零冲突？
- answer: 本变更必须先于 task-11 执行并合入 main；执行期发现 task-11 已启动改同文件立即停下协调；合入后仅更新 task-11.md 锚点。两变更已提交代码实测零交集（task-12 的 6 前端文件不涉本变更清单）。
- normalized_requirement: 顺序门写入 design §1/§7 与 tasks 头部铁律；执行前置检查 task-11 状态。
- impacts: [FR-08, task-08, 全部任务的执行顺序]
- evidence: git 实测（分支 11 commits/42 文件，前端 6 文件 13:06:35 合入零交集；grep -l 唯一 task-11.md 引用适配层）。
