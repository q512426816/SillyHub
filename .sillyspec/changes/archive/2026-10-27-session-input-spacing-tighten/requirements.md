---
author: flow-machine-draft
created_at: 2026-10-27T03:02:40.020Z
---
# 需求规格（Requirements）— 2026-10-27-session-input-spacing-tighten

## 功能需求

### FR-01: 消息滚动区 py-5 改 pt-5（去下内边距保留上）

- 会话页消息滚动区（turn-timeline-scroll）必须只保留上内边距（pt-5），禁止保留下内边距；左右内边距（px-5）与其它样式不变。

#### 场景：主路径

- Given：桌面/手机会话页渲染
- When：查看消息滚动区容器
- Then：className 为 `px-5 pt-5`（原 `px-5 py-5`），消息顶行仍有上留白、底部与输入区之间无双重留白

### FR-02: 输入区容器两处挂载点删除 pt-3

- 输入区容器（预会话与真会话两处挂载点）必须移除 pt-3 上内边距；容器其余样式（flex/bg-card/shrink-0）保持不变。

#### 场景：主路径

- Given：SessionPanelPage 渲染输入区容器
- When：两处挂载点输出 className
- Then：均为 `flex shrink-0 flex-col bg-card`（无 pt-3）

### FR-03: 输入栏主体删除 pt-1 与 pb-4

- 输入栏 footer 必须移除 pt-1 与 pb-4 上下内边距；横向内边距 px-5 与背景保持不变。

#### 场景：主路径

- Given：SessionInputBar 渲染 footer
- When：查看 className
- Then：为 `shrink-0 bg-card px-5`（无 pt-1/pb-4）

### FR-04: 输入框圆角容器与 textarea 的 py-2 改 pt-2

- 输入框圆角容器、textarea 本体及 @联想浮层镜像 overlay 三处必须同步由 py-2 改为 pt-2（去下保上，浮层与正文垂直对齐不变）；聚焦态/边框/圆角等其余样式不变。

#### 场景：主路径

- Given：输入框渲染
- When：查看三处 className（容器/textarea/overlay）
- Then：均为 pt-2（无 py-2），浮层文字与 textarea 文字基线对齐不漂移

### FR-05: 输入区底部两处删除 pb-3

- 输入区底部包装（预会话配置条与真会话配置条两处）必须移除 pb-3 下内边距；px-5 保持不变。

#### 场景：主路径

- Given：输入区底部配置条包装渲染
- When：查看两处 className
- Then：均为 `px-5`（无 pb-3）

### FR-06: dialog 模式同链路位置对齐（如有）

- dialog 模式若存在同链路间距必须与 page 模式同口径处理；经排查 dialog 命中的 py-2 属告警横幅（另一区域、不在用户点名链上），必须保持不动。

#### 场景：排查结论

- Given：dialog 模式组件中这些类的分布
- When：排查同链路位置
- Then：告警横幅 py-2 原样保留（非输入区链），无同链路遗漏

### FR-07: 触及组件相关测试与 lint 通过

- 触及组件（SessionPanelPage/SessionInputBar，桌面+手机共用）的相关测试与 lint 必须全绿，禁止既有用例回归。

#### 场景：主路径

- Given：代码改动完成
- When：跑触及组件相关测试 + tsc + eslint
- Then：118 用例全过、tsc 干净、eslint 0 errors

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx（会话面板渲染回归——输入区/滚动区类名无断言冲突，全套通过即覆盖）
FR-02: frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx（同上，渲染回归套件）
FR-03: frontend/src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx（输入栏交互回归——footer 结构不变仅类名）
FR-04: frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx（输入框/草稿链路回归）
FR-05: frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx（手机会话页挂载回归）
FR-06: 不适用：纯排查结论（dialog 命中处为告警横幅另一区域，无代码改动面），由 FR-01..05 回归套件兜底零回归
FR-07: frontend/src/components/mobile/__tests__/（mobile 组件回归 34 用例）+ pnpm exec tsc --noEmit + eslint 触及文件 0 errors
