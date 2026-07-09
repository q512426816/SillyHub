---
author: WhaleFall
created_at: 2026-07-09T09:30:00
---

# design.md — Remote Folder Picker（基于 Daemon 的远程目录浏览器）

> 变更 `2026-07-09-remote-folder-picker` · 方案 A（新增独立 `list_roots` RPC + 自治 RemoteFolderPicker 组件）
> 原型 `prototype-remote-folder-picker.html`

## 1. 背景

Runtime 的「可写目录」（`allowed_roots` 白名单）配置在 `frontend/src/app/(dashboard)/runtimes/page.tsx`。当前目录选择存在两种并存方式：

1. **前端树形浏览器雏形**（`page.tsx:630-711` + modal `1219-1279`）：基于 antd `Tree` + `loadData` 懒加载，调 daemon `list_dir` RPC。**但根节点硬编码 Windows 盘符** `['C:\\','D:\\','E:\\','F:\\','G:\\']` 逐个 `listDir` 探测（`page.tsx:649`）——注释声称"尝试 Unix 根 `/`"但循环里并未加入，导致 **Linux/macOS daemon 下根节点为空，浏览器完全不可用**；Windows 也只覆盖 C~G 盘，H 以后的盘/网络盘/USB 不可见。
2. **系统弹窗**（`browse_folder`）：daemon 端用 PowerShell `Shell.Application.BrowseForFolder`（`sillyhub-daemon/src/daemon.ts:2114`）弹出 **daemon 主机上的原生系统对话框**。**核心痛点**：弹的是 daemon 所在机器的对话框，当 daemon 部署在远程服务器时，Web 页面用户根本看不到、无法交互（此前 `FolderBrowserDialog` 还因缺消息循环卡死，见 commit `d4c68f10`）。

Runtime 的可写目录属于 **Daemon 所在机器**，而非打开 Web 页面用户所在电脑——因此目录浏览必须由 Daemon 提供，在前端以树形懒加载方式呈现。

可复用资产（已落地，本次复用）：
- daemon `list_dir` RPC（`daemon.ts:2100`，已放开 `allowed_roots` 限制专供目录浏览，决策 ql-20260706-006）+ `listDir` 业务层（`file-rpc.ts`：readdir+逐项 stat，`{entries:[{name,type}]}`，dir 优先排序，非递归懒加载，跨平台 node fs）。
- backend `POST /runtimes/{id}/list-dir`（`router.py:1325`）含完整错误映射（offline→504 / timeout→504 / forbidden→403）+ ownership 校验（`_get_owned_runtime`，非 owner→404）。
- frontend `listDir()`（`lib/daemon.ts:244`）。
- 可写目录保存 + 即时刷新全链路：`PUT /runtimes/{id}/allowed-roots`（`router.py:566`）→ WS `policy_update` 推送（`router.py:625`）→ daemon `_handlePolicyUpdate` 即时生效（`daemon.ts:1904`）。

## 2. 设计目标

- **跨平台根锚点**：daemon 新增 `list_roots`，按需返回本机磁盘根（Windows 枚举存在的盘符 / Linux·macOS 返回 `/`），前端不再硬编码探测。
- **前端树形懒加载**：用户在 Web 页面浏览 daemon 主机目录、按需展开（非递归，不一次性扫描全盘）。
- **可复用组件**：封装 `RemoteFolderPicker`，调用方只传 `runtimeId` + `open/onClose/onPick`，零树状态管理。后续 Workspace / Project / 日志浏览直接复用。
- **移除系统弹窗链路**：彻底删除 `browse_folder` 三端代码。
- **即时生效**：目录保存后 Runtime 配置立即刷新（复用现有 WS `policy_update`）。
- 兼容 Windows / Linux / macOS（CLAUDE.md 规则 12）。

## 3. 非目标

- ❌ 不做"新建文件夹"（YAGNI，需求只提选择；D-006）。
- ❌ 不迁移 Workspace / Project / 日志浏览到新组件（本次仅 Runtime 配置页接入 + 组件就绪；后续变更复用）。
- ❌ 不收紧 `list_dir` / `list_roots` 权限（沿用 ownership check，本次非权限重构；D-002）。
- ❌ 不做暗色模式 / 移动端适配（沿用样式系统既有范围）。
- ❌ 不改 `list_dir` 既有契约与 `host_fs.*` 八方法（独立线，ql-20260706-006）。

## 4. 拆分判断

单一变更，不拆分、不批量。理由：这是**一个连贯功能的分层实现**（Daemon API → backend 代理 → 组件 → 页面接入），四层高耦合依赖链不可独立交付；任务数 6-8（<10），无重复模板模式。不满足拆分条件（非 3+ 独立模块 / 非 3+ 角色 / 无跨页面状态流转）。

## 5. 总体方案（分 Wave，plan 细化为 Task）

| Wave | 内容 | 依赖 |
|---|---|---|
| W1 · daemon | 新增 `list_roots` RPC（业务层 `src/roots-rpc.ts` + `daemon.ts` 注册）+ 测试；删除 `browse_folder` handler | — |
| W2 · backend | 新增 `POST /runtimes/{id}/list-roots` 端点 + `ListRootsResponse` schema + 测试；删除 `browse_folder` 端点 + 内联 `BrowseFolder{Request,Response}` | W1（端点转发 RPC） |
| W3 · frontend | 新增 `listRoots()` + `RemoteFolderPicker` 组件 + 测试；改造 `runtimes/page.tsx` 接入并删除内联树形逻辑；删除 `browseFolder()` + `handleBrowseNative` | W2（前端调端点） |

W2/W3 可基于本设计的接口契约并行开发（mock 端点），plan 阶段决定是否错峰。

数据流：
```
RemoteFolderPicker(runtimeId)
  ├─ 打开: listRoots(rid) → POST /list-roots  → daemon list_roots
  │         Win → {roots:["C:\\","D:\\",...]} · Unix → {roots:["/"]}
  ├─ 展开: listDir(rid, path) → POST /list-dir → daemon list_dir  (已有)
  ├─ 手输: 跳转前探 listDir 校验 → not_found 提示
  └─ 确认: onPick(path) → 调用方 PUT /allowed-roots → WS policy_update → 即时生效
```

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/roots-rpc.ts` | `listRoots()` 业务层（Win A-Z existsSync / Unix `/`），对齐 `file-rpc.ts` 风格 |
| 修改 | `sillyhub-daemon/src/daemon.ts` | 在 `_registerListDirRpcHandler` 方法体（`:2095-2158`，该法现注册 list_dir + browse_folder）内新增 `ws.registerRpcHandler('list_roots', ...)`，与目录浏览类 RPC 同聚一处；**删除** `browse_folder` handler（`:2114` 起 PowerShell Shell.BrowseForFolder 整段）。删除后核验 `exec`/`homedir` 等 import 是否仍被他处使用（实测 daemon.ts:39 `platform`/`homedir` 用于 arch/hostname 等，不会变 unused，plan 须复查） |
| 新增 | `sillyhub-daemon/tests/roots-rpc.test.ts` | Win 盘符枚举 / Unix 根 / 异常映射测试 |
| 修改 | `backend/app/modules/daemon/router.py` | 新增 `list_roots` 端点（照抄 `list_dir` 模式 `:1325`）；**删除** `browse_folder` 端点（`:1411` 起）+ 内联 `BrowseFolderResponse`（`:1398`）/ `BrowseFolderRequest`（`:1404`） |
| 修改 | `backend/app/modules/daemon/schema.py` | 新增 `ListRootsResponse { roots: list[str] }`（紧邻 `ListDirResponse:452`） |
| 新增 | `backend/app/modules/daemon/tests/test_list_roots_endpoint.py` | ownership / offline / timeout / forbidden 映射测试；既有 browse-folder 相关测试改为「端点已不存在（404）」断言或移除（照 `app/modules/daemon/tests/` 惯例） |
| 新增 | `frontend/src/components/daemon/remote-folder-picker.tsx` | `RemoteFolderPicker` 组件（自治） |
| 新增 | `frontend/src/components/daemon/__tests__/remote-folder-picker.test.tsx` | 渲染 / 懒加载 / 手输校验 / 错误降级 / onPick 测试 |
| 修改 | `frontend/src/lib/daemon.ts` | 新增 `listRoots()`（紧邻 `listDir:244`）；**删除** `browseFolder()`（`:259`） |
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | 目录选择 modal 换成 `<RemoteFolderPicker>`；**引入 `pickerRowIdx: number\|null` state**（同时承载「是否打开 + 编辑哪行」，替代现有分离的 `browseRuntimeId`(string\|null) + `browseTargetRef`(ref\<number\>)）；删除内联树形逻辑（`handleBrowseDir`/`handleLoadTreeData`/`handleTreeSelect`/`handleSelectBrowseDir`/`handleJumpToPath`/`handleBrowseNative` `:641-726`）与相关 state/ref（`treeData`/`treeSelectedPath`/`browseManualPath`/`browseRuntimeId`/`browseError` `:346-348,351-353` **+ `browseTargetRef` `:349`**） |

## 7. 接口定义

### 7.1 daemon RPC — `list_roots`

```ts
// sillyhub-daemon/src/roots-rpc.ts
export interface ListRootsResult { roots: string[] }

/**
 * 枚举本机磁盘根锚点（目录浏览器根节点，与 list_dir 的 entries 语义分离）。
 * - Windows: 遍历 A:\~Z:\ 用 fs.existsSync 同步探测，收集存在的盘符 → ["C:\\","D:\\"]
 *   本地同步、无子进程、跨所有 Windows 版本（避开已弃用的 wmic）。
 * - Linux/macOS: 返回 ["/"]（展开 / 即看全盘；YAGNI 不解析 /proc/mounts）。
 * 返回的 root 带 OS 原生尾部分隔符（C:\ / /），前端拼 child 判尾部分隔符。
 */
export async function listRoots(): Promise<ListRootsResult>

// daemon.ts 注册：在 _registerListDirRpcHandler 方法体（:2095-2158，该法现注册
// list_dir + browse_folder）内新增一行，浏览自由、不受 allowed_roots 限制（同 list_dir:2100）
ws.registerRpcHandler('list_roots', async () => listRoots());
// params: {}（无参）  返回: { roots: string[] }
```

### 7.2 backend HTTP — `POST /api/daemon/runtimes/{runtime_id}/list-roots`

```python
# router.py（照抄 list_dir:1325 模式）
@router.post("/runtimes/{runtime_id}/list-roots", response_model=ListRootsResponse)
async def list_roots(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> ListRootsResponse:
    svc = DaemonService(session)
    runtime = await svc._get_owned_runtime(runtime_id, user.id)  # ownership, 非 owner→404
    daemon_id = runtime.daemon_instance_id or runtime_id
    result = await hub.send_rpc(daemon_id, "list_roots", {})     # 错误映射复用 list_dir
    return ListRootsResponse(roots=result.get("roots", []))
# 错误映射: DaemonRuntimeOffline→504 / DaemonRpcTimeout→504 / RpcError forbidden→403 / 其它→502
```

```python
# schema.py（紧邻 ListDirResponse:452）
class ListRootsResponse(BaseModel):
    """POST /runtimes/{runtime_id}/list-roots 响应：daemon 主机磁盘根锚点列表。"""
    roots: list[str]
# 无 request schema（空 body，不需要 path）
```

### 7.3 frontend — `listRoots()` + `RemoteFolderPicker`

```ts
// lib/daemon.ts（紧邻 listDir:244）
export interface ListRootsResponse { roots: string[] }
export async function listRoots(runtimeId: string): Promise<ListRootsResponse> {
  return apiFetch<ListRootsResponse>(
    `/api/daemon/runtimes/${runtimeId}/list-roots`, { method: "POST", json: {} },
  );
}
```

```tsx
// components/daemon/remote-folder-picker.tsx
export interface RemoteFolderPickerProps {
  /** 目标 daemon runtime（决定浏览哪台主机）。 */
  runtimeId: string;
  /** 是否打开（受控）。 */
  open: boolean;
  onClose: () => void;
  /** 用户点「选择此目录」时回调，传出选中绝对路径。 */
  onPick: (path: string) => void;
  title?: string;        // default "选择目录"
  confirmText?: string;  // default "选择此目录"
}
/**
 * 自治组件：open 切 true 时 listRoots 初始化根 → antd Tree loadData 懒加载 listDir
 *（只显 type==="dir"）→ 地址栏手输跳转前探 listDir 校验 → 选中 → onPick。
 * 错误降级：daemon 离线/超时/无权限 → 顶部红条提示，不崩溃。
 * 视觉：antd Modal + Tree（业务组件）+ shadcn Input/Button（视觉组件），走现有 token。
 */
export function RemoteFolderPicker(props: RemoteFolderPickerProps): JSX.Element
```

调用方（`runtimes/page.tsx` 可写目录编辑 modal 内）：
```tsx
// 新引入 pickerRowIdx: number|null（替代现有分离的 browseRuntimeId + browseTargetRef）
const [pickerRowIdx, setPickerRowIdx] = useState<number | null>(null);
// 每个可写目录行的「浏览」按钮：onClick={() => setPickerRowIdx(idx)}
<RemoteFolderPicker
  runtimeId={rootsEditing.id}
  open={pickerRowIdx !== null}
  onClose={() => setPickerRowIdx(null)}
  onPick={(p) => {
    setRootsValue(prev => prev.map((v,i) => i === pickerRowIdx ? p : v));
    setPickerRowIdx(null);
  }}
/>
```

## 7.5 生命周期契约表（不适用 · 论证）

**判断**：本变更涉及 daemon 关键词（`list_roots` 经 daemon WS RPC），但 **不触及任何生命周期状态转换**。

`list_roots` 与 `list_dir` 同属**无状态只读查询 RPC**：
- 无 session / lease / agent_run 的创建、状态流转、终结（不触发 claim / complete / end / heartbeat 状态机）。
- 幂等：同一主机任意时刻调用返回相同根集合（盘符/挂载未变即不变）。
- daemon 在线即响应；离线 → backend 映射 504，前端降级提示。无状态需持久化、无回调、无超时收口。
- 「即时生效」指 `allowed_roots` 保存后的 WS `policy_update`，那是**既有** `PUT /allowed-roots` 的既有机制（`router.py:625`），本变更不新增/不改该生命周期事件，仅由调用方复用。

故不生成 claim/create-session/submit/turn-result/session-end 形态的契约表。相关既有事件（`policy_update` 推送）已在 daemon 模块文档登记，本次不动。

## 8. 数据模型

不涉及。无表结构 / 字段变更（`allowed_roots` 已存在于 `daemon_runtimes` 表，PUT 端点已存在）。

## 9. 兼容策略（brownfield）

- 项目未上线，无版本兼容负担（CLAUDE.md 规则 10）。
- `browse_folder` 三端代码彻底删除，不留兼容入口（D-006）。
- 删除是破坏性的：若有外部脚本调 `POST /browse-folder`，将收 404。可接受（内部系统，无外部消费者）。
- 回退路径：若新组件在 verify 阶段暴露严重问题，可临时回退 `runtimes/page.tsx` 接入（git revert W3），daemon/backend 的 `list_roots` 增量可保留（纯新增，不影响既有功能）。`browse_folder` 一旦删除需从 git 恢复。
- 未触及：`list_dir` 既有契约、`host_fs.*` 八方法、`PUT /allowed-roots` 与 WS `policy_update` 链路。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | daemon 主机盘符枚举覆盖面与异常兜底 | P2 | ① 单盘 `existsSync` 各自 try/catch，单盘失败不中断枚举，全失败→返空数组 + 前端空状态文案，地址栏手输仍可用；② **已知限制**：Windows UNC 路径（`\\server\share`）/无盘符网络盘不在 A-Z 枚举范围，用户可通过地址栏手动输入 UNC 路径访问（`list_dir`/`listDir` 支持 UNC，node fs 原生）；③ Unix 容器内 `/` 只读时 `list_dir` 报权限错，走 R-03 降级 |
| R-02 | 全盘放开浏览的信息泄漏担忧 / 读 vs 写权限分层 | P2 | **读（浏览）**：`list_dir`/`list_roots` 沿用 `_get_owned_runtime` ownership（`router.py:1338`），普通 owner 即可浏览**自己 daemon** 主机全盘。**写（保存 allowed_roots）**：`PUT /allowed-roots` 是 `RuntimeAdminUser`（admin 限定，`router.py:574`）。两层权限不同——非 admin 用户可浏览但保存收 403（沿用既有 PUT 行为，本次不改）。详见 D-007 |
| R-03 | daemon 离线时浏览器不可用 | P2 | 错误降级：backend→504，组件顶部红条提示"守护进程离线或响应超时"，地址栏手输 + 跳转校验仍保留（用户可直接输路径，跳转探 listDir 时再报错） |
| R-04 | 手动输入路径校验绕过（用户输不存在路径直接保存） | P2 | `onPick` 前/跳转时探 `listDir` 校验；`not_found`→禁用确认 + 提示（D-003） |
| R-05 | antd Tree `loadData` 在超大目录（万级 entries）卡顿 | P3 | `list_dir` 现状不过滤、无上限（file-rpc.ts 注释）；YAGNI，待性能问题出现再加分页/上限，design 记录 |
| R-06 | Windows 盘符大小写 / 路径分隔符在拼接时错乱 | P2 | daemon 返 OS 原生形态（`C:\` / `/`），前端拼 child 判尾部分隔符（沿用 `page.tsx:675` 既有逻辑）；Windows 盘符大小写不敏感由 daemon `listDir` 既有 `isWin` 归一处理（`file-rpc.ts:83`） |
| R-07 | 删除 `browse_folder` 后，既有测试 / 文档引用残留 | P2 | plan 阶段全量 grep `browse_folder`/`browseFolder`/`BrowseFolder` 三端兜底清理；verify 抽查 |

## 11. 决策追踪

当前版本决策（详见 `decisions.md`）：

| 决策 | 标题 | 覆盖章节 | 状态 |
|---|---|---|---|
| D-001@v1 | roots ≠ allowed_roots 术语分离 | §7.1（roots=磁盘根锚点） | accepted |
| D-002@v1 | list_roots 放开全盘只读，沿用 ownership | §7.2 / §10 R-02 | accepted |
| D-003@v1 | 手动输入须探 list_dir 校验 | §7.3 / §10 R-04 | accepted |
| D-004@v1 | daemon 离线/超时 → UI 降级不崩溃 | §7.3 / §10 R-03 | accepted |
| D-005@v1 | 配置刷新复用 WS policy_update + 心跳兜底 | §1 / §5 数据流 / §9 | accepted |
| D-006@v1 | 不做新建文件夹；不收紧权限；browse_folder 彻底删 | §3 / §6 / §9 | accepted |
| D-007@v1 | 读(owner)/写(admin)权限分层，沿用既有端点不改 | §10 R-02 | accepted |

无未解决决策。

## 12. 自审

| 检查项 | 结果 | 依据 |
|---|---|---|
| 需求覆盖（跨平台根/懒加载树/可复用组件/移除弹窗/即时生效） | ✅ | §2 全覆盖；§5 数据流；§7 接口 |
| Grill / decisions 覆盖（D-001~D-007） | ✅ | §11 逐条引用，全部 accepted；Design Grill（Step 12）交叉审查发现的 2×P0 + 5×P1 + 2×P2 已全部修正（见下「Design Grill 修正记录」） |
| 约束一致性（CONVENTIONS / 双库边界 / 跨平台 / 中文 UI） | ✅ | §7.3 双库边界；规则 12 跨平台；UI 文案中文 |
| 真实性（路径/类名/方法名/行号） | ✅ | 全部来自实读代码：`daemon.ts:2100/2114`、`router.py:566/625/1325/1338/1398/1404/1411`、`schema.py:452`、`file-rpc.ts:83`、`lib/daemon.ts:244/259`、`page.tsx:346-354/641-726/649/675/1219-1279` |
| YAGNI（非目标明确） | ✅ | §3 五条非目标 |
| 验收标准具体可测 | ✅ | 见下方 |
| 非目标清晰 | ✅ | §3 |
| 兼容策略（回退路径） | ✅ | §9 |
| 风险识别 | ✅ | §10 R-01~R-07 |
| 生命周期契约表 | ✅ 不适用，已论证 | §7.5 |

### Design Grill 修正记录（Step 12 交叉审查）

交叉审查（读 design + decisions + scan 文档 + 真实源码核验可行性）发现并已修正：

| ID | 严重度 | 问题 | 修正 |
|---|---|---|---|
| X1 | P0 | §7.3 调用方示例臆造 `pickerRowIdx` state（page.tsx 真实是 `browseRuntimeId`+`browseTargetRef`） | §6/§7.3 明确引入 `pickerRowIdx: number\|null` 替代二者 |
| X2 | P0 | D-002/R-02 把读(owner)/写(admin)权限混为同一模型 | §10 R-02 改述分层；新增 D-007 |
| X3 | P1 | decisions D-005 误引「R-07 兜底」指心跳（R-07 实为测试清理） | D-005 改引 `_syncAllowedRoots`（daemon.ts:1820） |
| X4 | P1 | §6 删除清单漏 `browseTargetRef`（page.tsx:349） | §6 已补 |
| X5 | P1 | list_roots 注册宿主方法未指明 | §6/§7.1 明确加进 `_registerListDirRpcHandler`（:2095-2158） |
| X9 | P1 | 新测试路径 `backend/tests/...` 与现有惯例不符 | 改 `backend/app/modules/daemon/tests/` |
| X10 | P1 | R-01 未述 Windows UNC/网络盘覆盖 | R-01 补已知限制（地址栏手输兜底）+ 单盘 try/catch |
| X6 | P2 | 删 browse_folder 后 import unused 未提示 | §6 daemon.ts 行补「核验 exec/homedir import」 |

无 P0/P1 unresolved blocker。

**验收标准**（verify 对照）：
1. daemon `list_roots` 在 Windows 返回存在的盘符（如 `["C:\\","D:\\"]`）、Linux/macOS 返回 `["/"]`；离线/异常 fallback 不崩（R-01）。
2. backend `POST /list-roots`：owner 返 200 + roots；非 owner 返 404；daemon 离线返 504（照抄 list_dir 测试模式）。
3. `POST /browse-folder` 返 404（已删除）；`browseFolder()` / `browse_folder` handler 不再存在于代码（grep 三端为空，R-07）。
4. `RemoteFolderPicker`：打开加载根 → 展开懒加载子目录 → 手输不存在路径提示并禁用确认 → onPick 回传正确路径（组件测试）。
5. `runtimes/page.tsx` 可写目录「浏览」按钮打开 `RemoteFolderPicker`，选中后填入输入框；保存后 PUT allowed-roots 成功 + daemon policy_update 即时生效（D-005）。
6. 跨平台：Windows daemon 显示盘符根、Linux daemon 显示 `/` 根，均可正常展开（D-001）。
7. 三端 `tsc` / `pytest` / daemon 测试通过 + Docker rebuild 实测 Runtime 配置页（R-05 verify 实测）。
