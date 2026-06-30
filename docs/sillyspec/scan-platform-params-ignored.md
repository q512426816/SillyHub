---
author: qinyi
created_at: 2026-06-30 13:45:02
---

# scan：sillyspec 3.20.3 完全忽略平台参数，不支持平台模式

## 现象

平台模式 scan 启动命令带全套平台参数：

```
sillyspec run scan --dir "<源码>" \
  --spec-root ~/.sillyhub/daemon/specs/<workspace> \
  --runtime-root ~/.sillyhub/daemon/specs/<workspace>/runtime \
  --workspace-id <workspace> \
  --scan-run-id <run-id>
```

但 sillyspec 3.20.3 静默忽略 `--spec-root`/`--runtime-root`/`--workspace-id`/`--scan-run-id`，仍把所有状态与文档写到 **cwd（源码目录）**：
- progress.json → `<源码>/.sillyspec/.runtime/progress.json`
- 文档默认 → `<源码>/docs/<project>/scan/*.md`

## 根因

对 sillyspec 3.20.3（`C:\nvm4w\nodejs\node_modules\sillyspec`）全包 grep：

```
grep -rn "specRoot|scanRunId|workspaceId|runtimeRoot|savedAt|sillyspec-platform" src dist
```

**零命中**。即源码中根本不存在平台参数的读取/使用逻辑。这些 CLI flag 被 argv 解析器当作未知 flag 静默吞掉。

backend 写入源码目录的 `.sillyspec-platform.json`（含 specRoot/runtimeRoot/workspaceId/scanRunId/savedAt 字段）也**不被 sillyspec 读取**——它只是 backend 的平台上下文标记，sillyspec 端无对应消费方。

## 影响

- 违反平台核心约束「文档写 spec-root、源码只读、不创建 .sillyspec」：stock CLI 会把文档写进源码 `docs/`，并把 progress 写进源码 `.sillyspec/.runtime/`。
- 平台期望的输出布局（`spec-root/docs/<subproject>/scan/*.md` + `projects/*.yaml` + `manifest.json` + `.runtime/scan-projects.json`）stock CLI 无法产出——参照旧 workspace `b97f8231` 的该布局由 **SillyHub backend 编排**生成，非 sillyspec CLI 直出。
- stock CLI 的 scan 是「单项目」（`docs/<project>/scan/`），不支持 monorepo 多子项目分组。

## 规避（本次扫描采用）

AI 步骤执行器（即调用方）自行承担文档落盘责任：
1. 执行各 scan 步骤的只读调查（grep/find，源码只读）。
2. 把生成的 scan 文档**手动写到 spec-root** 的平台布局 `docs/<subproject>/scan/*.md`（非源码目录）。
3. 平台元数据 `manifest.json`/`projects/*.yaml`/`.runtime/scan-projects.json` 手动补建（参照已成功扫描的旧 workspace 结构）。
4. `--done` 推进 sillyspec 步骤状态机（仅用于流程门控，不影响文档位置）。

## 建议

- sillyspec CLI 应在 platform 模式下读取 `.sillyspec-platform.json`（或接受并真正使用 `--spec-root`/`--scan-run-id` 等参数），将 progress 与文档根切到 spec-root，保持源码只读。
- 或 backend 在编排 scan 时显式将 cwd 设为 spec-root 并通过其它机制引用源码路径，使 stock CLI 的相对路径落到 spec-root。
- 附带：`sillyspec run scan --help` 不显示帮助而是直接运行 scan（`--help` 未被 commander 识别），应修复。

## 关联

- 版本：sillyspec 3.20.3（nvm4w，active）；另有 AppData 3.10.0（更旧，同样无平台逻辑）。
- 旧 workspace `b97f8231`（2026-06-27 扫描，commit 19482695）是平台感知扫描的成功参照，布局见其 `docs/<sub>/scan/` + `manifest.json`。
- 同批次另一缺陷：`scan-change-shortcircuits-done.md`。
