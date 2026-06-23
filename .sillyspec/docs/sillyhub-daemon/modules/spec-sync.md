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
- `packSpecDir(specDir): Promise<Buffer>` ——本地 spec 整树打 tar（排除 .runtime 段）。

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

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
