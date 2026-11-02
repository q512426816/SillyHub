---
author: flow-machine-draft
created_at: 2026-11-02T02:41:51.555Z
---
# 需求规格（Requirements）— 2026-11-02-scan-docs-unbound-view

## 功能需求

### FR-01: 无 daemon 绑定账号进入扫描文档页：文档树/搜索/详情/统计面板照常展示服务端已有数据

- 扫描文档页**必须**在页面挂载时无条件拉取文档列表（GET /scan-docs），**禁止**因当前账号无 daemon 绑定而跳过拉取；无绑定时文档树、关键词搜索、文档详情与统计面板**必须**照常渲染服务端已有数据（数据源为 scan_documents 表，与绑定状态无关）。进页后台 reparse **必须**照常发起（后端纯服务端执行读 spec 镜像，权限 WORKSPACE_WRITE，失败静默的既有语义不变）。

#### 场景：无绑定账号正常浏览

Given 当前账号在 该工作区无 daemon 绑定（fetchMyBinding 返回 null）且服务端已有扫描文档数据
When 进入扫描文档页
Then 文档树渲染出文档条目，统计面板正常加载，点击文件可查看详情，搜索可过滤

#### 场景：无绑定且服务端无数据

Given 无 daemon 绑定且该工作区 scan_documents 表无 exists 数据
When 进入扫描文档页
Then 展示既有空态文案，不报错、不出现整页引导替换

### FR-02: 无绑定时主区不再被 DaemonRequiredNotice 整页替换，改为非阻断降级横幅（保留配置守护进程入口）

- 无 daemon 绑定时页面**禁止**用 DaemonRequiredNotice 替换文档主区；**必须**在主区旁渲染非阻断降级横幅，横幅**必须**保留「配置我的守护进程」入口（内联展开绑定引导），配置成功后横幅消失、主区切回正常视图。横幅文案**必须**如实说明「当前展示的是工作区已有数据」（不得沿用 blocked 变体「此功能需要读取本机守护进程上的项目文件」的阻断口径）。

#### 场景：无绑定横幅非阻断

Given 无 daemon 绑定且服务端有文档数据
When 进入扫描文档页
Then 文档树与降级横幅同时可见（横幅不遮挡/不替换主区）；点击「配置我的守护进程」内联展开引导，配置成功回调后横幅消失

### FR-03: 有绑定账号页面行为与现状完全一致

- 有 daemon 绑定账号的页面行为**必须**与现状一致：进页拉列表 + 后台 reparse + 完成后静默刷新，且**禁止**渲染降级横幅。既有用例（文档树渲染/详情/面板宽度记忆/首屏提速）**必须**全数保持绿。

#### 场景：有绑定回归

Given 账号有 daemon 绑定（fetchMyBinding 返回含 daemon_id 的 binding）
When 进入扫描文档页
Then 行为与现状一致：无降级横幅，文档树照常渲染，reparse 照发

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx「无绑定：文档树/详情照常渲染服务端数据」
FR-02: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx「无绑定：降级横幅非阻断且保留配置入口」；frontend/src/components/daemon-required-notice.test.tsx「degraded 变体：横幅文案与配置入口」
FR-03: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx「无绑定：文档树/详情照常渲染服务端数据」用例内同时断言有绑定默认路径不渲染横幅（mockBinding 返回 daemon_id 的既有用例全数回归）
