---
schema_version: 1
doc_type: module-card
module_id: scripts
source_commit: 9656307c
author: qinyi
created_at: 2026-08-08 21:10:00
---
# 运维校验脚本（scripts）
## 定位
仓库根 `scripts/` 顶层运维 / 校验脚本集合。跨子项目（backend / sillyhub-daemon / scan 文档体系）的一次性运维、CI 漂移检测、部署期 smoke 前置校验。脚本各自独立、可直接 `python scripts/x.py` 或 `node scripts/x.mjs` 运行，跨平台（Windows/Linux/macOS，CLAUDE.md 规则 13）。历史上未被 _module-map 覆盖（scan 遗留），2026-08-08 archive（2026-08-08-dispatch-worker-caller-worktree）补登顶层 `scripts` 模块。
## 契约摘要
- `scripts/check-dispatch-allowed-roots.mjs`（Node ESM，2026-08-08-dispatch-worker-caller-worktree）：路径A 部署期 smoke 前置**硬校验**——caller 仓根不在 daemon 本地 config 的 `allowed_roots` 内 → `EXIT 1` + 中文引导（fail-closed，复刻 `file-rpc.ts under` 守卫语义，design §10 R-03）。仅覆盖「守卫一」（本地 config → assertWithinAllowedRoots / HostFsHandler）；「守卫二」（backend runtime overlay / PolicyEngine）需另在 backend / 前端确认。
- `scripts/scan-drift-check.py`（Python stdlib，warn-only）：scan 文档漂移双信号检测（source_commit 时效 + 引用路径存在性），CI `.github/workflows/scan-drift.yml` gate 调用（2026-08-06-scan-doc-drift-gate）。退出码始终 0（不阻塞 PR），仅脚本自身异常才非 0。
- `scripts/test_scan_drift_check.py`：上一脚本的单测。
- `scripts/migrate_scan_docs.py`：一次性运维，把 scan docs 从 workspace repo `root_path` 迁到 `spec_root`（idempotent，`shutil.copytree(dirs_exist_ok=True)`）。
## 关键逻辑
```
# check-dispatch-allowed-roots.mjs（路径A R-03 fail-fast）
读 daemon config-<hash>.json 的 allowed_roots → 仓根不在其中 → EXIT 1 + 引导
（避免 dispatch_worker spawn 阶段才报 'path outside allowed_roots'，worker 起不来）

# scan-drift-check.py（warn-only，GitHub ::warning 注解）
信号1: scan 文档 source_commit 落后 HEAD > 阈值（默认 50，env 可配）→ 漂移
信号2: body 引用的 backend/frontend/sillyhub-daemon/deploy 路径不存在 → 漂移
```
## 注意事项
- `check-dispatch-allowed-roots.mjs` 是路径A 部署**必跑**前置；漏跑会导致 dispatch worker spawn 时被守卫拦下起不来。
- scan-drift-check 仅依赖 Python stdlib，勿引入第三方依赖（CI 免安装）。
- 新增顶层脚本应在此卡片 + `_module-map.yaml` 同步登记，避免再次落 scan 未匹配。
## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
