---
author: flow-machine-draft
created_at: 2026-10-19T23:53:09.722Z
---
# 需求规格（Requirements）— 2026-10-20-backfill-dryrun-log-scrub

## 功能需求

### FR-01: python scripts/backfill_commit_type.py 裸跑零落盘（输出计划写入与汇总）；--apply 不带 --yes 拒绝执行退出码 2；--apply --yes 落盘行为与原执行路径一致（幂等 unchanged 不写、CRLF 保留）

- 脚本缺省模式**必须**是 dry-run（只打印计划写入与汇总，零文件写入）；实际落盘**必须**经 `--apply` 显式开启，且 `--apply` 不带 `--yes` 时**必须**拒绝执行并以退出码 2 结束；`--apply --yes` 的写入行为（原位替换/末尾追加/归档目录新建、幂等 unchanged 不写、`newline=""` 保 CRLF）**必须**与改动前执行路径逐字节一致——本条只翻缺省方向与加确认门，不动写入逻辑。对齐先例：backend/scripts/backfill_change_titles.py（缺省 dry-run + `--apply` + 全量 `--yes` 门）。

#### 场景：裸跑即安全

- Given 一个含归档变更目录、flow-state.yaml 尚无 `commit_type:` 行的仓库
- When 操作者不带任何参数运行 `python scripts/backfill_commit_type.py`
- Then 输出以 `[dry] ` 前缀列出全部计划写入与汇总，`git status` 显示工作树零变化

#### 场景：确认门拦截

- Given 同上仓库
- When 运行 `python scripts/backfill_commit_type.py --apply`（不带 `--yes`）
- Then 进程退出码为 2，stderr 给出补 `--yes` 的指引，零文件写入

#### 场景：显式落盘与幂等

- Given 同上仓库
- When 运行 `--apply --yes` 后再原样复跑 `--apply --yes`
- Then 首跑完成计划写入（含 CRLF 文件行尾保持），复跑汇总全部 unchanged、零文件 mtime 变化

### FR-02: zcode-app-server-driver.ts 不再输出含 cwd 的 spawn 明文日志；daemon 既有 zcode 相关测试全绿

- zcode 会话 spawn 路径**禁止**输出含用户 cwd 的明文参数日志（现 zcode-app-server-driver.ts:183-185 的真机诊断 `console.log`）；已脱敏的 env 键日志（:187，值经 `redactEnvValueForLog`）**可以**保留；移除后 daemon 既有 zcode 相关测试**必须**全绿（行为无变化，纯日志删除）。

#### 场景：spawn 无明文 cwd 日志

- Given daemon 构建产物
- When 新建任一 zcode 会话触发子进程 spawn
- Then daemon 日志不再出现 `[zcode-driver] spawn:` 条目（cmd/args/cwd 明文），会话创建与运行行为与移除前一致

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：一次性运维脚本无测试面（同 backfill_change_titles.py 先例——脚本层不建测试，写入逻辑由 sandbox 冒烟四步验证：裸跑零写 / --apply 无 --yes 退出码 2 / --apply --yes 落盘 / 幂等复跑 unchanged）
FR-02: sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts「既有 zcode driver 用例全绿（回归面，行为零变化）」
