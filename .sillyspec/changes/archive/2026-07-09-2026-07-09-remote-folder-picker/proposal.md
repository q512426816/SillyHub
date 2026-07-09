---
author: WhaleFall
created_at: 2026-07-09 09:36:42
---

# Proposal — Remote Folder Picker（基于 Daemon 的远程目录浏览器）

> 变更 `2026-07-09-remote-folder-picker` · 方案 A（详见 `design.md`）

## 动机

Runtime 的「可写目录」（`allowed_roots`）属于 **Daemon 所在机器**，而非打开 Web 页面用户所在电脑。因此目录浏览必须由 Daemon 提供数据、在前端呈现。当前实现存在结构性缺陷，需重构为 daemon 供数 + 前端懒加载树形浏览，并封装为可复用组件。

## 关键问题（现有方案为何不够）

1. **系统弹窗远程不可达**：`browse_folder` 让 daemon 调 PowerShell `Shell.Application.BrowseForFolder`（`daemon.ts:2114`）弹出 **daemon 主机上的原生系统对话框**。当 daemon 部署在远程服务器时，Web 页面用户根本看不到、无法交互——这是结构性不可用，不是 bug 修补能解决的（此前 `FolderBrowserDialog` 还因缺消息循环卡死，见 commit `d4c68f10`）。

2. **树形雏形跨平台残废**：前端已有 antd Tree 懒加载雏形（`page.tsx:630-711`），但根节点硬编码 `['C:\\','D:\\','E:\\','F:\\','G:\\']` 逐个 `listDir` 探测（`page.tsx:649`）。注释声称"尝试 Unix 根 `/`"但循环里并未加入——**Linux/macOS daemon 下根节点为空，浏览器完全不可用**；Windows 也只覆盖 C~G 盘，H 以后盘符/网络盘/USB 不可见。

3. **逻辑不可复用**：树形浏览逻辑全部内联在 `runtimes/page.tsx`（巨型组件），无法给后续 Workspace / Project / 日志浏览模块复用，每次都要重写。

## 变更范围

- **daemon**：新增 `list_roots` RPC（业务层 `src/roots-rpc.ts`，Win 枚举 A-Z existsSync / Unix 返 `/`），与 `list_dir` 同线、浏览自由。
- **backend**：新增 `POST /runtimes/{id}/list-roots` 薄代理（复用 ownership + 错误映射）+ `ListRootsResponse` schema。
- **前端**：新增可复用 `RemoteFolderPicker` 组件（自治：list_roots 初始化根 → Tree loadData 懒加载 listDir → 手输校验 → onPick）+ `listRoots()` 客户端函数；改造 `runtimes/page.tsx` 接入并删除内联树形逻辑。
- **移除**：彻底删除 `browse_folder` 三端代码（daemon handler + backend 端点/内联 schema + frontend 函数/调用/UI）。
- **刷新**：复用既有 `PUT /allowed-roots → WS policy_update`，不新增刷新通道。

## 不在范围内（显式清单）

- ❌ 不做「新建文件夹」（YAGNI，需求只提选择；D-006）。
- ❌ 不迁移 Workspace / Project / 日志浏览到新组件（本次仅 Runtime 配置页接入 + 组件就绪，后续变更复用）。
- ❌ 不收紧 `list_dir` / `list_roots` 权限（沿用 ownership，本次非权限重构；D-002 / D-007）。
- ❌ 不改 `list_dir` 既有契约、`host_fs.*` 八方法、`PUT /allowed-roots` 与 WS `policy_update` 链路。
- ❌ 不做暗色模式 / 移动端适配（沿用样式系统既有范围）。

## 成功标准（可验证）

1. daemon `list_roots`：Windows 返回存在的盘符（如 `["C:\\","D:\\"]`）、Linux/macOS 返回 `["/"]`；异常环境 fallback 不崩（design §10 R-01）。
2. backend `POST /list-roots`：owner 返 200 + roots；非 owner 返 404；daemon 离线返 504（照抄 list_dir 测试模式）。
3. `POST /browse-folder` 返 404（已删除）；`browseFolder()` / `browse_folder` handler 不再存在于代码（grep 三端为空）。
4. `RemoteFolderPicker`：打开加载根 → 展开懒加载子目录 → 手输不存在路径提示并禁用确认 → onPick 回传正确路径。
5. 跨平台：Windows daemon 显示盘符根、Linux daemon 显示 `/` 根，均可正常展开。
6. 保存后 daemon PolicyCache 即时更新（在线秒级）；非 admin 用户保存收 403（既有行为不回归，D-007）。
7. 三端 `tsc` / `pytest` / daemon 测试通过 + Docker rebuild 实测 Runtime 配置页。
