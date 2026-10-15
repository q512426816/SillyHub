---
author: qinyi
created_at: 2026-10-14 23:50:17
generated_by: sillyspec-fourpiece-init
change: 2026-10-14-admin-server-status
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台管理员 | 持 platform:admin（或被勾选 system_status:read 的用户），查看服务器信息页 |
| 普通登录用户 | 无 system_status:read 权限，不可见菜单、不可调接口 |
| 匿名访问者 | 未登录，直接调 /api/system-status 应被拒（BS-6 收紧） |

## 功能需求

### FR-01: 接口鉴权收紧
覆盖决策：D-001@v2, D-004@v1
Given GET /api/system-status 现为完全公开
When 本次变更后分别以未登录 / 无权限登录 / 持 system_status:read 或 platform:admin 登录调用
Then 依次必须返回 401 / 403 / 200，且 200 响应体结构与现状必须完全一致（SystemStatusResponse 零变化）

### FR-02: 服务器信息页面
覆盖决策：D-002@v2, D-005@v1
Given 管理员登录并进入 /admin/server-status
When 页面加载及此后每 5 秒
Then 必须渲染三组卡片——服务器性能（CPU/内存/磁盘进度条，含已用/总量与百分比，阈值着色 <80% 主题紫 / 80–90% 琥珀 / >90% 红）、业务统计（任务/项目/里程碑/用户四格）、依赖与版本（PostgreSQL/Redis 连接徽标 + 后端版本/commit/环境/UTC 服务器时间）；页头必须显示「自动刷新 · 上次更新 HH:mm:ss」与立即刷新按钮
When 接口请求失败（403/网络错误/超时；401 由全局拦截单飞刷新或跳登录，见 frontend/src/lib/api.ts:250-256，非页内降级承接面）
Then 页内必须显示错误条降级（语义 token 浅红底），禁止白屏或清空既有数据，5 秒后必须自动重试

### FR-03: 权限可分配
覆盖决策：D-004@v1
Given Permission 枚举新增 SYSTEM_STATUS_READ="system_status:read"（group=PLATFORM 默认分支）
When 管理员打开角色管理页权限勾选器
Then 「服务器信息」菜单卡必须出现且可勾选 system_status:read（展示名「服务器状态查看」）；存量角色与用户权限必须零变化（无种子迁移，platform:admin 直通天然放行管理员）

### FR-04: 菜单注册与导航
覆盖决策：D-003@v1, D-005@v1
Given menu-permissions.ts system 组现有 5 条
When 新增第 6 条 menuKey=server-status（label=服务器信息，href=/admin/server-status，absolute，permissions=[system_status:read]）与 app-shell MENU_ICON_MAP "/admin/server-status" 图标
Then 系统管理组必须显示 6 项菜单，持权限者可进入；admin/menus 测试断言与声明序锚必须同步重算（system 组既有锚定索引 users=18/org=19/roles=20 不动，ppm 组索引整体 +1）

## 非功能需求
- 兼容性：SystemStatusResponse 响应结构零变化；/api/health 保持公开不动（负载均衡健康检查依赖）
- 主题：页面遵循 AI-Native 双主题（brand-* 语义阶 + 主题 token，themes.ts 单一源），blue/ai-native 双主题下均正常渲染
- 平台：代码兼容 Windows/Linux/macOS（后端 psutil 跨平台既有；前端无平台相关逻辑）
- 轮询健壮性：组件卸载清理定时器；页面不可见时不强制暂停（保持简单，与原看板口径一致）
- UI/文案：中文，样式对齐 FRONTEND_PAGE_STYLE.md（PageContainer/PageHeader 骨架、antd 组件 + tailwind 布局）

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v2 | FR-01 | 接口收紧为登录+权限（用户亲选） |
| D-002@v2 | FR-02 | 页面内容=原看板全部+连接状态（用户亲选） |
| D-003@v1 | FR-04 | system 组末尾落位，锚定影响最小化 |
| D-004@v1 | FR-03 | 新权限免种子迁移（platform:admin 直通） |
| D-005@v1 | FR-02, FR-04 | 实现方案 A 独立页面（用户亲选） |
| D-006@v1（rejected） | — | 并入设置页，防复潮登记 |
| D-007@v1（rejected） | — | 首页挂卡片，防复潮登记 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
