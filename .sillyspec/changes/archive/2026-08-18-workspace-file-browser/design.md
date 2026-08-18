---
author: qinyi
created_at: 2026-08-18T11:25:00
scale: large
---

# 设计文档（Design）— 工作区文件浏览器（只读）

## 1. 背景

平台的工作区（workspace）目前没有任何「直接看文件」的入口：用户想确认工作区里某个文件的内容，只能离开平台去本机 IDE 翻。代码调研确认的事实：

- **工作区代码文件只存在于各成员本机的 daemon 宿主机**（`backend/app/modules/spec_workspace/router.py:151-152` 注释明说 backend 读不到 `root_path`），服务器侧只有 spec 镜像树（`.sillyspec`）和平台文件中心（MinIO 附件），都不是工作区代码。
- backend 已有的文件类端点都是别的作用域：runtime 级 `list-dir`（`daemon/router.py:1406`，不走 workspace 权限）、change 目录级 files API（`change/router.py:293`，只覆盖变更目录）、scan-docs（DB 文档，非磁盘）。
- daemon 侧 `file-rpc.ts` 只有 `listDir`（只返回 name/type，且无内容读取能力，原非目标"FR-05 spec 走 bundle/sync"针对的是 spec 文件，不覆盖代码浏览场景）。

因此需要新增一条「浏览器 → backend → daemon → 宿主机磁盘」的只读浏览链路，让用户在工作区页直接看目录树和文件内容。

## 2. 设计目标

- 工作区顶部标签栏新增「文件」页（路由 `/workspaces/[id]/explorer`，因 `/files` 已被「方案文件」占用），左树右预览 VSCode 式布局。
- 实时浏览**当前登录用户自己绑定**的工作区副本（`workspace_member_runtimes` 按 `workspace_id + user_id` 解析 `daemon_id + root_path`）。
- 文件预览：代码按语言高亮（react-syntax-highlighter/Prism）、Markdown 渲染（复用 `@uiw/react-markdown-preview` 封装 `MarkdownText`）、图片内联显示、任意文件可下载。
- 文件名全局搜索：工作区全树递归按文件名/目录名匹配，结果点击直达。
- 只读：不产生任何写操作；三端降级态完整（daemon 离线 / 未绑定 / daemon 版本过低）。

## 3. 非目标（Non-Goals）

- ❌ 任何写操作（新建/编辑/删除/重命名/上传）。
- ❌ 文件内容全文搜索（grep 语义）——本期只做按文件名搜索。
- ❌ 递归预取整棵树 / 目录体积统计 —— 懒加载逐层展开（沿用 `file-rpc.ts` 既定语义）。
- ❌ 服务器侧文件缓存/镜像 —— 实时转发，不落平台存储。
- ❌ 浏览他人绑定的工作区副本（跨成员浏览是另一安全议题）。
- ❌ symlink 深层沙箱——不递归校验 tree 列出的每个 symlink 指向（沿用 `file-rpc.ts:22-23` 已知限制，不扩大；read 路径的 symlink 逃逸已由 realpath 落点校验覆盖，见 R-01）。

## 4. 拆分判断

单变更交付：三端改动围绕同一条浏览链路（daemon RPC → backend 端点 → 前端页面），拆开任一端都不可独立验收。无重复模板×数据模式，不走批量。

## 5. 总体方案（方案 B，用户选定）

```
浏览器 ──JWT──► backend  GET /api/workspaces/{wid}/explorer/{tree|file|download|search}
                    │ ① require_permission(WORKSPACE_READ)
                    │ ② MemberBindingResolver.resolve_member_binding_or_none(wid, user.id)
                    │    → (daemon_id, root_path)（复用 member_runtimes/resolver.py）
                    │ ③ rel 路径 containment 预检（按 root 形态分发 PureWindowsPath/PurePosixPath）
                    ▼ WS RPC（ws_hub.send_rpc，显式 timeout：tree/file 30s、search/download 60s；
                       默认 RPC_DEFAULT_TIMEOUT=10s（ws_hub.py:39）不够用，必须显式传）
                daemon  explorer_list_dir / explorer_read_file / explorer_search
                    │ ④ 主防线：realpath 落点必须在 root 内 + assertWithinAllowedRoots 双重校验
                    │ ⑤ search 递归遍历时跳过噪声目录（node_modules/.git/dist/__pycache__/.next 等，
                    │    仅 search 排除；tree 全量返回由前端正常展示）
                    ▼
                宿主机工作区磁盘（只读 readdir/readFile，文本 ≤10MB 截断）
```

### Wave 划分

- **Wave 1（daemon）**：`file-rpc.ts` 新增 `explorerListDir` / `explorerReadFile` / `explorerSearch` + `daemon.ts` 注册 3 个 handler；daemon 测试。
- **Wave 2（backend）**：新模块 `app/modules/explorer/`（router/service/schema，绑定解析复用 MemberBindingResolver）+ main 挂载 + 错误映射；backend 测试；`pnpm gen:types`。
- **Wave 3（frontend）**：explorer 页面 + 左树右预览组件 + 搜索 + 降级态 + 「文件」标签；新增依赖 react-syntax-highlighter；frontend 测试。搜索结果「直达文件」需对命中项的祖先链逐层调用 tree 端点展开 loadData（祖先链逐跳 await，命中即选中），工作量计入本 Wave。

Wave 1→2→3 顺序依赖（接口契约先行），Wave 内任务可并行。

### 关键安全设计

1. **daemon 侧双重校验（主防线）**：backend 跑在 Linux Docker 而 `root_path` 通常是 Windows 路径，backend 无法可靠校验远端路径语义（`os.path.normpath` 在 Linux 不折叠 `..\`、不认盘符）——真正的主防线在 daemon 自己平台上执行：
   - `explorer_*` 方法要求 backend 传 `root` 参数；daemon 先 `fs.realpath(path)` 与 `fs.realpath(root)` 解析符号链接后做边界敏感前缀比较（杜绝工作区内 symlink 指向 root 外的逃逸），再做 `assertWithinAllowedRoots(path, roots)`（roots 取 `_effectiveAllowedRoots()` 现值）。两层都过才读盘。
   - ⚠️ 注册 handler 时**不得**照抄 `_registerListDirRpcHandler` 的空 roots 跳校验写法（ql-20260706-006 对裸 `list_dir` 的豁免不适用于 explorer_*）。
2. **backend containment（预检，非主防线）**：按 `root_path` 形态分发——含盘符/反斜杠/UNC 前缀用 `PureWindowsPath` 语义（折叠 `..`、盘符大小写归一），否则 `PurePosixPath`；拒绝绝对路径、`..` 逃逸、空路径外的控制字符。目的只是尽早拒明显恶意/错误输入，安全裁决以 daemon 为准。
3. **版本耦合降级**：旧 daemon 未注册 `explorer_*` → ws-client 回 `method_not_found`（`ws-client.ts:_dispatchRpc` 既有行为）→ backend 映射为 422「本机 daemon 版本过旧，不支持文件浏览，请升级 daemon」。
4. **绑定语义**：复用 `MemberBindingResolver.resolve_member_binding_or_none`（`member_runtimes/resolver.py`）只看当前用户自己的绑定行（PK(workspace_id, user_id)），**不复用** `resolve_daemon_instance_for_workspace`（无 user 门控 LIMIT 1，多绑定时可能命中他人/离线 daemon，属已知坑）。绑定行存在但 `daemon_id IS NULL`（合法过渡形态）同样按未绑定处理 → 404 引导。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/file-rpc.ts` | 新增 `explorerListDir(path, root, roots)` / `explorerReadFile(path, root, roots, encoding)` / `explorerSearch(root, query, maxResults)` + `EXPLORER_EXCLUDED_NAMES` 常量（仅 search 用）+ `EXPLORER_MAX_READ_BYTES=10MB`；三个方法统一走 realpath 落点校验 + allowed_roots 双重校验。producer=daemon fs → RPC result JSON（snake_case 键由 backend schema 对齐）→ consumer=backend explorer.service |
| 修改 | `sillyhub-daemon/src/daemon.ts` | 注册 `explorer_list_dir` / `explorer_read_file` / `explorer_search` 三个 handler（roots 取 `_effectiveAllowedRoots()`；**不得**照抄裸 list_dir 的空 roots 跳校验写法） |
| 新增 | `sillyhub-daemon/src/__tests__/file-rpc-explorer.test.ts`（或既有测试目录同规） | 双校验/realpath symlink 逃逸/截断/二进制嗅探/base64 encoding/搜索上限/噪声排除 |
| 新增 | `backend/app/modules/explorer/__init__.py` | 模块占位 |
| 新增 | `backend/app/modules/explorer/schema.py` | `ExplorerEntry/ExplorerTreeResponse/ExplorerFileResponse/ExplorerSearchResponse`。producer=daemon RPC result → service 归一化（路径 rel 化、字段校验）→ response_model 序列化 → consumer=前端 `lib/explorer.ts` |
| 新增 | `backend/app/modules/explorer/service.py` | 复用 `MemberBindingResolver.resolve_member_binding_or_none` 解析绑定 + PureWindows/PurePosix 分发 containment 预检 + `ws_hub.send_rpc` 显式超时转发 + 错误映射（offline/timeout/forbidden/not_found/method_not_found/WS 断连） |
| 新增 | `backend/app/modules/explorer/router.py` | 4 端点，`require_permission(WORKSPACE_READ)`；download 返回 StreamingResponse + Content-Disposition |
| 复用 | `backend/app/modules/workspace/member_runtimes/resolver.py` | **无改动**——直接复用既有 `MemberBindingResolver.resolve_member_binding_or_none`（spec_workspace/router.py:164 同款用法）；不新增查询函数 |
| 修改 | `backend/app/main.py` | 挂载 explorer router |
| 新增 | `backend/tests/modules/explorer/test_explorer.py` | containment 拒绝矩阵/绑定解析/RPC 错误映射/download 头 |
| 修改 | `backend/openapi.json` | `pnpm gen:types` 产物（4 端点 schema） |
| 修改 | `frontend/src/lib/api-types.ts` | `pnpm gen:types` 产物。producer=openapi.json → consumer=lib/explorer.ts 类型 |
| 新增 | `frontend/src/lib/explorer.ts` | 4 端点 fetch 封装（TanStack Query hook） |
| 新增 | `frontend/src/app/(dashboard)/workspaces/[id]/explorer/page.tsx` | 页面装配：左树右预览 + 工具栏 + 三降级态 |
| 新增 | `frontend/src/components/explorer/file-explorer.tsx` | antd Tree loadData 懒加载 + 搜索框 + 结果列表 |
| 新增 | `frontend/src/components/explorer/file-preview.tsx` | 按类型分发：代码→react-syntax-highlighter；md→MarkdownText；图片→fetch blob→objectURL；二进制/截断→元信息卡+下载按钮 |
| 修改 | `frontend/src/components/workspace-tabs.tsx` | TABS 加「文件」项（href `explorer`） |
| 修改 | `frontend/package.json` + `frontend/pnpm-lock.yaml` | 新依赖 `react-syntax-highlighter` + `@types/react-syntax-highlighter` |
| 新增 | `frontend/src/components/explorer/__tests__/file-explorer.test.tsx` 等 | 懒加载/预览分发/降级态/搜索交互 |

## 7. 接口定义

### 7.1 daemon RPC（`daemon:rpc` envelope，三端键名 snake_case 对齐）

```text
explorer_list_dir   params: { path: string(绝对), root: string(绝对) }
  → { entries: [{ name, type: "dir"|"file", size: number, mtime: string(ISO) }] }
explorer_read_file  params: { path: string(绝对), root: string(绝对),
                              encoding: "utf8" | "base64" (默认 utf8) }
  → { name, size, mtime, binary: boolean, truncated: boolean,
      content: string }   // encoding=utf8 且文本→原文（≤10MB 截断，截断先于传输）；
                          // encoding=base64（download 链路强制）或二进制→base64；
                          // utf8 解码失败 → binary=true + base64 兜底（不报错）
explorer_search     params: { root: string(绝对), query: string, max_results: number }
  → { matches: [{ path: string(相对root), name, type }], truncated: boolean }
  // 递归遍历跳过 EXPLORER_EXCLUDED_NAMES；大小写不敏感子串匹配；上限默认 100
```

错误码沿用 `RpcError` 体系：`forbidden`（越界，含 realpath 逃逸）/ `not_found`（路径不存在或 root 已删）/ `internal`；未注册方法由 ws-client 回 `method_not_found`。

### 7.2 backend HTTP（`/api/workspaces/{workspace_id}/explorer`）

| 端点 | 入参 | 响应 | RPC timeout |
|---|---|---|---|
| `GET /tree?path=<rel>` | rel 相对路径，空=根 | `ExplorerTreeResponse{entries[]}` | 30s |
| `GET /file?path=<rel>` | 同上 | `ExplorerFileResponse{name,size,mtime,binary,truncated,content?}`（encoding=utf8） | 30s |
| `GET /download?path=<rel>` | 同上 | `StreamingResponse` + `Content-Disposition: attachment; filename*=UTF-8''<name>`（encoding=base64 强制，避免非 utf8 文件被文本往返损坏） | 60s |
| `GET /search?q=<kw>` | 关键词 | `ExplorerSearchResponse{matches[],truncated}` | 60s |

统一错误映射（沿用 `daemon/router.py:list_dir` 先例）：未绑定或绑定行 `daemon_id IS NULL`→404「当前账号未绑定本机工作区，请先到成员页完成绑定」；daemon `not_found`（root_path 已删/路径不存在）→404；daemon 离线→502；超时→504；daemon `forbidden`→403；`method_not_found`→422「daemon 版本过旧」；WS 断连（如 1009 消息超限）→502「传输中断」；containment 预检拒绝→422「路径越界」。

### 7.3 前端类型

由 `pnpm gen:types` 从 openapi.json 生成进 `api-types.ts`，`lib/explorer.ts` 引用，禁止手写。

## 7.5 生命周期契约表

本变更不改变任何 session/lease/agent_run 生命周期状态机，但新增 backend↔daemon RPC 事件，按契约表登记：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| explorer_list_dir | backend | daemon | path, root | 无（只读） |
| explorer_read_file | backend | daemon | path, root | 无（只读） |
| explorer_search | backend | daemon | root, query, max_results | 无（只读） |

三个事件均为无状态只读 RPC，对应任务：daemon handler 实现（W1）+ backend 转发（W2）+ 三端测试。

## 8. 数据模型

无表结构变更。只读消费既有 `workspace_member_runtimes`（PK(workspace_id, user_id)，字段 daemon_id/root_path）。

## 9. 兼容策略

- 未升级 daemon：前端显示「daemon 版本过旧」降级卡，其它功能不受影响（`method_not_found` 映射）。
- 未绑定工作区的用户：显示绑定引导卡，不影响其它标签页。
- 不改任何既有端点/表结构/RPC 方法签名；`list_dir` 裸方法（文件夹选择器用）保持原样不动。
- 跨平台：containment 与 allowed_roots 校验均做 Windows 盘符大小写归一（`assertWithinAllowedRoots` 既有逻辑）；搜索用纯 Node `fs` 递归遍历，不 shell out，Win/Mac/Linux 行为一致。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 借 RPC 读宿主机任意文件（路径穿越/symlink 逃逸） | P0 | daemon 主防线：realpath 落点必须在 realpath(root) 内 + allowed_roots 双校验（backend 跨平台预检仅辅助）；测试覆盖 `../`/绝对路径/UNC/工作区内 symlink 指外 矩阵 |
| R-02 | 旧 daemon 无 explorer_* 方法 | P1 | `method_not_found` → 422 友好提示；前端降级卡 |
| R-03 | 大仓库搜索/深目录懒加载慢（Windows bind mount stat 性能断崖前科：ql-008 reparse 33s） | P1 | daemon 搜索跳过噪声目录+结果上限 100+单遍 `readdir {withFileTypes}`（避免双 stat）；search/download 显式 60s 超时；树懒加载不预取。**实测（task-09，本仓库约数千文件）：以 "README" 全树搜索 16 个匹配耗时 153.48 ms，未触发 truncated；Windows bind mount 大仓库待用户本机进一步验证** |
| R-04 | 10MB 文件经 WS RPC base64 ≈13.3MB，逼近 ws 默认 16MiB maxPayload；超限表现是 WS 断连（1009）而非 RPC error | P2 | 截断在 daemon 侧先于传输；显式超时 tree/file 30s、search/download 60s（默认 10s 不够用）；断连映射 502「传输中断」。**实测（task-09）：daemon 侧读取 10MB 文件并 base64 编码耗时 11.69 ms，产出 payload 13.98 MB，距 WS 16MiB 上限余量约 2.0 MB；backend download 全链路真实 daemon 绑定环境待用户本机 smoke 补测** |
| R-05 | 多成员绑定语义混淆（看到别人的树） | P1 | 只解析当前用户绑定行；无绑定→引导卡 |
| R-06 | 图片/下载需带 JWT，`<img src>` 裸 URL 无鉴权头 | P2 | 前端 fetch（Bearer）→ blob → objectURL 渲染 |

## 11. 决策追踪

- **D-001@v1** 数据来源=实时 daemon RPC 浏览真实代码树（非 spec 镜像/缓存）→ 覆盖于 §5 总体方案、FR-01。
- **D-002@v1** 取数通道=方案 B 扩展 file-rpc（非复用 host_fs 内部通道）→ 覆盖于 §5 Wave 1、§7.1。
- **D-003@v1** 多成员语义=当前用户自己绑定副本 → 覆盖于 §5.4、R-05。
- **D-004@v1** 文本预览截断上限 10MB（用户从 2MB 上调）→ 覆盖于 §7.1、R-04。
- **D-005@v1** 搜索=按文件名全树搜索（非内容 grep、非已加载节点过滤）→ 覆盖于 §7.1 explorer_search、FR-04。

无未解决决策。

## 12. 自审

- 章节齐全：背景/目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪 ✅
- 关键词命中 daemon/lease 语境 → 生命周期契约表已含（§7.5，三事件状态变化=无）✅
- 文件变更清单含对外字段行（RPC result、HTTP 响应、api-types）均已标 producer→consumer 数据流 ✅
- 每个 D-xxx@v1 均有设计章节覆盖 ✅
- ⚠️ 自审存疑：R-03 的 Windows bind mount 场景下 explorer_search 深树遍历耗时尚无实测数据，以结果上限+噪声排除+60s 超时兜底，execute 阶段需在真实仓库（本仓库约数千文件）实测一次搜索耗时并记录。
- Design Grill 修订记录（第 1 轮 qualityVerdict=fail → 已修）：①超时基准更正为 RPC_DEFAULT_TIMEOUT=10s 并写明四端点显式超时；②backend containment 降级为预检（跨平台路径语义不可可靠校验），daemon realpath 双重校验升主防线；③复用 MemberBindingResolver 替代新增查询函数；④补 not_found→404、daemon_id IS NULL→404、WS 断连→502 映射；⑤read_file 加 encoding 参数，download 强制 base64；⑥噪声排除仅作用 search，tree 全量；⑦Wave 3 补搜索直达祖先链展开。
