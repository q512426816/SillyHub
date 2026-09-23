# 活跃坑：quick --done 测试门禁在临时目录跑 `next lint` 必败（无 node_modules）

- **踩坑日期**：2026-09-23（ql-20260923-003-9b6c，external worker 会话双缺口修复）
- **状态**：活跃，待 sillyspec 工具修复

## 现象

`quick` 末步 `--done` 的测试门禁（TEST_GATE）在临时沙箱目录执行质量检查：

```
C:\Users\qinyi\AppData\Local\Temp\sillyspec-gate-03Wvkl\frontend
> next lint
ELIFECYCLE  Command failed with exit code 1.
'next' 不是内部或外部命令，也不是可运行的程序
```

mypy（974 文件）等检查通过，唯独前端 `next lint` 失败——失败原因是
**临时目录里没有 node_modules**（`next` 可执行文件不存在），不是代码问题。

## 影响

- 纯 backend / 文档类 quick 改动也会被前端 lint 拦死，`--done` 无法收尾；
- 失败信息只有 Windows 控制乱码的一行「'next' 不是内部或外部命令」，初次
  接触者容易误判为前端代码坏了。

## 期望修复（sillyspec CLI 侧）

任选其一：

1. 门禁跑前端检查前检测 `<沙箱>/frontend/node_modules` 是否存在（或 `.bin/next`
   是否可执行），不存在则跳过前端 lint 并在输出标注「跳过原因：沙箱无
   node_modules」，而非任其 `next: command not found` 失败；
2. 或在沙箱里用**仓库本机** node_modules 跑（`pnpm --dir <仓库>/frontend lint`），
   不依赖临时目录副本；
3. 或提供 per-project 配置项（如 `.sillyspec/config` 里声明 gate 范围），允许
  纯 backend quick 不跑前端 lint。

## 当前绕过（踩坑时的处置）

改动与前端零交集、真实聚焦测试（99 passed）+ ruff + mypy 均绿的前提下，用
审计留痕通道跳过门禁：

```bash
SILLYSPEC_QUICK_TEST_GATE=skip sillyspec run quick --done --change <id> ...
```

（skip 会在 QUICKLOG/审计留痕，不是静默跳过；仅在门禁失败原因确系沙箱环境、
非代码问题时使用。）
