<!-- author: qinyi | created_at: 2026-08-25 03:10:00 -->
<!--
risk_level: contract-tested
风险等级声明（verify 对账依据）：本变更零 daemon 进程侧改动——sillyhub-daemon/
目录零文件触碰、SESSION_INJECT/lease 协议零变更、page_context 仅在 backend
create 路径既有 dispatch_prompt 前导链追加文本。关键词命中（daemon/session/
backend）来自模块名与文件路径，非跨进程/状态机改动。证据等级：真实 DB 的
service 级集成测试（lease.metadata_ dispatch_prompt 断言）+ OpenAPI 契约
对账（gen:types）；真实 daemon 进程联调未执行（见 verify-result 运行时证据节）。
-->
# 设计：统一智能悬浮会话 v1

生命周期契约：无/N/A——本变更不新增或修改任何 lease / agent_run / daemon
生命周期事件与状态迁移；page_context 仅在既有 create 路径的 dispatch_prompt
前导链追加文本，零 daemon 协议改动。

## §1 总体架构（一个内核 · N 宿主）

```
(dashboard)/layout.tsx
└─ AppShell
   ├─ children（业务页 / 门户页）
   └─ FloatingSessionHost（新增，全局唯一挂载点）
      ├─ FloatingBall（球 + 角标；门户路由隐藏）
      ├─ Drawer（hidden 保活容器）
      │  ├─ 头部：标题 / 上下文条 / 最小化 / 关闭 / 去门户
      │  ├─ CompactSessionList（最近 10 条）
      │  └─ SessionPanel mode="page"（复用，零改动主体）
      │     ├─ 真会话：sessionId + key 重挂载（R6 契约）
      │     └─ 预会话：preContext 首句 createSession（+pageContext 透传）
      └─ PreSessionPicker（机器兜底，复用既有全屏浮层）
```

## §2 评审五设计题的 v1 答案

| # | 评审题 | v1 答案 | 留给 v2 |
|---|---|---|---|
| 1 | 双宿主互斥 | pathname 命中门户三路由 → 隐藏球 + **卸载**抽屉主体（不是藏）| 会话迁移（悬浮↔门户无缝接管）|
| 2 | 抽屉布局/右下角避让 | 新建抽屉壳（620px 右滑入）+ 紧凑列表变体；球 `bottom-5 right-5` 与审批胶囊分层 | 门户整页布局宿主化 |
| 3 | 隐藏态降载 | 开或有活跃会话才挂载数据查询；关闭且无会话=整体卸载 | 最小化态轮询降频 |
| 4 | inject 轮前导 | **不做**（SESSION_INJECT 无分流通道，需 daemon 协议扩展）| 协议扩展专项 |
| 5 | page_context 安全 | 枚举 page_key + 服务端回查 + 无自由文本 + 单值截断 | 更多页面类型注册 |

## §3 数据流与状态

### 壳层 store（`stores/floating-session.ts`，zustand）
```ts
interface FloatingSessionState {
  open: boolean;             // 抽屉开
  minimized: boolean;        // 收起为胶囊（保活）
  sessionId: string | null;  // 选中会话（key 源）
  preContext: { runtimeId; workspaceId; changeId? } | null;
  pageContext: { page_key: "ppm_project"; project_id: string } | null;
  // actions
  openDrawer(); minimize(); restore(); closeDrawer();
  selectSession(id | null);
  startPreSession(pageContext?);
}
```
- 会话内部状态（SSE/队列/turns）**不上提**（R6；key 重挂载契约由 sessionId
  驱动，SessionPanel 整体 remount 语义与门户一致）。
- 挂载条件：`open || minimized || sessionId`（三者任一为真才渲染 Drawer
  主体；全 false 时仅渲染球，零后台查询）。

### 感知页面上下文（v1 范围）
- 显式入口优先：`startPreSession(pageContext)` 由 PPM 行按钮直接注入。
- URL 派生（`hooks/use-page-session-context.ts`）：pathname 前缀 `/ppm` +
  查询参 `pm_project_id`/`projectId` → 同款上下文；其余页面 → null（上下文条
  显示「未注册页面上下文」，AI 无注入）。供上下文条展示与新会话默认携带。

## §4 后端协议（创建轮）

### Schema（`daemon/schema.py`）
```py
class PageContextCreateBlock(BaseModel):
    page_key: Literal["ppm_project"]          # v1 枚举一枚
    project_id: uuid.UUID
# SessionCreateRequest += page_context: PageContextCreateBlock | None = None
```

### 前导构建（`daemon/session/context.py` 新增 `build_page_context_preamble`）
- 复用 build_change_context_preamble 模式：DB 回查 → 多行纯文本 → None 直通。
- 数据全部服务端取（ProjectMaintenance.project_name / project_code /
  project_status），单值 `[:120]` 截断；查无 → None。
- 拼接（service.create_session）：`[变更前导, 页面前导, 团队简报]` 过滤
  None 后 `"\n\n---\n\n"` 连接 + 用户 prompt（既有机制零改动）。
- 展示层干净：AgentRunLog(user_input) / SESSION_INJECT 展示 payload 不变。

## 5. 文件变更清单（File Changes）

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/schema.py | +PageContextCreateBlock、SessionCreateRequest.page_context |
| 修改 | backend/app/modules/daemon/router.py | create 端点透传 page_context |
| 修改 | backend/app/modules/daemon/session/context.py | +build_page_context_preamble |
| 修改 | backend/app/modules/daemon/session/service.py | create_session 签名 += page_context；前导链插入 |
| 新增 | backend/app/modules/daemon/tests/test_page_context_preamble.py | 构建器 + create 拼接测试 |
| 新增 | frontend/src/stores/floating-session.ts | 壳层 zustand store |
| 新增 | frontend/src/stores/floating-session.test.ts | store 动作机单测 |
| 新增 | frontend/src/components/floating/floating-session-host.tsx | 球/抽屉/胶囊/互斥/上下文条 |
| 新增 | frontend/src/components/floating/floating-session-host.test.tsx | 宿主渲染/互斥/保活测试 |
| 新增 | frontend/src/hooks/use-page-session-context.ts | URL 派生页面上下文 |
| 新增 | frontend/src/hooks/use-page-session-context.test.ts | hook 单测 |
| 修改 | frontend/src/app/(dashboard)/layout.tsx | 挂载 FloatingSessionHost |
| 修改 | frontend/src/components/daemon/session-panel.tsx | 最小增量 2 处 pageContext 透传 |
| 修改 | frontend/src/lib/daemon.ts | createSession body += page_context |
| 修改 | frontend/src/app/(dashboard)/ppm/projects/page.tsx | 发起团队按钮改唤起悬浮 |
| 生成 | frontend/src/lib/api-types.ts | pnpm gen:types 产物 |
| 生成 | backend/openapi.json | openapi 导出产物 |

## §6 风险与对策

| 风险 | 对策 |
|---|---|
| session-panel.tsx 并行编辑冲突 | 增量 2 处、纯可选字段、缺省零回归；commit 前 rebase 检查 |
| 双挂载双 SSE | 互斥协议卸载制（§2.1）；宿主仅在非门户路由渲染 Drawer 主体 |
| 布局层常驻查询拖慢全站 | 挂载条件门控（§3）；关闭且无会话零查询 |
| page_context 伪造注入 | 枚举 422 + 服务端回查 + 无自由文本（§4） |
| 抽屉宽度下 SessionPanel 布局破碎 | 面板自身 min-w-0 自适应（门户 grid 同款约束已验证）；抽屉 620px 起 |

## §7 测试策略

- backend：pytest——schema 校验（非法 page_key 422）、preamble 构建（None/
  命中/截断）、create_session 拼接（含既有前导顺序不回归）。
- frontend：vitest——store 动作机、host 渲染与互斥（mock next/navigation
  pathname 切换）、page-context hook 派生、ppm 按钮行为（store 被调）。
- 回归：`pnpm -C frontend tsc`、eslint、受影响目录既有测试；backend daemon
  模块测试。
