<!-- author: qinyi | created_at: 2026-08-25 03:10:00 -->
# 需求：统一智能悬浮会话 v1

## 功能需求

### FR-1 悬浮球常驻
- dashboard 布局（`(dashboard)/layout.tsx` AppShell 内）挂载悬浮球，所有
  dashboard 页面可见可点；点击开/关抽屉。
- 悬浮球右下角定位与既有「待答审批最小化胶囊」（session-permission-panel
  `fixed bottom-4 right-4`）分层避让（本组件 `bottom-5 right-5`，胶囊在上层
  已有容器内，互不遮挡）。
- 有选中会话（含最小化态）时球上显示状态角标。

### FR-2 抽屉宿主（复用 SessionPanel）
- 右侧滑出抽屉，头部含：标题、上下文条（当前感知页面）、最小化、关闭、
  「去门户」按钮（跳 /sessions，互斥协议承接）。
- 主体左栏：紧凑最近会话列表（最近 10 条，活跃优先；点击切换选中）+
  「新会话」按钮。
- 主体右栏：复用 `SessionPanel mode="page"`——既有会话续聊（sessionId 驱动
  key 重挂载）与预会话空态（preContext 首句创建）两态，与门户同契约。
- 新建机器解析：`resolveDefaultMachineId`（门户导出复用）默认 Claude runtime；
  未命中弹 `PreSessionPicker` 兜底（既有全屏浮层，v1 接受）。

### FR-3 最小化保活 / 关闭降载
- 最小化：抽屉收起为球上角标 + 「会话进行中」胶囊；抽屉主体 CSS hidden
  保持挂载（SSE/消息队列/运行中任务不断）。
- 关闭：无活跃会话时卸载抽屉主体（停 machines/providers 列表查询与面板，
  隐藏态降载 v1 策略）；有活跃会话等同最小化。
- 跨页面导航（非门户路由）悬浮层常驻存活，会话不中断。

### FR-4 双宿主互斥
- pathname 命中门户三路由（`/sessions`、`/workspaces/:id/sessions`、
  `/workspaces/:id/changes/:cid/sessions`）：隐藏悬浮球 + 强制收起并卸载
  抽屉主体（防同会话双 SSE/双队列 409，评审设计题 1 的 v1 答案）。
- 离开门户路由自动恢复悬浮球。

### FR-5 智能上下文（创建轮，服务端可信）
- `POST /api/daemon/sessions` 新增可选 `page_context`：
  `{ page_key: "ppm_project", project_id: UUID }`（v1 仅此一枚举）。
- 服务端白名单回查 ProjectMaintenance：注入【页面上下文】前导（页面/项目名/
  编码/状态），拼接顺序：变更前导 → 页面前导 → 团队简报 → 用户消息。
- 展示层干净：AgentRunLog(user_input) 与首 turn SESSION_INJECT 展示 payload
  仍写用户原文（对齐变更前导先例）。
- 查无项目/无 page_context → 不注入（零回归）。

### FR-6 PPM 智能入口
- ppm/projects 行按钮「发起团队」：改为唤起悬浮抽屉预会话，携带
  `pageContext(ppm_project, row.id)`；机器解析成功直接进预会话态。
- 原 `router.push("/sessions?new=1")` 门户路径保留不动（双入口并存）。

## 非功能需求

- **R6 合规**：壳层 store 只存 open/minimized/sessionId/preContext/pageContext
  等壳态；会话内部状态（SSE/队列/turns）仍 100% 留在 SessionPanel（出处
  diff-analysis §6 风险表，非 design.md——评审勘误）。
- **安全**：page_key 服务端枚举校验（422）；数据只从服务端 DB 回查，客户端
  仅传实体 id，无自由文本通道；前导总长度受字段截断约束（单行值 120 字符）。
- **主题**：全部 brand-*/border/bg-card 语义 token（CLAUDE.md 规则 20）。
- **零回归**：门户三页、/runtimes 弹窗、既有 5000+ 前后端测试不因本变更变红。
- **平台兼容**：纯 Web 前端 + 既有后端栈，无 OS 特定依赖。

## 验收标准

1. 任意 dashboard 页面（如 /ppm/projects）可见悬浮球，开抽屉、发首句、最小化、
   切页面、恢复全流程会话不断。
2. PPM 行按钮发起：AI 首轮可见【页面上下文】（服务端回查），用户消息气泡干净。
3. 进入 /sessions 门户：球消失、抽屉收起；返回业务页恢复。
4. 后端 daemon 会话测试全绿 + 新增前导/schema 测试通过；前端 tsc 0 error、
   新增组件测试通过、既有测试零回归。
