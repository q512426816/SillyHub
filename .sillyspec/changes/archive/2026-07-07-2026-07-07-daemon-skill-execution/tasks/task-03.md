---
author: qinyi
created_at: 2026-07-07 13:35:00
goal: 新建 daemon skill-manager 实现平台 sillyspec skills 的 manifest 比对 + bundle 拉取 + 解压同步
implementation: 新增 sillyhub-daemon/src/skill-manager.ts；daemon 启动/注册时调 GET /api/daemon/skills/latest/manifest（task-06 提供）比对本地版本，新则拉 bundle（sillyspec-skills.tar.gz）校验 sha256 后解压到 ~/.sillyhub/daemon/skills/sillyspec-*；claude 启动时在 workdir .claude/skills/ 建 symlink（或 --skill-dir 若 claude CLI 支持）指向同步目录；仿 daemon self-update 的 bundle 分发 + 版本比对
acceptance: daemon 启动查 manifest 版本旧则跳过、新则拉 bundle 解压；skills 目录含 sillyspec-* skill；claude 启动 .claude/skills/ 可见 sillyspec skills；版本相同不重复拉
verify: cd sillyhub-daemon && pnpm test（skill-manager mock bundle 拉取 + 版本比对 + 解压单测）
constraints: 复用 daemon self-update 的 bundle 下载/校验/解压工具（不重复造）；按 D-002 选启动拉（非 lease 拉，skills 低频变更）；bundle 格式 + manifest 字段对齐 task-06 契约（tar.gz + manifest.json 含版本+sha256）
depends_on: [task-06]
covers: [FR-03, D-002@V1, D-008@V1]
---

# task-03: daemon skill-manager 新建（平台 skills 同步）

## 验收标准

A. 新增 sillyhub-daemon/src/skill-manager.ts，实现 daemon 启动时查 GET /api/daemon/skills/latest/manifest、与本地已装版本比对：版本相同跳过拉取（NFR-02 性能，不重复下载）；版本新则拉 bundle、校验 manifest 中的 sha256、解压到 ~/.sillyhub/daemon/skills/sillyspec-*。
B. daemon.ts 启动流程接线调用 skill-manager 同步（启动钩子触发），claude 启动时 workdir 的 .claude/skills/ 下能见到 sillyspec-* skills（symlink 或 copy 实现任选，但 claude 启动 cwd=workdir 时 skills 可被发现）。
C. sillyhub-daemon `pnpm test` 全绿，新增单测 mock backend manifest/bundle 端点覆盖"版本相同跳过""版本新则拉+解压+sha256 校验失败报错"三条路径，且不影响 daemon 既有启动流程。
