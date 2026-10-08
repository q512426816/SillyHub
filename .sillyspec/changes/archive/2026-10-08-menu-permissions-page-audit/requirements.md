---
author: flow-machine-draft
created_at: 2026-10-08T02:13:50.083Z
---
# 需求规格（Requirements）— 2026-10-08-menu-permissions-page-audit

## 功能需求

### FR-01: 上述 7 个菜单卡 permissions 各自补齐缺口权限（既有 key 不删、门控主 key 保持首位）

- 菜单注册表（frontend/src/lib/menu-permissions.ts）中以下 7 个菜单卡的 permissions 必须补齐页面实际所需权限，既有 key 禁止删除，原首位门控主 key 必须保持首位：
  - components：+ workspace:read（列表端点 GET /api/workspaces/{ws}/components 鉴权 workspace:read；component:read 无后端消费、保留为门控 key）
  - changes：+ task:read（变更任务列表/看板/详情子页 GET /api/workspaces/{ws}/tasks*、/changes/{cid}/tasks/board 鉴权 task:read）
  - knowledge：+ knowledge:write（写端点 8 处 require KNOWLEDGE_WRITE，页面有写按钮）
  - mcp：+ settings:admin（平台库写端点 mcp_registry settings_admin_check）
  - approvals：+ task:read（agent-sessions 列表 /workspaces/{ws}/agent-sessions、dialogs 列表 /workspaces/{ws}/dialogs 鉴权 task:read）+ task:run_agent（会话权限面板消费的 daemon 会话端点族）
  - audit：+ change:read（工作区审计日志 GET /workspaces/{ws}/audit 鉴权 change:read；platform:audit:read 无后端端点消费、保留）
  - incidents：+ deploy:staging（上报事件 POST /api/workspaces/{ws}/incidents 鉴权 deploy:staging）

#### 场景：主路径

- Given 菜单注册表已加载
- When 读取上述 7 个菜单的 permissions
- Then 每卡包含原有全部 key（首位不变）+ 上表新增 key

#### 场景：可见性放宽

- Given 某 role 仅持 change:read（无 platform:audit:read）
- When 侧边栏渲染
- Then 审计中心菜单可见（任一命中语义；此前持 platform:audit:read 看得到但页面 403、持 change:read 打得开但看不到菜单的双向错位修正）

### FR-02: 每个新增 key 有后端端点消费依据（router 文件级引用）

- FR-01 每个新增 permission key 必须在 backend/app/modules/**/router*.py 存在至少一处 require_permission/require_permission_any 引用（workspace:read→workspace/router.py:312/451 等；task:read→task/router.py:39/66/81、agent/router.py:193/421/485/517；knowledge:write→knowledge/router.py 8 处；settings:admin→mcp_registry/router.py:68；task:run_agent→daemon/router/__init__.py:119；change:read→workflow/router.py:37/51；deploy:staging→incident/router.py:71），代码注释中必须落对应依据。

#### 场景：主路径

- Given 本变更 diff
- When 检查 menu-permissions.ts 各新增项注释
- Then 每项引用了后端 router 端点文件

### FR-03: menu-permissions 相关测试（含 6 子菜单 workspace:read 断言、changes/audit 用例）同步更新并全绿

- frontend/src/lib/__tests__/menu-permissions.test.ts 必须同步：changes 用例加 task:read、audit 用例加 change:read、「6 个子菜单有独立 read 权限」用例对 components 的 not.toContain("workspace:read") 断言必须改为豁免（components 卡现含页面所需 workspace:read）。全部相关用例必须通过。

#### 场景：主路径

- Given 测试已更新
- When 运行 menu-permissions / permission / 勾选器 / app-shell / menu-overrides 相关测试
- Then 全部通过

### FR-04: tsc 与改动文件 eslint 零新增报错

- frontend tsc --noEmit 必须零输出；改动文件 eslint 必须零 error（存量 warning 不新增）。禁止跑全量测试。

#### 场景：主路径

- Given 变更代码完成
- When pnpm typecheck + eslint 改动文件
- Then 无新增报错

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/lib/__tests__/menu-permissions.test.ts「changes = change:create/read/update/approve/archive + task:read（2026-10-08 补齐）」+「audit = platform:audit:read + change:read（2026-10-08 补齐）」等注册表用例
FR-02: 不适用：静态注释依据（后端 router 引用已在 FR-01 正文锚定），无独立测试面
FR-03: frontend/src/lib/__tests__/menu-permissions.test.ts「6 个子菜单有独立 read 权限（不再共用 workspace:read）」（components 豁免断言）
FR-04: frontend/src/lib/__tests__/menu-permissions.test.ts + frontend/src/lib/__tests__/permission.test.ts 全文件（tsc/eslint 为命令面验证）
