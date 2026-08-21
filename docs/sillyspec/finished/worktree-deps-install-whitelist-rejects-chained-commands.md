# worktree deps 供给白名单拒绝链式 install 命令 → depsStatus=failed 卡死 execute — 已修复

- 发现日期：2026-08-20（变更 2026-08-20-runtime-readpoint-repo-first execute Step1）
- 状态：已修复（工具仓 commit `f191fc4`，随 3.26.13 发布）：`tryInstall` 按 `&&` 拆段逐段过白名单 + 元字符门，段内允许 `cd <相对子路径>`（resolve 后限 worktree 根内防越界），argv 执行不经 shell——建议方案 1 落地，`doctor --fix` 重放 provision 亦随之可自愈。测试 `worktree-install-chain.test.mjs` 9/9（本机 2026-08-21 实跑通过）。建议 2（--deps-manual 逃生口）/建议 3（postinstall 生成物）未做，属次要便利项，如再现再立新条目

## 现象

`local.yaml` 的 `commands.install` 若是 `cd` 链式命令（monorepo 多子项目常见写法，如
`cd backend && uv sync --all-extras && cd ../frontend && pnpm install && ...`），worktree
依赖供给（`provisionDeps` → `tryInstall`）整条拒绝执行：

```
install 命令不在包管理器白名单内，拒绝执行: cd backend && uv sync ...
```

且该失败写进 worktree meta 的 `depsStatus=failed`（doctor 分类最高优先级）——即使依赖
实际已手动装好，execute 每步 `--done` 仍被 deps 门控阻断，`worktree doctor --fix` 只是
重放被拒的 provision，**无法自愈**。

## 根因

`sillyspec/src/worktree-deps.js` 的 `INSTALL_BINARY_WHITELIST` 只放行以包管理器
**开头**的命令（pnpm/npm/uv/make/...），`cd xxx && <pkg-mgr>` 以 `cd` 开头整条被拒。

## 绕过方案（本仓 local.yaml 已改）

install 命令改写为白名单形态的单命令 + 依赖工具自带的模块 link：

```yaml
install: "uv sync --all-extras --project backend"
```

- backend 用 `uv --project <dir>` 子目录形态（uv 原生支持，免 cd）；
- frontend/sillyhub-daemon 的 node_modules 由 `provisionDeps` 第 2 段「modules 块
  nodejs 子模块 link」自动 junction 主仓（lockfile 一致时），无需 pnpm install；
- 附带坑：worktree 是干净 checkout，gitignored 的生成文件（如 sillyhub-daemon 的
  `src/build-id.ts`，postinstall 生成）不存在会导致 vitest 加载 daemon.ts 失败，
  需手动 `node scripts/gen-build-id.mjs` 补生成一次。

## 建议工具改进（sillyspec 仓）

1. 白名单判定放宽：对 `cd <安全路径> && <白名单命令>` 链，逐段校验每段命令是否
   白名单开头（`cd` 段限定相对路径无元字符），而非只看首段；
2. 或 provision 失败时允许 `sillyspec worktree doctor --fix --deps-manual` 类显式
   「已手动安装，标记 installed」逃生口，避免 failed 状态永久卡死；
3. worktree create 时顺带跑各子项目 postinstall 生成脚本（或把 gitignored 生成物
   清单化提示），减少「干净 checkout 缺生成文件」的连环坑。
