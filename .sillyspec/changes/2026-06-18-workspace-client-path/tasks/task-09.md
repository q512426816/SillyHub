---
author: qinyi
created_at: 2026-06-18 11:44:49
change: 2026-06-18-workspace-client-path
id: task-09
title: "spec bundle 拉取 / sync 回传（daemon task-runner）"
priority: P0
depends_on: [task-06]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-006@v1]
allowed_paths:
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/hub-client.ts
---

# task-09 — spec bundle 拉取 / sync 回传（daemon task-runner）

> Wave 3 / 集成层 / depends: task-06（后端 bundle/sync 端点）。本任务是 D-006@v1「spec 按需 bundle pull / sync push」的 daemon 端落地：把 task-runner 的执行链路从「直接吃 execution-context.spec_root」改造为「daemon-client workspace 按需 pull → 解包到本地 → 执行 → 整树 push 回服务器」，server-local 路径零行为变化。

## 1. 修改文件

| 操作 | 精确路径 | 改动概述 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/hub-client.ts` | `HubClient` 新增 `getSpecBundle(wsId): Promise<Buffer>`（GET `/api/workspaces/{wsId}/spec-workspace/bundle`，responseType=arraybuffer → Buffer）+ `postSpecSync(wsId, tarBuf): Promise<{ ok: boolean; reparsed: number }>`（POST `/api/workspaces/{wsId}/spec-workspace/sync`，Content-Type `application/x-tar`，body=Buffer）；两者绕过既有 `_request`（JSON 专用），单独走原生 fetch，复用 `_headers()` 的鉴权头与 `DEFAULT_TIMEOUT_MS` 超时 |
| 修改 | `sillyhub-daemon/src/task-runner.ts` | `runLease` 在 prepareWorkspace 之后、step 2（写 CLAUDE.md）之前插入「daemon-client spec pull」子步骤：若 `ctx.workspaceId` 非空且 `ctx.specRoot` 为空（execution-context 对 daemon-client 透传空 spec_root）→ 调 `getSpecBundle` → 解包到 `~/.sillyhub/daemon/specs/{wsId}` → 把该绝对路径覆盖为本次 agent 执行的 spec_root（注入到 spawn env / args 的 cwd=workDir 不变，但 spec_root 通过环境变量或 agent CLI flag 注入到 agent 的 spec 解析路径）；runLease 收尾（agent 子进程 exit 之后、collectDiff 之前/之后均可，见 §4.5）→ 把该 spec_root 目录整树打包 tar → 调 `postSpecSync` 回传服务器；新增依赖契约字段 `RunnerHubClient.getSpecBundle?` / `postSpecSync?`（可选方法，server-local client 缺省不触发） |

> `allowed_paths` 严格限定上述两个源文件。若打包/解包需要新工具函数（如 tar-stream 包装），尽量收敛到 `task-runner.ts` 内部模块级私有函数（零新增依赖优先；见 §4.4 tar 实现取舍）。`types.ts` 的 `LeaseCtx` / `ExecutionContextPayload` 字段（`workspace_id` / `spec_root`）的**新增**属 task-07（execution-context spec_root 自决 + workspace_id 透传），本任务只**消费**这些字段——若 task-07 尚未合并，本任务在执行阶段先用本地 interface 扩展（鸭子类型），不修改 `types.ts`。

## 2. 覆盖来源

| 来源 ID | 类型 | 摘要 | 本任务如何落实 |
|---|---|---|---|
| **FR-05** | 功能需求 | daemon task-runner 启动 → `GET bundle` 拉 tar 解到 `~/.sillyhub/daemon/specs/{ws_id}` → 以此为 agent spec_root；agent 执行完成 → `POST sync`（整树 tar）→ backend 覆盖 spec_root + reparse scan_docs → 返回 `{ok, reparsed}`；spec 列表/内容读服务器（真理源在服务器，daemon 不长期持有副本） | §4.3 runLease 插入点 + §4.5 收尾打包回传；解包路径写死 `~/.sillyhub/daemon/specs/{wsId}`（路径由 daemon 决定，backend 不传具体路径，对齐 design §5 Phase4） |
| **D-006@v1** | 决策 | spec 按需下发方案 A（bundle pull / sync push）：agent run 时 daemon GET bundle 拉 spec 到临时区，执行后 POST sync 整树回传；复用现有 lease，不引入同步引擎；回传统一覆盖服务器 spec_root + reparse | §4.1 / §4.2 两个 hub-client 方法 + §4.3 / §4.5 两个 runLease 插入点；零长期副本（pull 后用、push 后保留以供下次 pull 覆盖，符合「不维护同步引擎」语义，见 §6 非目标） |
| **design §5 Phase4** | 设计 | daemon 自行解到本地 `~/.sillyhub/daemon/specs/{ws_id}`（路径由 daemon 决定，backend 不传具体路径）；execution-context 已透传 workspace_id，daemon 用它调 bundle/sync；daemon-client 时 execution-context 的 spec_root 字段留空 | §4.3 判定条件 `ctx.workspaceId && !ctx.specRoot`；spec 目录用 `path.join(homedir(), '.sillyhub', 'daemon', 'specs', wsId)`，与 backend 解耦 |
| **design §7.2** | 接口 | `GET /api/workspaces/{ws_id}/spec-workspace/bundle` → `200 application/x-tar`（排除 `.runtime`）；`POST /api/workspaces/{ws_id}/spec-workspace/sync` body=`application/x-tar` → `200 { ok: true, reparsed: int }` | §4.1 / §4.2 方法签名 1:1 对齐 |

> task-06（后端 bundle/sync 端点）是**前置依赖**，本任务在 daemon 端写死对 task-06 端点的 HTTP 调用契约。task-06 文件尚未生成时，本任务以 design §7.2 为唯一接口真理源；若 task-06 实现与 §7.2 偏差，需在 execute 阶段两端对齐。

## 3. 实现要求（编号步骤）

> 按 CLAUDE.md「文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收」执行。

1. **读现有代码**：
   - `sillyhub-daemon/src/hub-client.ts:199-218`（`_request` 私有方法，JSON 专用，本任务 tar 请求需绕过）。
   - `sillyhub-daemon/src/hub-client.ts:438-443`（`getExecutionContext` 是唯一的 GET 示例，复用其路径拼接 + 超时模式）。
   - `sillyhub-daemon/src/task-runner.ts:273-475`（`runLease` 9 步编排链，本任务在 step 1 之后插入 pull、step 8 之后插入 push）。
   - `sillyhub-daemon/src/task-runner.ts:104-123`（`RunnerHubClient` 鸭子类型契约，新增两个可选方法）。
   - `sillyhub-daemon/src/workspace.ts:130-179`（`prepareWorkspace` 的 rootPath 分支，理解 cwd 来源；spec_root 与 workDir 是两个独立路径）。
   - `sillyhub-daemon/src/types.ts:205-314`（`LeaseCtx` / `ExecutionContextPayload` 字段；确认 task-07 会新增 `workspaceId` / `specRoot` 字段，本任务消费时用鸭子类型扩展）。

2. **写测试（先于实现，TDD）**：见 §8。三组测试：hub-client 的 `getSpecBundle` / `postSpecSync`、task-runner 的 pull 插入点、task-runner 的 push 收尾。

3. **改 hub-client.ts（实现 getSpecBundle + postSpecSync）**：见 §4.1 / §4.2。两个方法独立于 `_request`，单独走原生 fetch，复用 `_headers()` 鉴权但**覆盖** Content-Type（bundle 是 `application/x-tar`，sync 也是 `application/x-tar`；GET bundle 不发 body 故 Content-Type 无意义但 Accept 头设 `application/x-tar`）。

4. **改 task-runner.ts（实现 pull + push）**：
   - §4.3：`runLease` 内 step 1（prepareWorkspace）之后插入 `_pullSpecBundle(ctx)`，返回 spec_root 绝对路径或 null（server-local / 非 daemon-client 返回 null）。
   - §4.5：`runLease` 内 step 8（collectDiff）之后、step 9（_finish）之前插入 `_pushSpecSync(specRoot)`；**失败不阻塞** agent 结果（对齐 FR-05 + design §3「整树覆盖即可」+ R-03 风险）。
   - `RunnerHubClient` 接口加两个**可选**方法（`getSpecBundle?` / `postSpecSync?`），server-local 测试 mock 缺省不实现 → runLease 自动跳过（见 §5 边界 E-04）。

5. **跑测试**：见 §8 第 4 步。

6. **（不要做）**：
   - 不修改 `types.ts`（`LeaseCtx.workspaceId` / `specRoot` 字段归 task-07）。
   - 不实现 tar-stream 完整库（见 §4.4，零/轻依赖优先）。
   - 不修改 backend spec_workspace router/service（task-06）。
   - 不做 spec diff / 冲突合并（design §3 非目标）。
   - 不在 pull 失败时把 agent run 标 failed（FR-05 不要求 spec 必须下发成功才执行；bundle 404 时 agent 仍按 workDir 自身的 .sillyspec 执行，见 §5 边界 E-01）。

## 4. 接口定义

### 4.1 `HubClient.getSpecBundle(wsId)`

```ts
// sillyhub-daemon/src/hub-client.ts —— HubClient 类内，紧邻 getExecutionContext 之后

/**
 * 拉取 workspace 的 spec bundle（tar 流）。
 *
 * 端点：GET /api/workspaces/{wsId}/spec-workspace/bundle（task-06）。
 * 响应：200 application/x-tar（服务器 spec_root 整树打包，排除 .runtime）。
 *
 * **路径前缀**：用 `/api`（spec_workspace router 挂载点），不用 REST_PREFIX
 * （那是 /api/daemon，daemon module 专用）。与 getExecutionContext 同样的前缀约束。
 *
 * **二进制响应**：不走 _request（JSON 专用），单独 fetch + arrayBuffer() → Buffer。
 * 鉴权头复用 _headers() 的 Bearer/X-API-Key，但 Content-Type 不设（GET 无 body），
 * Accept 设 application/x-tar 让 backend 明确期望。
 *
 * **失败语义**（对齐 _request）：
 *   - HTTP 非 2xx → 抛 HubHttpError（含 status/bodyText/url/method）。
 *   - 404 表示 spec_workspace 不存在或 spec_root 尚未 bootstrap（FR-05 首次执行）。
 *   - 网络/超时 → 透传 fetch 原始错误（不包装）。
 *
 * @returns tar 二进制 Buffer（调用方负责解包到本地路径）
 */
async getSpecBundle(wsId: string): Promise<Buffer> {
  const url = `${this.baseUrl}/api/workspaces/${encodeURIComponent(wsId)}/spec-workspace/bundle`;
  const headers: Record<string, string> = { Accept: 'application/x-tar' };
  if (this.apiKey) {
    headers['X-API-Key'] = this.apiKey;
  } else if (this.token) {
    headers['Authorization'] = `Bearer ${this.token}`;
  }
  const resp = await fetch(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const bodyText = await resp.text();
    throw new HubHttpError(resp.status, bodyText, url, 'GET');
  }
  const ab = await resp.arrayBuffer();
  return Buffer.from(ab);
}
```

### 4.2 `HubClient.postSpecSync(wsId, tarBuf)`

```ts
/**
 * 回传 daemon 执行后的 spec 整树（tar 流）到服务器。
 *
 * 端点：POST /api/workspaces/{wsId}/spec-workspace/sync（task-06）。
 * 请求：Content-Type: application/x-tar，body=tar Buffer（daemon 本地 spec_root 整树）。
 * 响应：200 { ok: true, reparsed: number }（reparsed = reparse 后 scan_docs 条数）。
 *
 * **路径前缀**：同 getSpecBundle，用 /api。
 *
 * **二进制请求**：不走 _request（它会 JSON.stringify body），单独 fetch，body 直接传 Buffer
 * （Node fetch 原生支持 Buffer/Uint8Array 作为 body，自动处理 content-length）。
 * Content-Type 显式设 application/x-tar（覆盖 _headers 的默认 application/json）。
 *
 * **失败语义**（对齐 _request）：
 *   - HTTP 非 2xx → 抛 HubHttpError。
 *   - 413 Payload Too Large → spec 树过大（R-02 风险），调用方应 log + 不中断 agent 结果。
 *   - 网络/超时 → 透传。
 *
 * @param wsId workspace id（与 getSpecBundle 同一个 id）
 * @param tarBuf tar 二进制（由 _packSpecDir 生成，见 §4.4）
 * @returns backend 响应 { ok, reparsed }
 */
async postSpecSync(
  wsId: string,
  tarBuf: Buffer,
): Promise<{ ok: boolean; reparsed: number }> {
  const url = `${this.baseUrl}/api/workspaces/${encodeURIComponent(wsId)}/spec-workspace/sync`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-tar',
  };
  if (this.apiKey) {
    headers['X-API-Key'] = this.apiKey;
  } else if (this.token) {
    headers['Authorization'] = `Bearer ${this.token}`;
  }
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: tarBuf,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const bodyText = await resp.text();
    throw new HubHttpError(resp.status, bodyText, url, 'POST');
  }
  return (await resp.json()) as { ok: boolean; reparsed: number };
}
```

### 4.3 RunnerHubClient 契约扩展 + runLease pull 插入点

```ts
// sillyhub-daemon/src/task-runner.ts —— RunnerHubClient 接口扩展（§104-123）
export interface RunnerHubClient {
  // ...现有方法不变...
  startLease(...): Promise<unknown>;
  submitMessages(...): Promise<unknown>;
  leaseHeartbeat?(...): Promise<unknown>;
  syncStatus?(...): Promise<unknown>;

  /**
   * task-09：拉取 workspace spec bundle（tar）。
   * 可选方法 —— server-local / 旧 mock client 未实现时，runLease 自动跳过 spec pull。
   * 实际实现见 HubClient.getSpecBundle。
   */
  getSpecBundle?(wsId: string): Promise<Buffer>;
  /**
   * task-09：回传 spec 整树（tar）。
   * 可选方法 —— 同上，未实现时跳过 sync push。
   */
  postSpecSync?(
    wsId: string,
    tarBuf: Buffer,
  ): Promise<{ ok: boolean; reparsed: number }>;
}
```

```ts
// sillyhub-daemon/src/task-runner.ts —— runLease 内，step 1（prepareWorkspace）之后
// 步骤 1.5：daemon-client spec bundle 拉取（task-09 / D-006@v1）
// 仅当 execution-context 透传了 workspace_id 且 spec_root 为空（daemon-client 留空）时触发。
// spec_root 非空（server-local 由 backend 直接传 backend 机器路径）→ 跳过，沿用现状。
let specRoot: string | null = null;
try {
  specRoot = await this._pullSpecBundle(ctx);
} catch (e) {
  // pull 失败不致命（bundle 404 / 网络错）：agent 仍按 workDir 自身的 .sillyspec 执行。
  // 对齐 FR-05「按需」语义 + §5 边界 E-01。
  console.warn('task_runner: spec_bundle_pull_failed', ctx.leaseId, e);
}
```

```ts
/**
 * 拉取 workspace spec bundle 并解包到本地（task-09 / D-006@v1）。
 *
 * 触发条件：ctx.workspaceId 非空 && ctx.specRoot 为空（execution-context 对 daemon-client 透传空）。
 * server-local（无 workspaceId 或 specRoot 已有值）→ 直接返回 null，runLease 不插入 spec 逻辑。
 *
 * 解包路径：~/.sillyhub/daemon/specs/{wsId}（路径由 daemon 决定，backend 不传）。
 * 已存在则整目录覆盖（rm -rf + 解包，避免残留旧文件污染；见 §5 边界 E-03）。
 *
 * 解包后路径作为 agent 执行的 spec_root（注入到 spawn env 或 agent CLI flag）。
 * 注入方式：通过环境变量 SILLYHUB_SPEC_ROOT（agent 侧 task-07 之外的消费点需自行读取）。
 *
 * @returns spec_root 绝对路径（解包成功）；null（非 daemon-client / pull 跳过）
 * @throws HubHttpError（bundle 404 / 5xx）/ 网络/超时错误 / 解包 IO 错误（调用方 catch）
 */
private async _pullSpecBundle(ctx: LeaseCtx): Promise<string | null> {
  // 鸭子类型：task-07 未合并前 workspaceId/specRoot 可能不在 LeaseCtx 类型上，
  // 用 as any 兜底访问；task-07 合并后改为正式字段。
  const wsId = (ctx as { workspaceId?: string }).workspaceId;
  const existingSpecRoot = (ctx as { specRoot?: string }).specRoot;
  if (!wsId) return null;                  // server-local / 非 daemon-client
  if (existingSpecRoot) return null;       // execution-context 已带 spec_root（不应发生在 daemon-client，但防御）
  if (typeof this.client.getSpecBundle !== 'function') return null; // mock client 未实现

  const tarBuf = await this.client.getSpecBundle(wsId);
  const specDir = this._resolveSpecDir(wsId); // ~/.sillyhub/daemon/specs/{wsId}
  await this._extractTar(tarBuf, specDir);     // 见 §4.4，路径穿越防护
  return specDir;
}

/**
 * 计算 workspace spec 本地解包目录：~/.sillyhub/daemon/specs/{wsId}。
 * wsId 含路径分隔符时拒绝（防御性，正常是 UUID）。
 */
private _resolveSpecDir(wsId: string): string {
  if (!wsId || /[\\/]/.test(wsId)) {
    throw new Error(`invalid workspace_id for spec dir: ${JSON.stringify(wsId)}`);
  }
  return join(homedir(), '.sillyhub', 'daemon', 'specs', wsId);
}
```

### 4.4 tar 打包/解包实现（零/轻依赖取舍）

> design §6 注「复用 Node tar（可用 tar-stream 或 node:zlib+手工；保持零/轻依赖，与 hub-client 风格一致）」。

**取舍 A（推荐，零依赖）**：手工实现 ustar tar 读写。
- tar 格式简单（512B header + data padded to 512 + 结尾 2×512B zero block）。
- 写：遍历目录 → 每个 regular file 一个 header + data；目录本身可选（解包时按 file path 自动 mkdir）。
- 读：循环读 512B header → 解析 name/size/typeflag → 读 size 字节 data → 跳过 padding。
- gzip 不强制（design §7.2 端点是 `application/x-tar` 裸 tar，非 `.tar.gz`；如需压缩后续再叠 `node:zlib`）。
- **路径穿越防护**（§5 边界 E-06）：解包时拒绝 name 含 `..` 段或绝对路径（`/` 开头 / `[A-Z]:` 开头）的 entry。

**取舍 B（备选，轻依赖）**：引入 `tar-stream`（约 50KB，纯 JS，无 native）。
- 优点：API 成熟、边界用例（symlink/longname/pax）已处理。
- 缺点：违反 daemon 当前「零 HTTP/压缩库」基线（hub-client 全用原生 fetch），引入新依赖需项目决策。
- 本任务**默认采用 A**；若 execute 阶段发现手工 tar 在 Windows 路径/symlink 上坑太多，再评估切 B 并在 task 报告中说明。

**伪代码（取舍 A，解包）**：

```ts
/**
 * 解包 tar Buffer 到目标目录（task-09 / D-006@v1）。
 *
 * 路径穿越防护（§5 E-06）：
 *   - entry.name 含 '..' 段 → 抛错（拒绝解包）。
 *   - entry.name 绝对路径（/ 开头 或 win 盘符）→ 抛错。
 *   - 最终 join 后 path.relative(targetDir, fullPath) 必须不以 '..' 开头。
 *
 * 已存在目录：调用方负责先 rm -rf（见 _pullSpecBundle，覆盖语义）。
 *
 * 仅支持 regular file（typeflag '0' 或 '\0'）+ directory（'5'）。
 * symlink / hardlink / char/block device 等 → 跳过 + warn（daemon spec 树不应含）。
 */
private async _extractTar(tarBuf: Buffer, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  let offset = 0;
  while (offset + 512 <= tarBuf.length) {
    const header = tarBuf.subarray(offset, offset + 512);
    // 结尾 zero block（全 0）→ 结束
    if (header.every((b) => b === 0)) break;

    const name = _readTarString(header.subarray(0, 100));
    const sizeOctal = _readTarString(header.subarray(124, 136)).trim();
    const size = sizeOctal ? parseInt(sizeOctal, 8) : 0;
    const typeflag = String.fromCharCode(header[156]);

    offset += 512;
    const data = tarBuf.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;

    if (!name) continue;

    // 路径穿越防护
    if (name.includes('..') || name.startsWith('/') || /^[A-Za-z]:[\\/]/.test(name)) {
      throw new Error(`tar path traversal blocked: ${name}`);
    }
    const fullPath = join(targetDir, name);
    const rel = path.relative(targetDir, fullPath);
    if (rel.startsWith('..')) {
      throw new Error(`tar path escapes target dir: ${name} -> ${fullPath}`);
    }

    if (typeflag === '5' || name.endsWith('/')) {
      await mkdir(fullPath, { recursive: true });
      continue;
    }
    if (typeflag === '0' || typeflag === '\0') {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, data);
      continue;
    }
    // symlink / 其他 → 跳过 + warn
    console.warn('task_runner: tar_skip_entry', { name, typeflag });
  }
}
```

**伪代码（打包，runLease 收尾用）**：

```ts
/**
 * 把目录整树打包成 tar Buffer（task-09 / D-006@v1）。
 * 排除 .runtime（与 backend GET bundle 端点约定一致，design §7.2）。
 * 仅 regular file + directory；symlink 跳过 + warn。
 */
private async _packSpecDir(specDir: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const entries = await _walkDir(specDir); // 递归收集 { absPath, relPath, isDir }
  for (const e of entries) {
    if (e.relPath.split(/[\\/]/).includes('.runtime')) continue; // 排除 .runtime
    const header = _buildTarHeader(e.relPath, e.isDir ? 0 : (await stat(e.absPath)).size, e.isDir);
    chunks.push(header);
    if (!e.isDir) {
      const data = await readFile(e.absPath);
      chunks.push(data);
      const padLen = (512 - (data.length % 512)) % 512;
      if (padLen > 0) chunks.push(Buffer.alloc(padLen));
    }
  }
  chunks.push(Buffer.alloc(1024)); // 2×512 zero block 结尾
  return Buffer.concat(chunks);
}
```

> header 字段（name/mode/uid/gid/size/mtime/checksum/typeflag/linkname/magic/version/...）需严格按 ustar 规范填充，checksum 字段在填充其余字段后按 unsigned sum 计算。execute 阶段实现时以 `node:fs` + Buffer 位运算为主，不引入第三方。

### 4.5 runLease push 收尾插入点

```ts
// sillyhub-daemon/src/task-runner.ts —— runLease 内，step 8（collectDiff）之后、step 9（_finish）之前
// 步骤 8.5：daemon-client spec 整树回传（task-09 / D-006@v1）
// 仅当 specRoot 非空（即 step 1.5 触发了 pull）时触发。
// 失败不阻塞 agent 结果（对齐 FR-05 + §5 E-02）：sync 失败仅 warn，不影响 TaskResult.success/status。
if (specRoot) {
  try {
    const tarBuf = await this._packSpecDir(specRoot);
    if (typeof this.client.postSpecSync === 'function') {
      const wsId = (ctx as { workspaceId?: string }).workspaceId!;
      const resp = await this.client.postSpecSync(wsId, tarBuf);
      console.info('task_runner: spec_sync_ok', ctx.leaseId, resp);
    }
  } catch (e) {
    console.warn('task_runner: spec_sync_failed', ctx.leaseId, e);
  }
}
```

> **插入位置取舍**：push 放在 collectDiff 之后而非之前，理由：(1) spec_root 与 workDir 是两个独立目录，diff 只读 workDir 的 `.git`，顺序无依赖；(2) 放后面让 agent 结果（output/diff）已就绪，即便 sync 卡住也不影响 _finish 的字段填充。push 不进入 try/catch 顶层（避免把 sync 失败误映射为 task failed）。

## 5. 边界处理（≥5 条）

| 编号 | 边界场景 | 期望行为 | 实现位置 |
|---|---|---|---|
| **E-01** | **bundle 404 / pull 失败** | spec bundle 端点返回 404（spec_workspace 未 bootstrap / spec_root 空）或网络错 → `_pullSpecBundle` 抛 `HubHttpError` → runLease catch → 仅 warn，`specRoot=null` → agent 按 workDir 自身的 `.sillyspec`（若有）执行，**不**标 task failed。对齐 FR-05「按需」语义（pull 是尽力而为，不是前置硬性条件）。 | §4.3 runLease try/catch + `_pullSpecBundle` |
| **E-02** | **sync 失败不阻塞 agent 结果** | `postSpecSync` 抛 `HubHttpError`（413/5xx）或网络错 → runLease 内独立 try/catch → 仅 warn → `_finish` 仍按 agent 实际 exitCode/status 汇总 TaskResult。**绝不**因 sync 失败把 `success=true` 的 agent run 改写为 failed。 | §4.5 push 收尾独立 try/catch |
| **E-03** | **spec_root 目录已存在（重复执行 / 残留）** | 同一 wsId 二次 pull → `_pullSpecBundle` 先 `rm -rf specDir`（`fs.rm recursive force`）再解包，保证整目录覆盖语义（避免上次残留文件污染本次）。rm 失败（Windows EBUSY）→ 复用 workspace.ts 的 `rmtreeWindowsSafe` 策略或直接 mkdir recursive 后解包（容忍残留，agent 侧覆盖读取）。 | §4.3 `_pullSpecBundle` + `_resolveSpecDir` |
| **E-04** | **server-local workspace（无 workspace_id）不触发** | execution-context 对 server-local workspace 透传 `spec_root`（backend 机器路径，task-07 处理）且**不**带 `workspace_id`（或带但 spec_root 非空）→ `_pullSpecBundle` 判定 `!wsId \|\| existingSpecRoot` → 返回 null → runLease 完全跳过 pull/push，行为与现状字节级一致。**这是兼容性的关键不变式**（design §9）。 | §4.3 `_pullSpecBundle` 早返回 |
| **E-05** | **tar 解包路径穿越防护（Zip Slip 类）** | 恶意/损坏 tar 含 `../../etc/passwd` 或绝对路径 entry → `_extractTar` 在 join 前后双重校验：(1) name 含 `..` 段或绝对路径前缀 → 抛错；(2) join 后 `path.relative(targetDir, fullPath)` 不以 `..` 开头。任一校验失败 → 抛错 → runLease catch → warn + specRoot=null（不阻断 agent）。 | §4.4 `_extractTar` |
| **E-06** | **mock client 未实现 getSpecBundle/postSpecSync** | 旧测试 mock / server-local 集成测试的 client 不实现这两个可选方法 → `typeof this.client.getSpecBundle !== 'function'` → `_pullSpecBundle` 早返回 null；push 段同理跳过。保证 server-local 现有测试零回归。 | §4.3 / §4.5 守卫 |
| **E-07** | **workspace_id 含路径分隔符（注入）** | 异常 lease 透传 `workspaceId='../../x'` → `_resolveSpecDir` 正则 `/[\\/]/` 拒绝 → 抛错 → runLease catch → warn + 跳过 pull。正常 wsId 是 UUID，正则不应命中。 | §4.3 `_resolveSpecDir` |
| **E-08** | **spec 树过大（R-02）** | spec_root 含大量 docs → tar Buffer 撑爆内存 / POST 413。本任务**不**做流式（YAGNI，design §3 砍掉同步引擎；项目未上线数据可清空）。临时应对：单次 tar 上限（如 50MB，常量）→ 超 → warn + 跳过 sync。流式优化留后续增强。 | `_packSpecDir` 体积检查（可选） |
| **E-09** | **agent 在执行中修改了 spec_root 之外的目录** | spec_root 是 daemon 独立目录（`~/.sillyhub/daemon/specs/{wsId}`），与 workDir（agent cwd）解耦。agent 默认 cwd=workDir，spec_root 仅通过环境变量 `SILLYHUB_SPEC_ROOT` 暴露。push 只打包 spec_root，不打包 workDir 改动（workDir 改动由 collectDiff 的 git patch 回传，已是现状）。**两者互不污染**。 | §4.5 `_packSpecDir(specDir)` 仅打 specDir |

## 6. 非目标（本任务不做）

- ❌ 不修改 `sillyhub-daemon/src/types.ts`（`LeaseCtx.workspaceId` / `specRoot` 字段归 task-07；本任务用鸭子类型访问）。
- ❌ 不实现 backend 端 bundle/sync 端点（task-06）。
- ❌ 不引入同步引擎 / spec diff / 冲突合并（design §3 / D-006 明确「不引入同步引擎」）。
- ❌ 不做 spec 长期副本维护（D-006：按需 pull/push，pull 后用、push 后保留以供下次 pull 覆盖；不主动 GC，下次 pull 的 rm -rf 即覆盖）。
- ❌ 不做 tar 流式传输（YAGNI；E-08 体积检查够用，项目未上线）。
- ❌ 不修改 agent adapter / buildArgs（spec_root 注入通过环境变量，不改 adapter 协议；adapter 侧消费 `SILLYHUB_SPEC_ROOT` 若需要属后续 task）。
- ❌ 不修改 workspace.ts 的 prepareWorkspace（workDir 与 specDir 是两条独立路径）。
- ❌ 不在 sync 失败时重试（hub-client 风格：不内置重试，调用方决策；本任务 catch 后仅 warn）。
- ❌ 不做 spec_root 的 GC / TTL 清理（YAGNI；项目未上线数据可清空）。

## 7. 参考

- design.md §5 Phase 4（agent run 路由 + spec 按需下发）、§6（task-runner.ts / hub-client.ts 行）、§7.2（bundle/sync 端点）、§9（兼容策略 server-local 零变化）、§10 R-02/R-03（spec 体积/并发风险）
- requirements.md FR-05（spec 按需下发与回传，三段 GWT）
- decisions.md D-006@v1（方案 A：bundle pull / sync push，不引入同步引擎）
- plan.md Wave 3 task-09 行 + 依赖图（depends task-06）
- 现有代码：
  - `sillyhub-daemon/src/hub-client.ts:199-218`（`_request` JSON 入口，本任务 tar 请求绕过）
  - `sillyhub-daemon/src/hub-client.ts:438-443`（`getExecutionContext` GET 路径前缀范例）
  - `sillyhub-daemon/src/task-runner.ts:273-475`（runLease 9 步编排链，插入点 step 1.5 / 8.5）
  - `sillyhub-daemon/src/task-runner.ts:104-123`（RunnerHubClient 鸭子类型契约）
  - `sillyhub-daemon/src/workspace.ts:130-179`（prepareWorkspace rootPath 分支，workDir 来源）
  - `sillyhub-daemon/src/types.ts:205-314`（LeaseCtx / ExecutionContextPayload 字段）

## 8. TDD 步骤

1. **写 `hub-client.spec` 测试（getSpecBundle / postSpecSync）**（先写，预期失败）：
   - `test_getSpecBundle_returns_tar_buffer`：mock fetch 返回 `application/x-tar` + 二进制 → `getSpecBundle('ws-1')` 返回 Buffer，URL 含 `/api/workspaces/ws-1/spec-workspace/bundle`，header 含 `Accept: application/x-tar` + 鉴权。
   - `test_getSpecBundle_404_throws_hub_http_error`：mock 返回 404 → 抛 `HubHttpError`（status=404）。
   - `test_getSpecBundle_no_auth_when_token_absent`：无 token / apiKey → 请求不带 Authorization / X-API-Key。
   - `test_postSpecSync_posts_tar_body`：mock fetch → 断言 `body` 是传入的 Buffer、`Content-Type: application/x-tar`、URL 含 `/sync`、返回 `{ok:true, reparsed:3}`。
   - `test_postSpecSync_413_throws`：413 → HubHttpError。
   - `test_postSpecSync_uses_api_key_when_set`：apiKey 设置时 header 含 `X-API-Key`。

2. **写 task-runner pull 插入点测试**：
   - `test_pull_skipped_when_no_workspace_id`：ctx 无 workspaceId → `_pullSpecBundle` 返回 null，`client.getSpecBundle` 未被调用。
   - `test_pull_skipped_when_spec_root_present`：ctx.specRoot 非空 → 返回 null（server-local 兼容）。
   - `test_pull_skipped_when_client_missing_method`：mock client 不实现 getSpecBundle → 返回 null。
   - `test_pull_invokes_get_spec_bundle_and_extracts`：ctx.workspaceId='ws-1' && !specRoot && client.getSpecBundle 是函数 → 调 getSpecBundle → tar 解包到 `~/.sillyhub/daemon/specs/ws-1` → 返回该路径。
   - `test_pull_failure_does_not_fail_lease`：getSpecBundle 抛 → runLease 仍正常完成（agent spawn + _finish success），仅 warn 日志。
   - `test_pull_overwrites_existing_spec_dir`：specDir 已存在旧文件 → pull 后旧文件清空、新文件就位（rm -rf + 解包）。
   - `test_extract_tar_blocks_path_traversal`：tar 含 `../evil` entry → `_extractTar` 抛错 → runLease catch warn + specRoot=null。
   - `test_resolve_spec_dir_rejects_path_separator_in_ws_id`：`_resolveSpecDir('a/b')` 抛错。

3. **写 task-runner push 收尾测试**：
   - `test_push_invoked_after_collect_diff_when_spec_root_set`：pull 成功 → runLease 收尾调 `_packSpecDir` + `client.postSpecSync`，URL 含 wsId。
   - `test_push_skipped_when_spec_root_null`：server-local（specRoot=null）→ postSpecSync 未调用。
   - `test_push_skipped_when_client_missing_method`：mock client 不实现 postSpecSync → 跳过。
   - `test_push_failure_does_not_fail_lease`：postSpecSync 抛 → runLease 仍按 agent 实际结果 _finish（success 不被改写）。
   - `test_pack_spec_dir_excludes_runtime`：specDir 含 `.runtime/` 子目录 → tar 内不含 `.runtime/` 路径。
   - `test_pack_spec_dir_round_trip_with_extract`：pack → extract 到新目录 → 文件树与源一致（含子目录、空文件、二进制）。

4. **实现**：按 §3 步骤 3-4 改 hub-client.ts / task-runner.ts。

5. **跑测试**：
   - `cd sillyhub-daemon && pnpm test src/hub-client.spec.ts src/task-runner.spec.ts`（或项目既定测试命令 / vitest）—— 全绿。
   - `cd sillyhub-daemon && pnpm test` —— 现有 daemon 测试不回归（关键：server-local lease 流程零变化，mock client 未实现 getSpecBundle/postSpecSync 时跳过）。
   - `cd sillyhub-daemon && pnpm tsc --noEmit`（或 `pnpm build`）—— TS 严格模式 0 error。
   - `cd sillyhub-daemon && pnpm lint`（若项目有 ESLint/Biome）—— 无新增 lint 错。

6. **集成验收（手动，依赖 task-06 后端端点 + task-07 workspace_id 透传就绪后）**：
   - 启动 backend + daemon，创建 daemon-client workspace，触发 agent run。
   - 观察 daemon 日志：`spec_bundle_pull_failed` 不出现（或出现但 agent 仍 success）→ `spec_sync_ok` 出现且 `{ok:true, reparsed:N}` N>0。
   - backend spec_workspace.spec_root 目录内容被 daemon 回传的 tar 覆盖（对比修改前后文件树）。
   - scan_docs reparse 生效（reparsed 计数匹配 docs 数）。

## 9. 验收标准

| AC | 验收点 | 来源 | 验证方式 | 通过条件 |
|---|---|---|---|---|
| AC-01 | `HubClient.getSpecBundle` 签名与行为正确 | design §7.2 / FR-05 | `test_getSpecBundle_returns_tar_buffer` | GET `/api/workspaces/{wsId}/spec-workspace/bundle`，Accept=`application/x-tar`，返回 Buffer，鉴权头就位 |
| AC-02 | `HubClient.postSpecSync` 签名与行为正确 | design §7.2 / FR-05 | `test_postSpecSync_posts_tar_body` | POST `/api/workspaces/{wsId}/spec-workspace/sync`，Content-Type=`application/x-tar`，body=Buffer，返回 `{ok, reparsed}` |
| AC-03 | bundle 404 → HubHttpError 不崩 | §5 E-01 | `test_getSpecBundle_404_throws_hub_http_error` | 抛 HubHttpError(status=404)，调用方可 catch |
| AC-04 | runLease 在 daemon-client 触发 pull | FR-05 第一段 / D-006 | `test_pull_invokes_get_spec_bundle_and_extracts` | ctx.workspaceId 非空 && !specRoot → 调 getSpecBundle → 解包到 `~/.sillyhub/daemon/specs/{wsId}` |
| AC-05 | pull 失败不阻塞 agent 结果 | §5 E-01 | `test_pull_failure_does_not_fail_lease` | getSpecBundle 抛 → runLease 仍 _finish success（agent exitCode=0 时） |
| AC-06 | server-local 不触发 pull | design §9 / §5 E-04 | `test_pull_skipped_when_no_workspace_id` + `test_pull_skipped_when_spec_root_present` | ctx 无 workspaceId 或 specRoot 非空 → 返回 null，getSpecBundle 未调 |
| AC-07 | mock client 未实现可选方法时跳过 | §5 E-06 | `test_pull_skipped_when_client_missing_method` + push 同理 | typeof check 守卫生效，不抛错 |
| AC-08 | spec_root 已存在时覆盖（rm -rf + 解包） | §5 E-03 | `test_pull_overwrites_existing_spec_dir` | 旧文件清空、新文件就位 |
| AC-09 | tar 解包路径穿越防护 | §5 E-05 | `test_extract_tar_blocks_path_traversal` | `../` / 绝对路径 entry 抛错 |
| AC-10 | workspace_id 注入防护 | §5 E-07 | `test_resolve_spec_dir_rejects_path_separator_in_ws_id` | wsId 含 `/`/`\`/`\0` → 抛错 |
| AC-11 | runLease 收尾触发 push（specRoot 非空时） | FR-05 第二段 / D-006 | `test_push_invoked_after_collect_diff_when_spec_root_set` | collectDiff 之后调 postSpecSync，URL 含 wsId |
| AC-12 | sync 失败不阻塞 agent 结果 | §5 E-02 | `test_push_failure_does_not_fail_lease` | postSpecSync 抛 → runLease 仍按 agent 实际结果 _finish |
| AC-13 | pack 排除 .runtime | design §7.2 | `test_pack_spec_dir_excludes_runtime` | tar 内无 `.runtime/` 路径 |
| AC-14 | pack/extract round-trip 一致 | §4.4 | `test_pack_spec_dir_round_trip_with_extract` | pack → extract 文件树与源一致 |
| AC-15 | RunnerHubClient 契约扩展为可选方法 | §4.3 | TS 编译 + 现有 mock client 测试 | 可选 `?` 标注，server-local 测试零回归 |
| AC-16 | server-local 全链路零回归 | design §9 | `cd sillyhub-daemon && pnpm test` 全绿 | 现有 daemon 测试 100% 通过（关键不变式） |
| AC-17 | TS 严格模式编译通过 | 项目规约 | `pnpm tsc --noEmit` | 0 error |
| AC-18 | FR-05 三段 GWT 全覆盖 | requirements.md FR-05 | 人工对照 | bundle pull（AC-04）+ sync push（AC-11）+ 服务器真理源（AC-13 .runtime 排除证明 daemon 不污染 backend runtime 元数据；前端读服务器属前端 task，非本任务） |
| AC-19 | D-006@v1 方案 A 落地 | decisions.md D-006 | 人工对照 | bundle pull（AC-01/04）+ sync push（AC-02/11）+ 无同步引擎（§6 非目标 + 无新增 cron/长连接同步）+ 整树覆盖（AC-08/14） |
| AC-20 | 不引入非 allowed_paths 源文件改动 | 本任务边界 | `git diff --name-only` | 仅 `sillyhub-daemon/src/task-runner.ts` + `sillyhub-daemon/src/hub-client.ts`（测试文件除外，按项目测试规范） |

## 10. 完成定义（DoD）

- §1 全部文件改动落地（hub-client.ts 加 2 方法 + task-runner.ts 加 pull/push 子步骤 + RunnerHubClient 契约扩展）。
- §9 AC-01 ~ AC-20 全部通过。
- `cd sillyhub-daemon && pnpm test` 全绿，**server-local lease 流程零回归**（design §9 关键不变式）。
- `cd sillyhub-daemon && pnpm tsc --noEmit` 0 error。
- git diff 仅触及 `allowed_paths` 内文件（types.ts 不动；task-07 合并后若需把鸭子类型改正式字段，属 task-07 范畴或后续小修）。
- 集成验收（§8 第 6 步）在 task-06 + task-07 就绪后手动跑通一次，记录 daemon 日志的 `spec_sync_ok` + backend spec_root 覆盖证据。
- 本任务报告回执包含：新增测试用例数、tar 实现取舍（A 手工 / B tar-stream）的实际选择、跑通的测试命令输出尾部、集成验收日志摘录。
