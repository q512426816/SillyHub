# 动态依赖测试推断把 e2e 用例交给 vitest → 被 exclude 面拦成「No test files found」假红

- 状态：活跃坑（待 sillyspec 工具修复；本轮以 known_failures 豁免过门）
- 发现：2026-09-30，`2026-09-30-breadcrumb-dedupe-zh` flow done 测试门。

## 现象

变更只改了 `frontend/src/components/top-bar.tsx`、变更中心两页与其测试（61 用例全绿
+ `tsc --noEmit` 通过），flow done 测试门的动态子集却判定 FAIL：

```
动态测试子集（缺省）：本变更测试 ∪ FR 关联回归 ∪ import 依赖 = 1 个（deps 1）
命令：cd frontend && pnpm exec vitest run e2e/auth.spec.ts
结果：No test files found, exiting with code 1
```

## 根因

1. `deps(auto-jsx)` 依赖推断把 `frontend/e2e/auth.spec.ts` 选进了本次变更的依赖测试
   批——该文件是 Playwright e2e 用例，与改动的 `top-bar.tsx`/页面文件**零 import
   关联**（为何入选本身可疑，推断启发式待查）；
2. 2026-09-27 R19 修复（见 `finished/2026-09-27-spec-sync-413-and-nested-runtime.md`
   附节）把 Playwright 文件从 `node --test` 分流到项目运行器，于是命令变成
   `pnpm exec vitest run e2e/auth.spec.ts`；
3. 但 frontend 的 vitest 配置 `exclude: ['e2e/**', ...]`——**项目运行器自己就不收
   e2e 目录**，显式传入被排除的文件时 vitest 直接「No test files found」exit 1。

即 R19 修掉了「错误运行器」这一层，漏了「项目运行器 exclude 面」这一层：被项目
测试配置排除的路径根本不该进依赖批。

## 处置（本仓侧）

- `.sillyspec/local.yaml` known_failures 增加正斜杠条目 `frontend/e2e/auth.spec.ts`
  （原反斜杠两条转义残缺且与本形态不匹配，已一并修正为正斜杠）；

## 建议工具侧修复（sillyspec 仓）

- `buildDepsBatches`/依赖推断在把 *.spec/*.test 分流到项目运行器前，读项目 vitest
  配置的 `test.exclude`（或至少硬编码跳过 `e2e/**`、`cypress/**` 这类端到端目录）——
  与项目运行器的收集面取交集，交集为空的文件不进批、不产生命令；
- 顺带复查：`e2e/auth.spec.ts` 为何会被判为 `top-bar.tsx` 等纯 src 改动的「import
  依赖」——e2e 用例不 import src 组件，入选依据存疑。

## 复核条件

sillyspec 发版含上述修复后，删除 local.yaml known_failures 中本组两条 e2e/themes
条目，跑一次涉及 frontend 的 flow done 确认不再产生该命令。
