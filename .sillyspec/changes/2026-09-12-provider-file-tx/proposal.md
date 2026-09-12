---
author: qinyi
created_at: 2026-09-12 03:10:26
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机

1e4bb818f 把会话内供应商切换扩展到 codex/pi 时引入了 per-session 文件层（`CODEX_HOME`/`PI_CODING_AGENT_DIR` 目录写凭证配置）。24h 只读审查（M-7）实证该文件层与 reload 事务性脱节：切换失败后目录凭证与内存态分叉、写盘非原子可留半截文件、重启恢复以「目录存在」为切换生效信号可被迁移钩子假阳性击穿。本变更把文件层纳入 reload 事务边界。

## 关键问题

1. **回滚窗口用错凭证（F1）**：文件写盘先于 resume 守卫与 driver.start，失败回滚只还原内存态——窗口内 codex 重读 `auth.json`（token 刷新）会用错供应商凭证。
2. **崩溃留半截配置（F2）**：六写盘点裸 writeFile，`config.toml` 截断后保守合并持续产出非法 TOML，直至目录终态清理才自愈。
3. **恢复误判丢轮次（F3）**：迁移钩子只建目录即可命中 restore 探测，叠加一次写盘 IO 失败 → 重启 resume 回退过期快照，失败切换后落在宿主的轮次静默丢失。

## 变更范围

sillyhub-daemon：新增 `atomic-write.ts`；`codex-settings.ts`/`pi-settings.ts` 六写盘点原子化；`provider-file-settings.ts` 落 `.sillyhub-managed` 生效标记（null 分支标记先行）；`session-manager.ts` reload 守卫前移 + catch 文件层回滚 + provider 维度引擎门；`persistence.ts` restore 探测三态化（标记/legacy/零动作）。详见 design.md 文件变更清单。

## 不在范围内（显式清单）

- 不做 staging 目录两阶段交换（方案 B 已否决）
- 不改 ForReload 兜底矩阵五分支语义（只增标记写入副作用）
- 不清理 pi null 切换的留存文件（惰性无害，终态清理归会话收尾）
- 不处理 OS 断电级持久性（fsync 之上语义）
- 不改会话生命周期状态机（ended/failed 转移、inputQueue、consume 零改动）

## 成功标准（可验证）

- reload 失败（driver.start 注入失败）后 per-session 目录内容回到旧供应商形态（或 codex-null 宿主镜像形态），测试断言
- 缺 resume key 的 reload 在文件写盘前拒绝，目录零写入（tmp/目标均无）
- 任一写盘点失败时目标文件保持旧全文，无 `.tmp-*` 残留
- restore：仅迁移目录（无标记无 auth/config）→ 零动作；标记在 → managed；无标记有 auth/config（legacy）→ managed
- cursor 会话 provider 切换请求显式失败（fail-loud），其配置维度 reload 行为不变
