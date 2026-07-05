---
author: WhaleFall
created_at: 2026-06-29T10:20:20
change: 2026-06-29-runtime-allowed-roots-config
---

# Design: runtimes 页面查看并配置 daemon 可访问目录（allowed_roots 沙箱）

## 1. 背景

daemon 守护进程跑在宿主机，对文件访问有沙箱限制（`allowed_roots`）。现状：
- `allowed_roots` 存在 daemon **本地 `config.json`**（`sillyhub-daemon/src/config.ts:181`），默认 `[homedir()]`。
- `assertWithinAllowedRoots`（`file-rpc.ts:66`）校验 **list_dir RPC**（前端浏览目录，`daemon.ts:1710`），path 不在 allowed_roots 内 → 拒绝（用户实测 "daemon refused list_dir: path outside allowed_roots"）。
- **CC 执行**：daemon spawn CC（`claude --permission-mode bypassPermissions`，`stream-json.ts:297`），CC 写文件走 OS 权限，daemon 不拦（读取/写入都不受限）。

用户需求：在 `/runtimes` 页面查看并配置每个 daemon runtime 的可访问目录，且 CC 写入受限（白名单内）、读取自由。

## 2. 目标 / 非目标

### 目标
- backend 持久化 per-runtime `allowed_roots`（多路径，默认 `~/.sillyhub`），admin 可经 API 配置。
- daemon 心跳拉取 allowed_roots 同步本地，list_dir 用它（现状延续）。
- **CC 写入受限**：daemon 启动 CC 时按 allowed_roots 注入 CC permission rules（写白名单内 allow、白名单外 deny），**读取不受限**。
- frontend `/runtimes` 页面 per-runtime allowed_roots 查看 + 多路径编辑。

### 非目标
- 不改 list_dir 校验语义（assertWithinAllowedRoots 逻辑不变，只改数据来源：本地 config → backend 同步）。
- 不做 WS 实时推送（心跳拉取，~15s 生效即可）。
- 不限制 CC 读取（读自由是明确需求）。
- 不做 fs 监控/事后回滚（方案 C 已否决）。

## 3. 方案

### 3.1 共用基座
- **数据模型**：`daemon_runtimes` 加 `allowed_roots` 列（JSONB 数组），默认 `["~/.sillyhub"]`。
- **同步**：daemon `POST /daemon/heartbeat` 响应带 `allowed_roots` → daemon 写本地 config（合并 homedir 兜底）。
- **list_dir**：`file-rpc.ts` 继续读 config.allowed_roots（不变）。
- **API**：`GET /api/admin/daemon/runtimes`（含 allowed_roots）+ `PUT /api/admin/daemon/runtimes/{id}/allowed-roots`（admin 权限）。
- **frontend**：`/runtimes` 页面 per-runtime allowed_roots 编辑（多路径增删）。

### 3.2 CC 写入拦截（方案 A：CC permission 注入）
daemon 启动 CC 时，按 allowed_roots 生成 CC permission rules：
- `allow Write(//<allowed_root>/**)`（每个白名单路径一条）
- `deny Write(**)`（白名单外全拒）
- 读不配 deny（Read 自由）

注入点（已存在的 CC permission 通道）：
- **batch**（`stream-json.ts` buildArgs）：当前 `--permission-mode tc.mode||'bypassPermissions'`（:297）。改为按 allowed_roots 生成 rules + `permission-mode` 改 `acceptEdits`（写白名单内自动、外 deny），通过 `--settings` 或 lease `tool_config` 注入。
- **interactive**（`claude-sdk-driver.ts`）：`options.allowedTools`（:331）+ permission options 注入。

> ⚠️ **自审存疑（execute 需验证）**：claude-code permission 路径模式语法（`Write(//abs/path/**)`）+ 注入方式（CLI `--settings`/`--perms` vs SDK options vs 临时 settings.json）。execute step 0 先跑 `claude --help` + 小样验证 `Write(path/**)` deny 是否生效，再定注入实现。

## 4. 数据模型

### backend（新增列）
`backend/app/modules/daemon/model.py` `DaemonRuntime` 加：
```python
allowed_roots: list[str] = Field(default_factory=lambda: ["~/.sillyhub"], sa_column=Column(JSONB, nullable=False, server_default='["~/.sillyhub"]'))
```
- migration：`add daemon_runtimes.allowed_roots`（JSONB，默认 `["~/.sillyhub"]`，存量行回填）。
- `~/.sillyhub` 是占位，daemon 侧解析为 `homedir()/.sillyhub`（或 daemon workspace_dir）。

### daemon（本地 config 同步）
- `config.ts` `allowed_roots` 字段保留（本地缓存 + homedir 兜底）。
- 心跳响应收到 backend allowed_roots → 覆盖 config.allowed_roots（合并 homedir 保证非空）。

## 5. API

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/admin/daemon/runtimes` | GET | 列表（含 allowed_roots），admin 权限 |
| `/api/admin/daemon/runtimes/{id}/allowed-roots` | PUT | 更新 allowed_roots（JSON 数组），admin 权限，校验路径合法性 |
| `/daemon/heartbeat`（daemon→backend） | POST | 响应 body 加 `allowed_roots` 字段（daemon 拉取） |

PUT 校验：每条路径绝对路径（或 `~` 开头展开）、去重、长度上限（如 50 条）。

## 6. daemon 同步 + CC 拦截

### 6.1 同步
- 心跳响应（`POST /daemon/heartbeat`）解析 `allowed_roots` → 写 `config.allowed_roots`（合并 homedir）。
- list_dir（`file-rpc.ts:66`）继续用 config.allowed_roots。

### 6.2 CC 写入拦截
- daemon 启动 CC 前，按 `config.allowed_roots` 生成 CC permission rules（allow Write 白名单 + deny Write(**) + 读自由）。
- batch（`stream-json.ts`）：注入 rules + permission-mode 非 bypass。
- interactive（`claude-sdk-driver.ts`）：注入 permission options。
- CC 原生拦截：写白名单内自动、外 deny（CC 报权限拒绝，daemon 透传日志）。

## 7. frontend UI

`/runtimes` 页面（`frontend/src/app/(dashboard)/runtimes/page.tsx`）：
- runtime 列表每行/详情加 allowed_roots 展示（Tag 列表）。
- 编辑入口（Drawer/Modal）：多路径增删（Input + 添加/删除按钮），默认显示 `~/.sillyhub`。
- 保存调 `PUT /api/admin/daemon/runtimes/{id}/allowed-roots`。
- 仅 admin 可编辑（权限判断）。

## 8. 默认值 + 安全

- 新 runtime 注册（`POST /daemon/runtimes`）默认 `allowed_roots=["~/.sillyhub"]`。
- admin 配置项目路径（如 `F:/WorkNew/SillyHub`）让 list_dir + CC 写入放行。
- **读自由**：Read 工具不配 deny，CC 可读任意目录。
- **写白名单**：Write/Edit/MultiEdit 限制 allowed_roots 内。
- 安全：allowed_roots 由 admin 配置（鉴权），daemon 视为可信；PUT 校验路径合法性。

## 9. 验收标准

1. `/runtimes` 页面显示每个 runtime 的 allowed_roots，admin 可编辑（多路径增删），保存持久化。
2. daemon 心跳后（~15s）本地 config 同步 backend allowed_roots。
3. list_dir 浏览 allowed_roots 内路径放行，外拒绝（现状延续）。
4. **CC 写入**：CC 写 allowed_roots 内成功，写外被 CC permission 拒绝（日志可见）。
5. **CC 读取**：CC 读 allowed_roots 外路径成功（读自由）。
6. 新 runtime 默认 `["~/.sillyhub"]`。
7. daemon-client/裸机兼容（allowed_roots 未配置时原样）。

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| CC permission 路径模式语法不确定 | execute step 0 验证 `claude --help` + 小样 Write deny 生效，再定注入 |
| CC permission-mode 从 bypass 改 acceptEdits 影响 CC 行为（写白名单内是否还要审批） | 验证 acceptEdits + allow rules 是否自动接受白名单内写 |
| daemon 心跳拉取延迟（~15s）配置生效 | 可接受（用户选心跳拉取）；UI 提示"下次心跳生效" |
| allowed_roots 路径跨平台（Windows F:/ vs Linux /home） | daemon 侧路径规范化（沿用 assertWithinAllowedRootS 的 pathResolve） |
| 存量 runtime 无 allowed_roots 列 | migration 回填默认 `["~/.sillyhub"]` |

## 11. ⚠️ 自审存疑（execute 确认）

- CC permission 路径模式语法（`Write(//path/**)`）+ 注入方式（CLI/SDK/settings.json）。
- acceptEdits + allow rules 是否让白名单内写自动（不弹审批）。
- daemon 心跳端点（`/daemon/heartbeat`）响应体扩展是否影响现有 daemon 兼容（旧 daemon 不读 allowed_roots 字段，向后兼容）。
