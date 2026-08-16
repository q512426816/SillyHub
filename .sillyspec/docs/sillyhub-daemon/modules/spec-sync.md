---
schema_version: 1
doc_type: module-card
module_id: spec-sync
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:50
---
# spec-sync

## 定位
spec bundle 双向同步 utility（`src/spec-sync.ts`，task-04 / D-007@v1）。纯模块级函数 + client 作参数注入（不读 TaskRunner 实例状态），使 interactive 路径（无 TaskRunner 实例）可直接调用。覆盖 design §5.0/§5.2/§7.2/§10 R-02；零依赖手工 ustar tar 打包/解包。

## 契约摘要
- `resolveSpecDir(wsId): string` ——本地 spec 目录 `~/.sillyhub/daemon/specs/{wsId}`，纯函数无 IO。
- `PullSpecBundleOptions`（existingSpecRoot）。
- `pullSpecBundle(client, wsId, opts): Promise<string | null>` ——拉 bundle 解包，返回 specDir 路径或 null（跳过）。
- `postSpecSync(client, wsId, specRoot): Promise<{ok, reparsed} | null>` ——打包整树 POST 回传。
- `packSpecDir(specDir, opts?): Promise<Buffer>` ——本地 spec 整树打 tar。默认排除运行时产物 `runtime/`（无点，daemon scan-runs 日志）+ `worktrees`（任意深度）；`.runtime/`（**有点**，含 sillyspec.db）保留（D-003 push 契约）。opts 可选 `{excludeRuntime?, excludeNames?}`（import 路径加排整个 `.runtime`）。name > 100 字节时写 GNU LongLink 扩展头（`buildLongLinkHeader`，typeflag 'L'）。

## 关键逻辑
```
pullSpecBundle:
  wsId 空 / existingSpecRoot 已有 / client 未实现 → null
  tarBuf = client.getSpecBundle(wsId)
    catch 404 → mkdir 空目录返回 specDir（首次 scan 容错，R-02/E-01）
    catch 其他 → 透传
  rm -rf specDir（Windows EBUSY 降级忽略）→ extractTar(tarBuf, specDir)
postSpecSync: packSpecDir → client.postSpecSync
packSpecDir: walkDir → 逐 entry buildTarHeader(512B ustar) + 数据 + 512 对齐 → 2×512 zero 结尾
  - 默认剪枝：顶层 `runtime/`(无点 scan-runs 日志) + 任意深度 `worktrees`（非 spec 数据）；`.runtime`(有点) 保留
  - name > 100 字节：先写 GNU LongLink('L' 头 + 长名 data)，再写正常 header（Python tarfile r:* 原生读）
extractTar: 512B 步进解析 ustar；路径穿越双重防护（name 含 .. / 绝对路径 / join 后 rel 不以 .. 开头则抛）
```
walkDir 相对路径用 POSIX `/`（tar 标准）；symlink 跳过（不收集）。

## 注意事项
- **D-007 设计**：纯函数 + client 参数注入，batch（TaskRunner.client）与 interactive（daemon 持有 client）共用，无实例状态依赖。
- wsId 含路径分隔符（/ \）时 resolveSpecDir 抛 Error（防御性，正常是 UUID）。
- **R-03 / design 约定**：sync 失败不改写 agent 结果、不阻塞 session 终态（调用方 catch 后仅 warn）。
- extractTar 仅支持 regular file（typeflag '0'/'\0'）+ directory（'5'）；symlink/hardlink 跳过 + warn。
- buildTarHeader checksum 按 unsigned byte sum 计算（checksum 字段视为 8 个空格），写 6 位 octal + NUL + 空格。
- 404 容错用 duck-type `isHubHttp404`（status===404），不硬依赖 hub-client.ts 导出，规避 HubHttpError 改名风险。
- **ql-20260813-004**：push 默认排除 `runtime/`(无点)+`worktrees`，保留 `.runtime`(有点)。历史坑：曾含 `runtime/scan-runs/<uuid>/<长change名>-brainstorm-stepNN-<ts>.txt`，name 超 100 字节被 buildTarHeader 静默截断 → 后端 `_write_spec_root` read_bytes FileNotFoundError → HTTP 500（daemon 记 change_write_execute_failed）。根治=LongLink 长名 + 排除 runtime(无点) 双管齐下。
- **ql-20260813-007（P0）**：push 默认排除 `.runtime`(有点)整树——sillyspec.db（SQLite 二进制含 NUL）写进后端 scan_documents 文本列触发 asyncpg `0x00` 整批回滚 500。`.runtime` 加 excludeTop（顶层）+ pruneNames（任意深度，对齐 build_bundle）。
- **ql-20260813-spec-sync-visibility（P1）**：① `postSpecSync` 返回加 `filesTotal`（增量=ops.length / 全量=manifest 文件数）；② 加 `onProgress` 回调（增量 computeIncrementalOps 后 / 全量 `packSpecDir.onWalkComplete` 时上报 total+processed=0）；③ `packSpecDir` 加 `onWalkComplete(filesCount)` 钩子（BL-2：walkDir 后 tar 拼接前，全量首同步进度窗口）。供 task-runner spec-sync 分支接 `reportChangeWriteProgress` 端点（W3/W4）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
- ql-20260816-003 | `postSpecSync` 包装器实装 `pending_push` 标记（`hasUnsyncedLocalChanges` 信号 1，曾只读不写=死代码）：push 失败（网络/服务端终止/5xx）写 `specDir/.runtime/pending_push`，成功清除，`SpecPushConflict` 不动（人工拍板非传输失败）。作用：mtime 信号（信号 2）依赖 fs 时间戳比对（时钟偏移/粗粒度 fs 可能漏判），标记是显式「本地有未回灌改动」声明，pull-before-push（D-008）据其保证 daemon 中断/服务端终止时本地改动不被 pull 覆盖且下次同步自动重推。写/清均 best-effort（失败仅 warn，对齐 R-03）。impl 改名 `postSpecSyncImpl`（模块私有），公开签名不变。
- ql-20260816-003（测试基建）| ① 19 个 daemon 测试文件 `server_url` 从 `http://test:8000` 改 `http://127.0.0.1:8000`——"test" 主机 DNS 解析 2.3s/次 × daemon.start 2 次版本/技能清单 fetch ≈ 4.6s/测试，满载 hook 超时致全量 flaky（2276 passed 1~3 failed）；IP 字面量 3ms 连接拒绝，全量 2377 passed 0 failed、时长 226s→73s。② B 组 B1 + borrow-sandbox 3 处固定 `sleep()` 改轮询 `waitFor`（满载异步链 >sleep 误判未调），B1 另加 try/finally 兜底 resolve pull 防 daemon.stop 挂死。
