---
id: task-02
title: "[A1][daemon] 激活 SPEC_ROOT_MAP 翻译器（config.ts + daemon-start.bat 注入）"
priority: P0
depends_on: [task-01]
blocks: [task-03]
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/config.ts
  - sillyhub-daemon/src/daemon.ts
author: qinyi
created_at: 2026-06-22T21:19:09
---

# task-02: [A1][daemon] 激活 SPEC_ROOT_MAP 翻译器

## 修改文件

- `sillyhub-daemon/src/config.ts:64-150`（DaemonConfig interface）+ `:168-196`（DEFAULT_CONFIG）— 新增 `spec_root_map: string` 字段，默认空串
- `sillyhub-daemon/src/daemon.ts:1699-1705`（`_startInteractiveSession` 内已有 SPEC_ROOT_MAP 翻译器）— 把数据源从 `process.env.SPEC_ROOT_MAP` 改为优先读 `this._config.spec_root_map`，env 兜底；并加一行 `info` 日志记录翻译前后 prompt 摘要
- `daemon-start.bat`（本机启动脚本，**仓库内不存在**，由用户维护）— 设 `set SPEC_ROOT_MAP=/data/spec-workspaces:%SPEC_DATA_HOST_DIR%`；本任务的 allowed_paths 不含它（仓库内无此文件），仅文档约定启动脚本必须注入；若启动脚本由其他方式（PowerShell / cmd / npm script）替代，等价设置该环境变量即可

## 覆盖来源

- design.md §4.1 A1 第 2 层（daemon 激活 SPEC_ROOT_MAP 翻译器）
- design.md §9 兼容策略（SPEC_ROOT_MAP 未配置时翻译器跳过，向后兼容旧 daemon）
- requirements.md FR-01

## 实现要求

1. **config.ts 加字段**：
   - `DaemonConfig` interface（:64-150）在 `allowed_roots` 之后追加：
     ```ts
     /**
      * prompt 路径翻译映射，格式 "from:to"，如 "/data/spec-workspaces:C:/data/spec-workspaces"。
      * daemon 在 prompt 透传给 SessionManager.create 前，把 from 替换为 to。
      * 来自 process.env.SPEC_ROOT_MAP（daemon 启动脚本注入）。
      * 空串表示不翻译（向后兼容旧 daemon，SPEC_ROOT_MAP 未设）。
      * 详见 design 2026-06-22-agent-run-pipeline-fix §4.1 A1。
      */
     spec_root_map: string;
     ```
   - `DEFAULT_CONFIG`（:168-196）追加 `spec_root_map: ''`（空串默认，向后兼容）。
2. **config.ts 加 env 读取**：`loadConfig`（:224-261）末尾返回前，用 `process.env.SPEC_ROOT_MAP` 覆盖（env 优先于 config.json 落盘值）：
   ```ts
   // daemon 启动脚本（daemon-start.bat 等）注入 SPEC_ROOT_MAP，优先于 config.json。
   // 不落盘（避免 host 路径被序列化到 config.json，跨机器冲突）。
   const envSpecRootMap = process.env.SPEC_ROOT_MAP;
   if (envSpecRootMap !== undefined) {
     data.spec_root_map = envSpecRootMap;
   }
   ```
3. **daemon.ts 翻译器改数据源**：`:1699-1705` 当前是
   ```ts
   const specRootMap = process.env.SPEC_ROOT_MAP;
   if (specRootMap && specRootMap.includes(':')) { ... }
   ```
   改为优先读 config，env 兜底（与 config.ts loadConfig 行为一致，双保险）：
   ```ts
   const specRootMap = this._config.spec_root_map || process.env.SPEC_ROOT_MAP || '';
   if (specRootMap && specRootMap.includes(':')) {
     const [from, to] = specRootMap.split(':', 2);
     if (from && to && prompt.includes(from)) {
       this._logger.info('interactive_spec_root_translated', {
         lease_id: leaseId,
         from, to,
         prompt_before_snippet: prompt.slice(0, 200),
       });
       prompt = prompt.replaceAll(from, to);
     }
   }
   ```
   **注意**：daemon.ts:1701 现有 `split(':', 2)` 在 Windows 盘符 `C:/...` 与分隔符 `:` 冲突时，`split(':', 2)` 只取前两段（`['/data/spec-workspaces', 'C']`），漏掉 `/data/spec-workspaces`。这是已知问题——见边界处理 4，本任务暂用现有 split（实际测试中 `C:/data/spec-workspaces` 中首个 `:` 是盘符后分隔，`split(':',2)` 会把 `to` 截成 `C`，翻译结果错误）。**必须修正**：改用首个 `:` 分割（`indexOf(':')` + slice），而非 `split(':', 2)`。实现：
   ```ts
   const colonIdx = specRootMap.indexOf(':');
   const from = specRootMap.slice(0, colonIdx);
   const to = specRootMap.slice(colonIdx + 1);
   ```
4. **daemon-start.bat 约定**（不在 allowed_paths，文档级约定）：用户维护的 daemon 启动脚本中设置：
   ```bat
   set SPEC_DATA_HOST_DIR=C:/data/spec-workspaces
   set SPEC_ROOT_MAP=/data/spec-workspaces:%SPEC_DATA_HOST_DIR%
   ```
   该脚本本机位置由用户决定；本任务只确保 daemon 进程启动时进程环境含 `SPEC_ROOT_MAP`。
5. **TDD**：写单测覆盖（a）loadConfig 读 env 覆盖、（b）翻译函数对 `C:/...` 盘符的处理、（c）空串跳过。

## 接口定义

- **DaemonConfig 新字段**：`spec_root_map: string`（默认 `''`，非 nullable；空串 = 不翻译）。
- **环境变量**：`SPEC_ROOT_MAP`（string，格式 `from:to`，from/to 均为绝对路径，正斜杠；env 优先于 config.json）。
- **翻译函数语义**（daemon.ts:1699-1705）：
  - 输入：prompt（string）、specRootMap（string）
  - 若 specRootMap 空串 → 不翻译，返回原 prompt
  - 若 specRootMap 不含 `:` → 跳过（log warn），返回原 prompt
  - 按**首个** `:` 分割为 from/to（容忍 to 含 `:`，如 Windows 路径 `C:/data/spec-workspaces` 本身不含 `:` 但 to 理论上可以是任意串）
  - 若 prompt.includes(from) → `prompt.replaceAll(from, to)`；否则跳过（log debug）
  - 输出：翻译后 prompt（string）
- **日志事件**：`interactive_spec_root_translated`（info 级，含 lease_id / from / to / prompt 摘要前 200 字符）。

## 边界处理（≥5 条，覆盖 null/兼容性/异常/不可变/歧义）

1. **`SPEC_ROOT_MAP` 未设（旧 daemon 兼容）** — `process.env.SPEC_ROOT_MAP === undefined` → loadConfig 不覆盖 → `data.spec_root_map` 保持空串默认 → 翻译器 `if (specRootMap)` 短路跳过，prompt 原样透传。daemon 不报错，行为与改动前完全一致（向后兼容，design §9）。
2. **prompt 不含 from** — `prompt.includes(from) === false` → 跳过 replaceAll，prompt 原样返回；记 debug 日志（避免每次 interactive 都刷 info）。
3. **Windows 盘符 `C:` 与分隔符 `:` 冲突** — 旧实现 `split(':', 2)` 会把 `/data/spec-workspaces:C:/data/spec-workspaces` 分成 `['/data/spec-workspaces', 'C']`，漏 `/data/spec-workspaces`。**本任务修正**为 `indexOf(':')` + slice：from = `/data/spec-workspaces`，to = `C:/data/spec-workspaces`（首个 `:` 后全部，含盘符 `:`）。
4. **多映射场景** — 当前 spec 只有一对 from/to（`/data/spec-workspaces` ↔ `C:/data/spec-workspaces`）。若未来需要多对，扩展为分号分隔循环——**本任务不做**（YAGNI）。当前接口只支持单映射。
5. **路径含空格** — Windows 路径如 `C:/Program Files/spec-workspaces` 含空格，replaceAll 字面替换不受影响（空格是字符串普通字符，无需转义）；env 变量值含空格时 daemon-start.bat 需用 `set "VAR=value with space"`（双引号包裹），这是 batch 脚本注意事项。
6. **config.json 落盘的脏数据** — 旧 config.json 可能含 `spec_root_map` 字段（本次新增前不存在，不会脏）。loadConfig 的 env 覆盖逻辑保证 env 永远优先，避免脏 config.json 把翻译关掉。
7. **from/to 为空** — specRootMap 仅 `:`（`from=''`、`to=''`）→ `if (from && to)` 短路跳过。specRootMap 仅 `abc`（无 `:`）→ `includes(':')` 为 false 跳过。
8. **daemon-service-split 影响** — daemon.ts 正在被 `2026-06-22-daemon-service-split` 变更拆分。execute 前确认 `_startInteractiveSession` 是否已迁出 daemon.ts（如迁到新模块如 `interactive/launcher.ts`），若是则在新文件改，否则在 daemon.ts:1699-1705 改。config.ts 不受拆分影响。

## 非目标

- 不改翻译器支持多对映射（YAGNI，当前只需单映射）。
- 不把 SPEC_ROOT_MAP 落盘到 config.json（避免跨机器污染）。
- 不改 daemon-start.bat（仓库内不存在该文件；用户本机维护）。
- 不动 batch task 路径（batch 走 task-runner，不走 interactive prompt 翻译；batch 没有路径崩溃问题）。
- 不改 prompt 翻译的执行时机（仍在 _startInteractiveSession 内、SessionManager.create 之前，符合现有设计）。

## TDD 步骤

1. **写测试**：扩展 `sillyhub-daemon/src/__tests__/config.test.ts`（或同级测试文件）：
   - `loadConfig` 读到 `process.env.SPEC_ROOT_MAP='/data/spec-workspaces:C:/data/spec-workspaces'` 时，返回 `data.spec_root_map === '/data/spec-workspaces:C:/data/spec-workspaces'`。
   - env 未设时 `data.spec_root_map === ''`（默认值，不报错）。
   - env 设为空串时 `data.spec_root_map === ''`（空串覆盖，但翻译器跳过）。
   - （saveConfig 不写 spec_root_map 到 config.json——验证 env 注入值不落盘。）
2. **写测试**：扩展 daemon 翻译器测试（`sillyhub-daemon/src/__tests__/daemon-interactive.test.ts` 或新建 `daemon-spec-root-map.test.ts`）：
   - 输入 prompt = `请扫描 /data/spec-workspaces/abc-123/docs/` + specRootMap = `/data/spec-workspaces:C:/data/spec-workspaces` → 输出含 `C:/data/spec-workspaces/abc-123/docs/`，不含 `/data/`。
   - 输入 prompt 不含 from → 输出与输入一致。
   - specRootMap 空串 → 输出与输入一致。
   - specRootMap = `:` → 输出与输入一致（from/to 空）。
3. **确认失败**：改 config.ts / daemon.ts 前跑测试，全部失败。
4. **写代码**：按"实现要求"改 config.ts（interface + DEFAULT + loadConfig env 覆盖）与 daemon.ts（翻译器数据源 + split 改 indexOf + 日志）。
5. **确认通过**：重跑测试，全部通过。
6. **回归**：`cd sillyhub-daemon && pnpm typecheck && pnpm test` 全绿；既有 interactive 测试不被破坏。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | daemon 启动时 `SPEC_ROOT_MAP=/data/spec-workspaces:C:/data/spec-workspaces` | 进程内 `config.spec_root_map === '/data/spec-workspaces:C:/data/spec-workspaces'` |
| AC-02 | daemon 跑 interactive lease，prompt 含 `/data/spec-workspaces/abc-123` | 日志 `interactive_spec_root_translated` 出现，from=`/data/spec-workspaces`，to=`C:/data/spec-workspaces`；SessionManager.create 收到的 prompt 含 `C:/data/spec-workspaces/abc-123` |
| AC-03 | 同 AC-02，检查 prompt 中 `/data/spec-workspaces/abc-123` 字面 | 已全部替换为 `C:/data/spec-workspaces/abc-123`，无残留 `/data/` |
| AC-04 | daemon 启动时**不**设 `SPEC_ROOT_MAP` | daemon 不报错；翻译器跳过；prompt 原样透传（向后兼容） |
| AC-05 | `SPEC_ROOT_MAP=:`（仅冒号） | 翻译器跳过；prompt 原样；daemon 不崩 |
| AC-06 | `SPEC_ROOT_MAP=abc`（无冒号） | 翻译器跳过；daemon 记 warn 日志；prompt 原样 |
| AC-07 | Windows 盘符场景 `SPEC_ROOT_MAP=/data/spec-workspaces:C:/data/spec-workspaces`，prompt 含 `/data/spec-workspaces` | split 正确：to=`C:/data/spec-workspaces`（含盘符路径），不是 `C` |
| AC-08 | `cd sillyhub-daemon && pnpm typecheck` | 无类型错误；DaemonConfig.spec_root_map 字段类型正确 |
| AC-09 | `cd sillyhub-daemon && pnpm test`（含新增 config + 翻译器测试） | 全部通过 |
