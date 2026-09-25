# thin-flow 平台参数面四缺口与变更名零校验（上游已修复留档）

> 状态：已处理（上游 sillyspec 3.30.0 + commit 41b3490d 已代码修复）——按 CLAUDE.md 规则 15 归档到 finished/。
> 来源：2026-09-25-change-center-thin-flow 变更准备期三子代理核对实证（本会话）；上游前置修复变更 2026-09-25-thin-platform-args（sillyspec 仓，commit 41b3490d）。

## 坑的来龙去脉

平台（multi-agent-platform）变更中心接入 SillySpec「轻量变更」（thin，2 调用协议 `flow start`/`flow done`）时核对发现：flow 命令族相对 `run` 族缺少平台参数面的四个支撑，且变更名全程零校验。在 3.30.0 之前的 CLI 上派发 thin 会话会产生如下问题：

1. **`--spec-dir` 崩溃**：flow 族启动即崩（`run` 族消费 `--spec-root`/`--spec-dir`，flow 族未消费且对未知参数不宽容）。
2. **空目录预建拒收**：平台预建的空 `.sillyspec` 目录被 flow start 拒收（要求非空目录），而平台侧 spec_root 初始化本就先于首次 flow。
3. **平台指针不读**：`.sillyspec/platform.yaml`/platform-scan.json 指针（platform-managed 布局锚点）flow 族不读取，spec 根锚定漂移。
4. **ProgressManager 锚定脱钩**：`ProgressManager` 未用 `specDir: specBase` 同根锚定，进度库与 flow 写出的 sillyspec.db 分裂成两个实例。
5. **变更名零校验**：flow 全链对 `--change <名>` 无白名单——`..`/路径分隔/`default`/`quick-<hex8>`（CLI 内部会话键形态）均可穿透，穿越名会误导 agent 在非预期目录跑 flow。

## 修复情况（上游）

- sillyspec 3.30.0：flow 族消费 `--spec-root`/`--spec-dir`（经 resolvePlatformSpecDir）；`ProgressManager({specDir: specBase})` 锚定同根；空目录预建放行；变更名白名单（拒 `..`/路径分隔/`default`/`quick-<hex8>`）。
- 上游修复变更：sillyspec 仓 2026-09-25-thin-platform-args（commit 41b3490d），quick 通道退役与 thin 缺省转正在 2026-09-25-thin-default-flip 归档。

## 平台侧配套（本仓）

- 派发 prompt 的 `platform_args`（`--spec-root/--runtime-root/--workspace-id`）沿用现有形态不改（3.30.0 flow 已消费 `--spec-root`；`--workspace-id` 静默忽略无害，triggerSync 走独立凭据链）。
- 派发入口对 thin 变更自查 change_key 白名单（纵深防御，防旧版 CLI 与穿越名）：`backend/app/modules/change/dispatch.py` `_validate_thin_change_key`。
- 部署核验清单含 daemon 机 `sillyspec --version` ≥ 3.30.0（design R-04）。

## 规避/解法（要点）

- daemon 机 CLI 版本低于 3.30.0 时，flow 会忽略 `--spec-root`，变更目录落在 agent cwd 的 `.sillyspec`——升级 CLI 后再派发 thin 变更。
- 平台入口白名单与上游白名单同规则（`^[A-Za-z0-9_.\-]+$` 且非 `default`/`quick-<hex8>`/`..` 段），上游先行、平台自查兜底。
