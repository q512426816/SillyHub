# .sillyspec-platform.json 双写契约不一致

**状态**：已核实（2026-07-07），待修复
**来源**：sillyspec 工具自检反馈 + 代码核实
**严重度**：中（平时被 sillyspec 后写覆盖掩盖，新工作区 init 后未跑 sillyspec 即读时触发拒跑）

## 问题

`.sillyspec-platform.json` 这个文件名被**两套系统**同时使用，但字段契约互不兼容：

### sillyspec 工具（全局 `C:\nvm4w\nodejs\node_modules\sillyspec` v3.22.5）

- 读 `src/progress.js:68 resolvePlatformSpecDir`：必须有 `specRoot`，缺则抛
  `PointerUnreachableError: pointer 缺少 specRoot 字段`（fail-closed）。
- 损坏判定 `src/constants.js:68 isPointerCorrupted`：`!specRoot || !savedAt` 即坏。
- 写 `src/run.js:1279`：`{ specRoot, runtimeRoot, workspaceId, scanRunId, savedAt }`（camelCase）。
- 触发：`sillyspec run --spec-root …` 平台模式。

### sillyhub daemon（`sillyhub-daemon/src/spec-sync.ts`）

- 写 `writePlatformConfig`（`:866`）：`{ workspace_id, server_origin, strategy, spec_version, cache_root, synced_at }`
  （snake_case 6 字段，**无 specRoot / savedAt**）。
- 活代码路径：`task-runner.ts:386-392` 探测 `mode==='init'` → `_runInitLease` → `handleInitLease` → `writePlatformConfig`。
- 写入位置：`join(rootPath, '.sillyspec-platform.json')`。

### 冲突点

两边写入位置是**同一个文件**（daemon 调 sillyspec CLI 时 `cwd = rootPath`），但字段互不兼容：

- daemon 版本 → sillyspec 读 → `isPointerCorrupted = true` → `PointerUnreachableError` → **拒跑**，提示 `sillyspec platform pointer --cleanup`。
- sillyspec 版本 → daemon 读 → `spec_version` 等字段兜底为 0/空串（不崩，但保鲜逻辑失效）。

## 为什么平时没崩

sillyspec 的写入**总是后发生并覆盖**：daemon init 先写 6 字段 → daemon 随后调 `sillyspec run --spec-root …` → sillyspec 写 5 字段盖掉。日常看到的总是 sillyspec 格式。只有顺序反过来（新工作区 init 后、sillyspec 还没跑就被读）才会爆。

## 诊断方法

```bash
cat <项目根>/.sillyspec-platform.json
```

- `{specRoot, runtimeRoot, workspaceId, scanRunId, savedAt}` → sillyspec 写的（当前正常态）。
- `{workspace_id, server_origin, strategy, spec_version, cache_root, synced_at}` → daemon 写的，sillyspec 读它会 fail-closed（bug 触发态）。

## 修复方向（待 brainstorm 定）

- **A（小改）**：daemon `writePlatformConfig` 改按 sillyspec 契约写，至少补 `specRoot` + `savedAt`（可保留 daemon 自己的额外字段；sillyspec 对多余字段不敏感）。
- **B（收敛）**：daemon 不再自己写这个文件，完全交给 sillyspec 工具管理；daemon 的 `spec_version` 保鲜另寻存储（如 `~/.sillyhub/daemon/specs/<ws>/.runtime/` 下独立文件）。

跨 sillyhub daemon + sillyspec 工具两个仓库的契约修复，建议走完整 SillySpec 流程起变更。
