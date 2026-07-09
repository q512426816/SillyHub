---
author: WhaleFall
created_at: 2026-07-09 09:36:42
---

# Requirements — Remote Folder Picker

> 变更 `2026-07-09-remote-folder-picker` · 行为规格。设计依据见 `design.md`，决策见 `decisions.md`。

## 角色表

| 角色 | 可执行操作 | 权限来源 |
|---|---|---|
| Runtime 拥有者（owner） | 浏览**自己拥有** daemon 主机的磁盘根与目录（`list_roots` / `list_dir`） | `get_current_principal` + `_get_owned_runtime`（`router.py:1329/1338`，非 owner→404） |
| 平台管理员（admin，`RUNTIME_ADMIN`） | 保存可写目录白名单（`PUT /allowed-roots`） | `RuntimeAdminUser`（`router.py:574/264`） |
| daemon 进程 | 在宿主机执行只读目录列举，返回 roots / entries | daemon WS RPC（`list_roots` / `list_dir`） |

> 读（浏览）= owner 校验；写（保存）= admin 限定。两层不同（D-007）。非 admin 用户可浏览但保存收 403（既有行为）。

## 功能需求

### FR-1 · daemon `list_roots` 跨平台根列举
daemon 提供 `list_roots` RPC，按需返回本机磁盘根锚点。Windows 枚举存在的盘符（A-Z `existsSync` 探测）；Linux/macOS 返回 `/`。

### FR-2 · backend `POST /list-roots` 代理
backend 新增端点转发 `list_roots` RPC，复用 `list_dir` 的 ownership 校验与错误映射（offline→504 / timeout→504 / forbidden→403）。新增 `ListRootsResponse { roots: list[str] }`。

### FR-3 · `RemoteFolderPicker` 可复用组件
前端封装自治组件：`open` 受控；打开时 `listRoots` 初始化根 → antd Tree `loadData` 懒加载 `listDir`（只显 `dir`）→ 地址栏手输跳转前探 `listDir` 校验 → 选中后 `onPick(path)` 回调；daemon 离线/超时/无权限降级提示不崩溃。

### FR-4 · Runtime 配置页接入
`runtimes/page.tsx` 可写目录「浏览」按钮打开 `RemoteFolderPicker`，选中回填输入框；引入 `pickerRowIdx` state 替代旧的 `browseRuntimeId` + `browseTargetRef`。

### FR-5 · 移除 `browse_folder` 三端
彻底删除 daemon handler（`daemon.ts:2114`）+ backend 端点与内联 schema（`router.py:1398/1404/1411`）+ frontend `browseFolder()`（`lib/daemon.ts:259`）与 `handleBrowseNative`（`page.tsx:714`）及 UI 入口。

### FR-6 · 即时刷新（复用）
可写目录保存仍走 `PUT /allowed-roots` → WS `policy_update`（在线秒级生效）；daemon 离线时下次心跳 `_syncAllowedRoots` 兜底。不新增刷新通道。

## 行为规格（Given / When / Then）

**FR-1**
- Given daemon 运行在 Windows 主机有 C/D 盘；When backend 调 `list_roots` RPC；Then 返回 `{roots:["C:\\","D:\\"]}`，单盘探测失败不中断。
- Given daemon 运行在 Linux/macOS；When 调 `list_roots`；Then 返回 `{roots:["/"]}`。

**FR-2**
- Given owner 调 `POST /list-roots`；Then 200 + roots。
- Given 非 owner 调；Then 404。Given daemon 离线；Then 504。

**FR-3**
- Given 组件 open 且 daemon 在线；When 展开某目录节点；Then 调 `listDir` 加载一级子目录（只 dir），节点渲染子树。
- Given 地址栏输入不存在路径并跳转；Then 提示「路径不存在或非目录」并禁用「选择此目录」。
- Given daemon 离线；Then 顶部红条提示，地址栏仍可输入。
- Given 选中目录并点确认；Then `onPick(绝对路径)` 触发，组件关闭。

**FR-4**
- Given 可写目录编辑 modal 某行点「浏览」；When 选中目录确认；Then 该行输入框填入选中路径。
- Given 保存；Then `PUT allowed-roots` 成功（admin）。

**FR-5**
- Given 代码库；When grep `browse_folder`/`browseFolder`/`BrowseFolder`；Then daemon/backend/frontend 三端均无命中。
- Given `POST /browse-folder`；Then 404。

**FR-6**
- Given admin 保存新 allowed_roots 且 daemon 在线；Then daemon PolicyCache 秒级更新（`policy_update` 推送）。

## 非功能需求

- **NFR-1 跨平台**：daemon `listRoots` 在 Windows / Linux / macOS 均正确返回根（CLAUDE.md 规则 12）。
- **NFR-2 非递归懒加载**：仅按需返回一级子目录，不一次性递归扫描全盘（复用 `list_dir` 既有非递归语义）。
- **NFR-3 双库边界**：组件用 antd Modal/Tree（业务组件）+ shadcn Input/Button（视觉组件），走现有 token（符合样式系统）。
- **NFR-4 中文 UI**：所有面向用户文案中文（CLAUDE.md 规则 11）。
- **NFR-5 已知限制显式**：Windows UNC / 无盘符网络盘不在 roots 列表，地址栏手输兜底（design §10 R-01）。

## D-xxx@vN 覆盖关系

| 决策 | 覆盖 FR / NFR | 设计章节 |
|---|---|---|
| D-001@v1 roots ≠ allowed_roots 术语分离 | FR-1 / FR-2 | design §7.1 / §7.2 |
| D-002@v1 list_roots 放开全盘只读，沿用 ownership | FR-2 / NFR-1 | design §7.2 / §10 R-02 |
| D-003@v1 手动输入须探 list_dir 校验 | FR-3 | design §7.3 / §10 R-04 |
| D-004@v1 daemon 离线/超时 → UI 降级不崩溃 | FR-3 | design §7.3 / §10 R-03 |
| D-005@v1 配置刷新复用 WS policy_update + 心跳兜底 | FR-6 | design §1 / §5 / §9 |
| D-006@v1 不做新建文件夹；不收紧权限；browse_folder 彻底删 | FR-3 / FR-5 / 非目标 | design §3 / §6 / §9 |
| D-007@v1 读(owner)/写(admin)权限分层 | FR-2 / FR-6 / 角色表 | design §10 R-02 |
