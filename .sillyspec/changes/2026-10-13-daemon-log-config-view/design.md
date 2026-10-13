---
author: qinyi
created_at: 2026-10-13 16:39:07
generated_by: sillyspec-design-init
scale: "large"
---

# 设计文档（Design）— daemon 日志与配置的平台查看

## 背景

daemon（本地守护进程）出问题时，排查只能在用户本机敲 CLI（`sillyhub-daemon logs --tail N` 看日志、手工打开 `~/.sillyhub/daemon/config-*.json` 看配置），且日志文件路径随 `SILLYHUB_DAEMON_DIR` 环境变量可重定向，用户常常找不到文件。平台侧目前只有机器在线状态、版本号、心跳时间等心跳快照（`backend/app/modules/daemon/router/machines.py:41 list_machines`），没有任何查看 daemon 自身日志与生效配置的入口。本次变更在 Web 平台（`/runtimes` 机器卡）新增 daemon 日志与配置的只读查看能力，让用户不登机器就能完成常见排查。

已有可复用先例：agent 日志链路（backend 经 WS RPC 读 daemon 机器上的日志文件尾部，`backend/app/modules/platform_sync/router.py:764-831`），以及 daemon 侧 WS RPC handler 注册模式（`sillyhub-daemon/src/daemon.ts:6987-7003`）。

## 设计目标

1. 在 `/runtimes` 机器卡上提供「日志」「配置」入口，打开诊断弹窗即可查看对应机器的 daemon 状态信息。
2. 日志：查看 `daemon.log` 尾部 N 行（默认 500，可选 100/500/2000，daemon 侧 RPC 上限 5000 行且尾部字节上限 256KB，两者先到先截），带文件路径/大小/最后修改时间元信息，手动刷新。
3. 配置：查看当前生效配置（内存中的 `DaemonConfig`），敏感字段（明文枚举清单：`token`、`api_key`）默认掩码，可切换明文（按需重新拉取，默认路径不传明文）。
4. 日志片段与配置均支持下载为文件；**配置下载恒脱敏**（无论页面处于掩码态还是明文态，下载内容永远为脱敏 JSON，D-007）。
5. 全链路只读——平台不提供 daemon 配置的在线编辑（allowed_roots 编辑走既有路径）。

## 非目标

- 不做日志实时滚动流（WebSocket `tail -f`），保持一次性拉取+手动刷新（D-002）。
- 不做配置在线编辑/写回。
- 不做日志轮转/清理策略变更（daemon 侧 `cleanup` 已覆盖日志文件清理）。
- 不改造心跳协议携带日志/配置（D-006 已否决）。
- 不做多日志文件浏览器（任务级 `runs/<leaseId>/terminal.log` 不在本次范围）。

## 拆分判断

单变更，不分批。三端改动围绕同一条数据通路（daemon RPC → backend 转发 → 前端弹窗），拆分会导致接口无消费者或消费者无接口的中间态，不适合拆。

## 总体方案

### Phase 1 — daemon 侧：诊断 RPC（新文件 + 注册）

新建 `sillyhub-daemon/src/diag-rpc.ts`（零第三方依赖，纯函数 + 两个 handler 工厂，便于单测）：

- `readLogTail(filePath, tailLines)`：`fs.open` 拿句柄 + `stat` 拿 size/mtime；从文件末尾按 64KB 块向前读，扫描换行符收集尾部 `tailLines` 行；**同时设尾部字节上限 262144B（256KB，与 `backend/app/modules/platform_sync/router.py` 先例同值）——行上限与字节上限先到先截**；块边界拼接时修剪不完整的 UTF-8 字节序列（避免尾部首行出现 � 乱码）。返回 `{ path, size, mtime, exists, lines, line_count, truncated }`（`truncated=true` 表示因字节上限截断、返回行数少于请求）。文件不存在返回 `exists:false` 而非抛错（不落盘场景：前台 TTY 运行不写 daemon.log，见 `sillyhub-daemon/src/cli.ts:171-183` 触发条件 `!process.stdout.isTTY`），且 `size:0 / mtime:"" / lines:[] / line_count:0 / truncated:false` 全部兜底，保证 response_model 校验通过。
- `getMaskedConfig(config, { reveal })`：对**明文枚举的敏感字段清单 `SENSITIVE_CONFIG_FIELDS = ['token', 'api_key']`**（`sillyhub-daemon/src/config.ts:256-444` DaemonConfig 实测凭据类字段仅此两项；清单为 diag-rpc.ts 内常量，新增凭据字段时须同步维护）做掩码。掩码公式（D-001@v2）：`len < 16 → 整值掩为 '***'`；`len ≥ 16 → 前4位 + '***' + 后4位`；值缺失/空串原样。`reveal:true` 返回明文。返回 `{ config, masked_fields }`。

在 `sillyhub-daemon/src/daemon.ts` 就近 `_registerHostFsRpcHandler`（:6985）新增 `_registerDiagRpcHandler(ws)`，注册两个 handler：

- `daemon_log_tail`：参数 `{ tail_lines?: number }`，clamp 到 1..5000（默认 500）。日志路径用 `join(DEFAULT_CONFIG_DIR, 'daemon.log')`（`sillyhub-daemon/src/config.ts:147`，与 `cli.ts:142 getLogFile()` 语义一致；不 import cli.ts——cli.ts 顶层 `void main()` 无入口守卫，import 会触发 CLI 执行）。非整数/越界参数用默认值兜底。
- `daemon_config_get`：参数 `{ reveal?: boolean }`。读**当前生效配置** `this._config`（含 CLI flag 覆盖）而非重新 `loadConfig` 磁盘文件；配置文件路径用 `configPathForServer(this._config.server_url)`（`sillyhub-daemon/src/config.ts:207-212`）返回，供前端展示。默认 `reveal:false` 返回掩码值。

### Phase 2 — backend 侧：两个转发端点

在 `backend/app/modules/daemon/router/machines.py` 新增（与 `trigger_machine_cleanup` 同风格：machine 级、`RuntimeAdminUser` 鉴权、`svc._get_owned_instance` 归属校验）：

- `GET /api/daemon/machines/{instance_id}/logs?tail=500` → `hub.send_rpc(instance_id, "daemon_log_tail", {"tail_lines": tail}, timeout=30)` → `DaemonLogTailResponse`。
- `GET /api/daemon/machines/{instance_id}/config?reveal=false` → `hub.send_rpc(instance_id, "daemon_config_get", {"reveal": reveal}, timeout=30)` → `DaemonConfigResponse`。

错误映射（复制 `backend/app/modules/platform_sync/router.py:764-831 _send_agent_log_rpc` 语义）：`DaemonRuntimeOffline` / `DaemonRpcTimeout` → **原样透传既有 504 AppError（不包裹、不改写错误 code——与 platform_sync 先例「原样透传」注释口径一致；测试断言锁定既有 code）**；`DaemonRpcRemoteError.code == "method_not_found"` → 422 `HTTP_422_DAEMON_DIAG_UNSUPPORTED`（老 daemon 未升级）；其余远端错 → 502 `DaemonRpcRemoteGatewayError`。

新增两个响应 DTO 到 `backend/app/modules/daemon/schema.py`，并同步 `backend/app/modules/daemon/router/__init__.py` 的 `_ENDPOINT_ORDER` 表（:147，漏同步启动即 RuntimeError）。

### Phase 3 — frontend 侧：入口 + 诊断弹窗

- `frontend/src/lib/daemon/machines.ts`：新增 `fetchMachineLogTail(instanceId, tail)` 与 `fetchMachineConfig(instanceId, reveal)`；沿用该文件既有 `apiFetch` 风格——错误统一走 `frontend/src/lib/api.ts` 的 `ApiError`（持 status/code），弹窗按 `status===422 || code==='HTTP_422_DAEMON_DIAG_UNSUPPORTED'` 判定显示升级提示（不新增自定义错误类）。
- `frontend/src/components/daemon/daemon-diagnostic-dialog.tsx`（新增）：antd Modal 大号弹窗双 Tab（日志/配置）。日志 Tab：行数 Select + 刷新 + 下载片段 + 元信息行（路径/大小/最后修改）+ 等宽字体滚动区（打开自动滚到底部）。配置 Tab：只读标注 + JSON 展示（掩码字段高亮）+「显示明文/隐藏明文」切换（切换触发 reveal 重新拉取）+ 下载按钮（**恒脱敏 JSON**，与页面态无关——下载恒以 reveal=false 口径取数：掩码态复用当前数据，明文态重新以 reveal=false 拉取，不复用明文 state）。边界态：422→「daemon 版本过旧请先升级」warning 条；`exists:false`→「前台运行不落盘日志」warning 条；`truncated`→提示「日志过长，仅展示末尾 256KB 内 N 行」；离线→错误条；401/403/404（非 owner/无权限——机器级端点归属校验同语义 404）→ 弹窗内通用错误条（展示 ApiError 中文信息，复用 apiFetch 错误文案）。下载用既有 Blob 模式（先例 `frontend/src/lib/explorer.ts:105-109`）。
- `frontend/src/components/daemon/machine-card.tsx`：操作区新增「日志」「配置」按钮，`offline/disabled` 状态禁用 + tooltip；新增 `onOpenDiagnostic(instance, tab)` 回调 prop。
- `frontend/src/app/(dashboard)/runtimes/page.tsx`：顶层 state `diagTarget: { instance, tab } | null` 管理弹窗（对齐 `aliasEditing` / `rootsEditing` 既有模式 :1084、:1510），machine-card 传回调，弹窗条件渲染。
- 跑 `pnpm gen:types` 更新 `frontend/src/lib/api-types.ts` + `backend/openapi.json`。

### Phase 4 — 文档同步

更新三端相关模块文档；运行 `python scripts/scan-drift-check.py` 核对。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:sillyhub-daemon/src/diag-rpc.ts | 诊断 RPC 纯逻辑：readLogTail 分块尾部读 + getMaskedConfig 脱敏；零依赖便于单测 |
| 修改 | sillyhub-daemon/src/daemon.ts | 新增 _registerDiagRpcHandler 注册 daemon_log_tail / daemon_config_get（就近 :6985 区域） |
| 新增 | NEW:sillyhub-daemon/tests/diag-rpc.test.ts | vitest：尾部读取正确性/大小文件/UTF-8 边界/文件不存在/脱敏与 reveal/参数 clamp |
| 修改 | backend/app/modules/daemon/schema.py | 新增 DaemonLogTailResponse / DaemonConfigResponse DTO（含 truncated 字段）——数据流：daemon result dict → send_rpc 返回 dict → 端点 response_model 校验序列化（snake_case 原样）→ openapi.json → pnpm gen:types → frontend/src/lib/api-types.ts → daemon-diagnostic-dialog.tsx 消费 |
| 修改 | backend/app/modules/daemon/router/machines.py | 新增 GET {instance_id}/logs 与 /config，RPC 转发 + 504/422/502 映射 |
| 修改 | backend/app/modules/daemon/router/__init__.py | _ENDPOINT_ORDER 追加两个端点条目（漏同步启动即报错） |
| 新增 | NEW:backend/tests/modules/daemon/test_daemon_machine_diag.py | pytest：转发成功、offline 504、timeout 504、method_not_found 422、remote error 502 |
| 修改 | backend/openapi.json | gen 产物（新增两端点） |
| 修改 | frontend/src/lib/daemon/machines.ts | 新增 fetchMachineLogTail / fetchMachineConfig；422 升级提示标识 |
| 新增 | NEW:frontend/src/components/daemon/daemon-diagnostic-dialog.tsx | 诊断弹窗：双 Tab、行数/刷新/下载、掩码切换、边界态 |
| 修改 | frontend/src/components/daemon/machine-card.tsx | 操作区「日志」「配置」按钮 + onOpenDiagnostic 回调 prop（producer=runtimes/page.tsx state → consumer=按钮点击） |
| 修改 | frontend/src/app/(dashboard)/runtimes/page.tsx | diagTarget state + 弹窗条件渲染（对齐 aliasEditing 模式） |
| 新增 | NEW:frontend/src/components/daemon/__tests__/daemon-diagnostic-dialog.test.tsx | vitest 组件测试：双 Tab 渲染、掩码切换、422/不存在/离线提示、下载触发 |
| 修改 | frontend/src/lib/api-types.ts | pnpm gen:types 产物 |

注：`sillyhub-daemon/src/cli.ts` 不需要修改（本变更不 import 它、不改其行为——日志路径改用 config.ts:147 的 DEFAULT_CONFIG_DIR 常量自行拼接，理由见 Phase 1）；`backend/app/main.py` 不需要修改（daemon router 已挂在 `/api`，新增端点落在既有 router 内，无需改挂载）。

## 接口定义

### daemon RPC（WS，daemon 侧新注册）

```ts
// daemon_log_tail
// params: { tail_lines?: number }   // clamp 1..5000，默认 500
// 行上限 5000 与尾部字节上限 262144B（256KB）先到先截
// result:
{
  path: string;        // 日志文件绝对路径
  size: number;        // 字节；文件不存在时 0
  mtime: string;       // ISO 8601；文件不存在时 ""
  exists: boolean;     // false = 文件不存在（前台运行不落盘）
  lines: string[];     // 尾部行（不含换行符），文件不存在时 []
  line_count: number;  // 实际返回行数；文件不存在时 0
  truncated: boolean;  // true = 因字节上限截断，行数少于请求
}

// daemon_config_get
// params: { reveal?: boolean }      // 默认 false
// result:
{
  path: string;              // config-<sha256(server_url)[0:8]>.json 绝对路径
  config: Record<string, unknown>;  // 生效配置（reveal=false 时敏感字段为掩码）
  masked_fields: string[];   // 本次被掩码的字段名；reveal=true 时 []
}
```

daemon 侧错误：正常路径全部结构化返回（`exists:false` / 掩码），不抛 RpcError；仅内部异常（读盘失败等）走既有 `toRpcError` → `internal`。

### backend REST

```
GET /api/daemon/machines/{instance_id}/logs?tail=500   → 200 DaemonLogTailResponse
GET /api/daemon/machines/{instance_id}/config?reveal=false → 200 DaemonConfigResponse
```

```py
class DaemonLogTailResponse(BaseModel):
    path: str
    size: int
    mtime: str
    exists: bool
    lines: list[str]
    line_count: int
    truncated: bool

class DaemonConfigResponse(BaseModel):
    path: str
    config: dict[str, Any]
    masked_fields: list[str]
```

| 场景 | HTTP | code |
|---|---|---|
| 成功 | 200 | — |
| 机器离线 / RPC 超时 | 504 | 原样透传既有 AppError（不改写 code，不包裹） |
| 老 daemon 未注册方法（method_not_found） | 422 | HTTP_422_DAEMON_DIAG_UNSUPPORTED |
| 其余远端错 | 502 | 既有网关语义 DaemonRpcRemoteGatewayError |

## 生命周期契约表

不涉及生命周期契约——本变更为只读诊断查询（`daemon_log_tail` / `daemon_config_get` 不改变任何 session/lease/agent_run 状态，不引入新的事件类型；claim/heartbeat/complete 等既有生命周期路径零改动）。

## 数据模型

无表结构 / 字段变更（纯读路径，不落库）。

## 兼容策略（brownfield 必填）

- **老 daemon（未升级）**：两个新 RPC 未注册 → `method_not_found` → 422 → 前端提示「daemon 版本过旧请先升级」。平台其余功能（心跳/升级/清理）完全不受影响。
- **新 daemon + 老 backend**：新 RPC 是 daemon 侧注册的被动端点，调用方是本次新增的 backend 端点——老 backend 不会调用它，未知调用零影响；即便未来被手动触发也仅得到错误响应，无副作用。
- **未配置新功能时行为不变**：无新配置项、无新开关；不改任何现有 API / 表结构 / 心跳协议 / WS 消息类型。
- **回退路径**：前端弹窗为纯新增入口，出现问题时隐藏入口即可，无存量路径依赖。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 老 daemon 用户点击入口报错，体验差 | P1 | 422 → warning 提示条明确指路「升级 daemon」按钮；不弹技术错误 | 
| R-02 | daemon.log 无轮转可能很大，读取/RPC 超时/超大 payload | P1 | daemon 侧分块尾部读（不全量加载）+ 5000 行上限 + 尾部字节上限 262144B（256KB，先例同值，落实 D-002 故障面要求）；backend RPC 超时放宽到 30s；`truncated` 时前端提示截断；504 时前端提示重试 |
| R-03 | 敏感凭据经平台链路泄露（截图/缓存/下载） | P0 | 默认掩码、reveal 按需二次拉取（默认路径不传明文）、下载恒脱敏（D-007，明文态下载同样脱敏）；掩码字段清单明文枚举（token/api_key）+ 掩码公式收紧（len<16 全掩，D-001@v2）防泄露边界 |
| R-04 | 尾部块边界切坏 UTF-8 多字节字符产生乱码 | P2 | 块拼接时修剪不完整字节序列（读取实现固定策略 + 单测覆盖中文内容） |
| R-05 | 日志正被写入时读到半行 | P2 | tail 语义天然接受（下次刷新即完整）；不在 UI 特殊处理 |
| R-06 | 无长驻进程/外部资源，生命周期面不适用 | — | 两个 RPC 为一次性请求-响应，无新句柄常驻、无后台任务（显式留痕） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v2（supersedes v1） | 掩码展示（公式收紧 len<16 全掩 + 清单明文枚举）：Phase 1 `getMaskedConfig` + Phase 3 配置 Tab + FR-03/04 | 已覆盖 |
| D-002@v1 | 拉取式：Phase 1 `readLogTail`（含字节上限落实）+ Phase 3 日志 Tab + FR-01/02 | 已覆盖 |
| D-003@v1 | 查看+下载：Phase 3 下载/只读标注 + FR-05（下载口径细化见 D-007） | 已覆盖 |
| D-004@v1 | 方案 B：Phase 1/2/3 全部实现路径 | 已覆盖 |
| D-005@v1 | （rejected 防复潮：方案 A 否决） | 不适用 |
| D-006@v1 | （rejected 防复潮：方案 C 否决） | 不适用 |
| D-007@v1 | 下载恒脱敏：Phase 3 下载按钮（明暗态一致）+ FR-05 + R-03 | 已覆盖 |

多裁定组合推演：本变更的裁定（D-001@v2 掩码 × D-002 拉取 × D-003 只读 × D-007 下载恒脱敏）逐对推演——D-001@v2 只影响配置返回内容、D-002 只影响日志获取方式（含字节上限）、D-003 只影响 UI 动作集、D-007 只影响下载产物口径；两两组合（明暗态 × 查看/下载 × 日志/配置）无死锁格，无状态升降/回退语义的组合面，显式记「无组合约束」。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@vN（D-001@v2、D-002~D-006@v1、D-007@v1，见决策追踪）
- [x] 生命周期关键词（daemon）出现，已写紧邻豁免短语「不涉及生命周期契约」（只读查询，无状态变化）
- [x] UI 原型分级核对：涉前端文件，原型已生成于 `.sillyspec/changes/2026-10-13-daemon-log-config-view/prototype-daemon-log-config-view.html`（机器卡入口 + 双 Tab 弹窗 + 脱敏切换 + 五种边界态演示：正常/日志不存在/truncated/老版本/离线）
- [x] 不确定的问题标注：Design Grill 首轮提出的 BL-01（下载口径）已由用户裁定（D-007 恒脱敏）、BL-02/BL-03 已修复（字节上限 + 掩码公式/清单），无遗留 ⚠️ 存疑项

自审补充检查：
1. 数据流闭环：daemon RPC result → backend `send_rpc` dict → Pydantic response_model 序列化（snake_case 原样，前端 `apiFetch` 不做 camel 转换——与本项目 api-types 惯例一致）→ 弹窗消费；`masked_fields` 与 `truncated` 字段全程透传。已闭环。
2. 日志路径求值：diag-rpc.ts 使用 `config.ts:147` 的 `DEFAULT_CONFIG_DIR` 模块常量（import 时求值一次）拼 `daemon.log`——与写入方 `cli.ts:142 getLogFile()` 恒同源，进程内功能等价；daemon 进程生命周期内 `SILLYHUB_DAEMON_DIR` 不会变更，无调用时重求值需求（config.ts:53 懒求值注释讲的是 `daemonStateDir()` 函数本身，非本场景依据）。
3. 下载内容口径：日志下载=当前拉取的尾部行（非全量文件，含 truncated 提示）；配置下载=**恒脱敏 JSON**（明暗态一致，D-007）——修正初稿「明文态下载明文」的错误表述。
4. `_ENDPOINT_ORDER` 与 openapi.json 两处必须同期更新，否则 CI/启动报错（已列入清单）。
