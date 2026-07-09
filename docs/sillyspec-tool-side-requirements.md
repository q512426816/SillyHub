# SillySpec 工具侧调整要求（SillyHub 平台对接）

> 本文件记录 SillyHub 平台（`multi-agent-platform`）对接 sillyspec「平台模式」时，
> 需要 sillyspec CLI（[github.com/q512426816/sillyspec](https://github.com/q512426816/sillyspec)）
> 侧配合调整或确认的点。平台侧实现已完成（见文末「平台侧已实现」），以下为工具侧重镇。
>
> - author: qinyi
> - created_at: 2026-06-20
> - sillyspec 版本：3.19.1

## 背景

SillyHub 通过 sillyspec 的「平台模式」托管 spec：用 `--spec-root / --runtime-root
/ --workspace-id / --scan-run-id` 把 spec 产物写到外部 `spec_root`，sillyspec 写产物、
平台读产物（见 sillyspec `docs/platform-scan-protocol.md`）。

平台侧已打通 scan 闭环，并补齐了 stage（propose / plan / execute / verify / archive /
brainstorm / quick）的平台参数注入、stage 完成回调、changes 回流、scan 结构化校验。
以下 3 项需要 sillyspec 工具侧配合。

---

## 【P0 · 必修】init.js 无差别删除 `.sillyspec/` 的资产保护

> ✅ **已解决**（sillyspec v3.22.x，2026-07 核实）：`src/init.js:148-183`（`doInstall`）已实现真实资产检测（`changes/` 非空 || `projects/` 非空 || `sillyspec.db` 存在）+ 拒绝整删 + `cleanupRuntimeResidue`（白名单保留 `worktrees/`、`sillyspec.db` 等权威状态，只清 `.runtime/` 缓存子项 + `local.yaml` + `codebase/`）。回归测试：`test/runtime-cleanup-keeps-worktree.test.mjs`（28 断言）+ `test/spec-dir.test.mjs`（38 断言）全绿。下方原方案保留作历史记录。

### 问题

`src/init.js:111-117`：当 `init --spec-dir <外部>` 且源码项目已存在 `.sillyspec/` 时，
无差别 `rmSync` 删除整个 `.sillyspec/`（注释写的是「清理旧版本残留」，但未区分真实资产）。
若源码项目**本身就用 SillySpec 管理**（含真实 `changes/`、`sillyspec.db`），资产被整目录
删除 —— SillyHub 对这类项目发起平台 scan 时已造成 644 个 changes 资产丢失事故。

### 修复（推荐方案 A：真实资产保护）

`readdirSync` 第 1 行已 import。替换 `src/init.js:111-117`：

```js
  const legacyDir = join(projectDir, '.sillyspec');
  if (specDir && existsSync(legacyDir)) {
    let changesNonEmpty = false;
    try {
      const changesDir = join(legacyDir, 'changes');
      if (existsSync(changesDir)) {
        changesNonEmpty = readdirSync(changesDir).length > 0;
      }
    } catch {}
    const hasDb = existsSync(join(legacyDir, 'sillyspec.db'));

    if (changesNonEmpty || hasDb) {
      // 真实资产存在：拒绝整体删除，仅清理运行时残留
      console.error('❌ [sillyspec] 拒绝删除源码目录的 .sillyspec/：检测到真实资产（changes/ 或 sillyspec.db）。');
      console.error('   该项目似乎本身就用 SillySpec 管理。如需改用外部 spec 目录，请先手动迁移/备份 changes/ 与 sillyspec.db。');
      console.error('   本次仅清理运行时残留（.runtime/、local.yaml、codebase/）。');
      for (const residue of ['.runtime', 'local.yaml', 'codebase']) {
        const p = join(legacyDir, residue);
        if (existsSync(p)) { try { rmSync(p, { recursive: true, force: true }) } catch {} }
      }
    } else {
      // 无真实资产：确属旧版本残留，安全删除
      try { rmSync(legacyDir, { recursive: true, force: true }) } catch {}
      if (!existsSync(legacyDir)) console.log('🧹 已清理旧版本残留的源码 .sillyspec/ 目录');
      else console.error('⚠️ 清理残留 .sillyspec/ 失败');
    }
  }
```

判定：`changes/` 非空 **或** `sillyspec.db` 存在 ⇒ 真实资产，只清残留不整删；否则维持原清理。

### 验证

新增 `test/init-asset-protection.test.mjs`（参照 `test/spec-dir.test.mjs`）：
- 有资产：`init --spec-dir <外部>` 后 `changes/<key>/proposal.md` 仍在；
- 无资产（仅 `.runtime` 残留）：维持清理行为。

---

## 【P1 · 确认】非 scan stage 在平台模式下的命令支持

### 背景

平台侧现已为 propose / plan / execute / verify / archive / brainstorm / quick 的**启动命令**
注入平台参数：

```
sillyspec run <stage> --change <key> --spec-root <spec_root> --runtime-root <runtime_root> --workspace-id <ws_id>
```

（`--done` 命令不重复平台参数，对齐 scan 的 done 行为。）

### 需 sillyspec 侧确认 / 保证

1. 这些 stage 接收 `--spec-root / --runtime-root / --workspace-id` 后应进入平台模式：
   `changes/<key>/` 产物写到 **`spec_root`**（而非 `cwd/.sillyspec`），`sillyspec.db` 写到
   `spec_root/.runtime/`。当前 `run.js` 的 `isPlatform = specRoot || runtimeRoot` 判断应已
   覆盖，请确认非 scan stage 同样生效。
2. **`--done` 命令的 spec_root 恢复**：启动命令带平台参数后，sillyspec 需持久化平台参数
   （类似 scan 的 `platform-scan.json`），使后续 `sillyspec run <stage> --done --change <key>
   --output ...`（不带平台参数）能正确恢复 spec_root，把状态写回 spec_root 的 db、不污染
   源码目录。若当前非 scan stage 无此持久化，请补齐；或明确要求 done 命令也带平台参数
   （平台侧可相应调整为 done 也注入）。

---

## 【P2 · 建议】stage 产物的结构化回执

scan 阶段会写 `<spec_root>/.runtime/platform-scan.json`、`<runtime_root>/scan-runs/<id>/manifest.json`、
`postcheck-result.json`，平台侧 `PostScanValidator` 已消费。若非 scan stage 也有类似结构化
回执（如 stage 完成的 manifest / 产物清单），平台可进一步消费做完成度校验，请一并定义协议。

---

## 平台侧已实现（multi-agent-platform，本轮）

| 断点 | 修复 | 位置 |
|---|---|---|
| **A1** | stage 启动命令注入 `{{platform_args}}`（`--spec-root` 等），使 stage 进平台模式、产物写 spec_root | `prompts/{propose,plan,execute,verify,archive,brainstorm,quick}.md` + `agent/service.py::start_stage_dispatch` |
| **A2** | `complete_lease` 接入 stage 完成回调（`sync_stage_status` + `auto_dispatch_next_step`），打通 stage→stage 自动链路（原先只在 `reconcile_stale_runs` 超时恢复路径调用） | `daemon/service.py::complete_lease` + `_trigger_stage_completion_callback` |
| **B** | `ChangeService.reparse` 支持 platform-managed `spec_root`（原先硬编码 `root_path`，扫不到 spec_root 下的 changes） | `change/service.py::reparse` |
| **C** | `PostScanValidator` 接入 scan 完成，消费 `manifest.json` / `postcheck-result` / 源码污染检测 / 7 文档齐全等回执（原先只在 tests 调用） | `daemon/service.py::_run_post_scan_validation` |
| **③** | `start_scan_dispatch` 派发前检测 `root_path/.sillyspec` 真实资产并拦截（仅 server-local；daemon-client 依赖上方 P0 的 init.js 补丁） | `agent/service.py::start_scan_dispatch` |

### 数据回流全景（修复后）

```
平台 → sillyspec   scan: build_scan_bundle（5 平台参数）
                   stage: start_stage_dispatch 注入 {{platform_args}}（3 平台参数）
sillyspec → 平台   daemon spec sync 整树回传 → apply_sync → scan_docs.reparse / change.reparse（读 spec_root）
                   backend 直读 spec_root/.runtime/sillyspec.db（sync_stage_status，A2 完成回调触发）
                   PostScanValidator 消费 manifest/postcheck（C，scan 完成触发）
```
