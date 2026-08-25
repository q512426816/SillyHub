<!-- author: qinyi | created_at: 2026-08-25 03:10:00 -->
# 提案：统一智能悬浮会话（v1 垂直切片）

> 2026-08-25 · 源自四轮 explore 探索 + 一轮对抗性评审（详见下方"探索依据"）。

## 背景与动机

会话（SessionPanel / SessionsPortal）目前只能从 3 个门户页 + /runtimes 弹窗进入；
用户在任意业务页（如 PPM 项目页）想问 AI 必须跳走。目标：右下角悬浮会话助手
成为全站统一入口，且具备"智能上下文"——自动感知当前页面与数据。

## 探索依据

- 交互原型：`attachments/prototype-unified-floating-session.html`（四场景：智能上下文/最小化保活/互斥协议/入口地图）
- 评审结论：骨架成立（一个内核两种宿主），五项设计题必须在设计中回答（本 design §D-005~D-009 逐一回答）
- 基线：main@1e9491fc（feedback-fix 与 sessions-live-updates 均已合入，最小化胶囊/Plan 卡/列表 SSE 可用）

## v1 范围（垂直切片，可独立验收）

1. **悬浮宿主**：dashboard 布局常驻悬浮球 + 右侧抽屉；抽屉内复用
   `SessionPanel mode="page"`（真会话/预会话两态）+ 紧凑最近会话列表 +
   PreSessionPicker 兜底新建。
2. **最小化保活**：收起 = CSS hidden 不卸载（SSE/队列保活）；关闭且无活跃
   会话 = 卸载抽屉主体（释放轮询与订阅，隐藏态降载 v1 策略）。
3. **互斥协议 v1**：进入三个门户路由时隐藏球并强制收起抽屉（防同会话双
   SSE/双队列/409）。
4. **智能上下文 v1（创建轮）**：`SessionCreateRequest.page_context`
   （page_key 枚举 + 实体 id，服务端白名单回查），注入【页面上下文】前导；
   展示层干净（AgentRunLog user_input 不变）。inject 追问轮前导为 v2
   （需 daemon 协议扩展，不在本切片）。
5. **首个智能入口**：PPM 项目列表「发起团队」行按钮改为唤起悬浮球并携带
   `ppm_project` 上下文（原 /sessions?new=1 跳转保留，双入口并存）。

## 不在范围内（Non-Goals）

- 门户页宿主化改造（URL 同步 prop 化）——门户三页零改动；
- 其余 8 处入口收编（工作区 tab/变更卡/扫描按钮/runtimes 弹窗等）；
- inject 追问轮上下文刷新（daemon SESSION_INJECT 协议扩展）；
- 移动端 /m/*（明确排除，评审结论）；
- 完整会话管理（批量归档/筛选）——仍去门户页。

## 预期收益

任意页面零跳转发起/继续会话；PPM 场景 AI 自动获得项目上下文（名称/编码/
状态），提问免背景；为后续统一入口收编提供已验证的宿主骨架。
