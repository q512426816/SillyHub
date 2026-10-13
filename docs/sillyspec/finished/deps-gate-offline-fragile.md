# 跨仓 worktree deps 门控离线脆弱（npm ci 必败→手工改 meta.json 绕过）

> 记录时间：2026-10-12 · 来源变更：2026-10-12-session-defects（生产实证：平台会话 47e2ff1a）
> 状态：活跃坑（高风险手工绕过，待工具修复）

## 现象

execute 阶段 deps 门控在跨仓 worktree 准备依赖时：
1. 对前端仓 worktree 跑 `npm ci`（registry.npmjs.org 不可达的离线/内网环境）必败，
   `depsStatus=failed` 卡死 execute deps 门；
2. 主副本 node_modules 已存在时，快路径「链接主仓 node_modules」又因 lockfile 有
   本地改动（M 状态，hash 与 worktree HEAD 版不一致）判定失效，回退 npm ci 再次失败；
3. maven 仓被同一套 npm 探测误判（`mvn -o test` 作为 install 探测，离线必败且过重）。

生产实证：会话 47e2ff1a 10-10 05:35-05:41，主代理最终**手工把跨仓 meta.json 的
depsStatus 改成 `linked`** 才放行——对平台内部状态文件做手术，高风险且无留痕机制。

## 根因

- 探测顺序硬编码「先 npm ci，失败也不回退链接」；链接快路径以 lockfile hash 一致
  为前提，但「主副本 lockfile 有本地改动」是常见态（安装后 pnpm 修正），hash 永不
  一致 → 快路径形同虚设；
- 离线环境无探测出口（没有「npm ping 失败→直接尝试链接」的降级链）；
- depsStatus 是持久状态且没有 CLI 重供/覆写命令（agent 只能手改 JSON）。

## 影响

- 离线/内网环境 worktree 准备被阻断，execute 无法开始；
- 手工改 meta.json 绕过属于未定义行为，状态文件 schema 变更即碎；
- 每次回退全量 ci 在大仓上以分钟计，拖慢每个变更。

## 绕过

手工把跨仓 worktree 的 `meta.json` 中 depsStatus 改为事实值 `linked`
（前提：主副本 node_modules 确实存在且可用，链接已手工建立）。**必须留痕**：
在变更 decisions.md 或任务卡注明「deps 门控手工放行」，供 verify/archive 对账。

## 期望修复

1. 探测链改为：`npm ping`/缓存命中判断离线 → 离线时直接尝试链接主仓 node_modules
   （忽略 lockfile hash 差异，仅警告）；在线时才走 ci；
2. 提供 CLI 命令显式重供/覆写 depsStatus（如 `sillyspec worktree deps --set linked
   --reason "..."`），留审计痕，杜绝手改 JSON；
3. install 探测按生态分派（maven 仓不跑 npm/mvn test，改用轻量存在性检查）。

## 处置记录（2026-10-13）

**分项处置**（坑内三建议）：

- **③ maven 误判 ✅ 已修**（`5d09e057` 2026-10-10-cross-worktree-toolchain）：JVM 生态
  供给判 n/a（旧默认 `mvn -o test` 把跑测试当供给的病灶已除，源码注释实证）。
- **② CLI 覆写通道 ✅ 本轮修**（sillyspec 工作树）：`sillyspec worktree deps --change <名>
  --set <n/a|linked|installed|failed> --reason "<事实依据>"`——合法值收敛认知集、
  --reason 强制留痕（meta.json 落 depsOverrideNote 含前值 + depsOverrideAt）、
  verify/archive 对账以覆写注为审计锚；缺 reason/非法值 exit 2、跨仓 meta 缺失给
  --spec-dir 指引。测试 `worktree-deps-override.test.mjs` 3/3 + 回归 24 绿。
- **① 离线降级链（npm ping → 链接容忍）**：**延后**——探测顺序重构触及供给引擎决策主链
  （provisionDeps 快路径/兜底语义），离线判定本身有误判面（npm ping 不通≠装不上缓存包），
  设计级另立变更；②的覆写通道已把「手改 JSON」的未定义行为收口为留痕通道，绕过风险
  面收敛。

归档（①留设计 backlog）。
