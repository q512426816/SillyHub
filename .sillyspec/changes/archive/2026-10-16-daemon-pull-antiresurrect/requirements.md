---
author: flow-machine-draft
created_at: 2026-10-16T12:31:51.997Z
---
# 需求规格（Requirements）— 2026-10-16-daemon-pull-antiresurrect

## 功能需求

### FR-01: pullSpecBundle 落地前按 LocalManifest 算「本地已删面」（manifest 有/盘面无/属同步面），解包产物命中文件不落地，swap 与 in-place 兜底两路径均不复活

- **必须**：`pullSpecBundle` 在整树覆盖落地前，将「LocalManifest 含该路径、当前盘面无该路径、且该路径不命中上传排除口径（isUploadExcludedPath）」的文件判定为本地已删面，解包产物中命中文件**禁止**落地——swap 主路径与 in-place 兜底路径行为一致（两路径落地后均不存在被复活文件）。

#### 场景：主路径

Given LocalManifest 含 docs/b.md 且盘面 specDir 下无 docs/b.md（本地已删除、删除 op 未上行），When pullSpecBundle 消费仍携带 docs/b.md 的 bundle，Then 落地后 specDir 下不存在 docs/b.md，且同步面内其余文件（docs/a.md）正常更新。

### FR-02: manifest 缺失/解析失败/首拉 = 无抑制面，既有全量回放行为不变

- **必须**：LocalManifest 缓存缺失或解析失败时，抑制面必须为空集，bundle 全量文件照常落地——首拉/全新环境行为与本变更前完全一致。

#### 场景：主路径

Given 本地无 manifest 缓存（首拉），When pullSpecBundle 消费含任意文件的 bundle，Then bundle 全部文件落地、无防复活抑制 warn 输出。

### FR-03: 命中面 warn 点名（截断 5）+ 恢复通道（PullSpecBundleOptions.restoreDeleted 或环境变量 SILLYHUB_DAEMON_RESTORE_DELETED=1 跳过抑制）

- **必须**：抑制命中时输出 warn 日志（含「防复活抑制」字样与被挡路径点名，超过 5 条截断）；`restoreDeleted: true`（opts）或环境变量 `SILLYHUB_DAEMON_RESTORE_DELETED=1` **必须**跳过抑制（bundle 携带的已删文件照常落地）。

#### 场景：主路径

Given 抑制面非空且 bundle 携带命中文件，When 不设恢复通道执行 pull，Then warn 日志点名被挡路径；When 设置 opts.restoreDeleted=true 或 env 后执行 pull，Then 命中文件照常落地且无抑制 warn。

### FR-04: 抑制跨 pull 持久——落地重建基线保留被抑制行，直至删除 op 上行成功自然衰减

- **必须**：被抑制文件经 pull 落地重建后，manifest 基线**必须**保留该行（重建时并回被抑制行，仅当落地树确实无该路径；用户已手工恢复的行以落地树为准）——delete op 生成链（条件「缓存有/盘面无」）不得断裂，后续自动 pull 的抑制持续有效；删除 op 经既有 push 链上行成功后，抑制面自然衰减。

#### 场景：主路径

Given 被抑制 pull 完成且删除 op 未上行（manifest 基线仍含该行），When 第二次 pullSpecBundle 消费仍携带该文件的 bundle，Then 该文件依旧不落地（抑制跨 pull 持久），且落地重建后基线仍含该行。

### FR-05: vitest 新用例覆盖抑制/无基线全量/恢复通道/排除口径四点，既有测试零回归，tsc 通过

- **必须**：新增 vitest 用例覆盖 FR-01~FR-04 四点行为；既有 daemon 测试套件零新增失败（与本次改动无关的预存失败按归因豁免）；`tsc --noEmit` 零错。

#### 场景：主路径

When 执行 `pnpm vitest run tests/pull-antiresurrect.test.ts`，Then 4 用例全绿；When 执行 `pnpm typecheck`，Then exit 0。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: tests/pull-antiresurrect.test.ts「用例1（核心）：manifest 有/盘面无/同步面 → 解包产物不落地（不复活）+ warn 点名」
FR-02: tests/pull-antiresurrect.test.ts「用例2：manifest 缺失（首拉）= 无抑制面，全量落地（既有行为不变）」
FR-03: tests/pull-antiresurrect.test.ts「用例3：restoreDeleted（opts / env）= 显式恢复，跳过抑制」
FR-04: tests/pull-antiresurrect.test.ts「用例1（核心）」持久性断言（第二次 pull 依旧抑制 + manifest 基线仍含被抑制行）
FR-05: tests/pull-antiresurrect.test.ts（全文件 4 用例）+ 全量套件零新增失败归因记录
