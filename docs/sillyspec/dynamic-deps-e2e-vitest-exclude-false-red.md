# 动态依赖测试推断把 e2e 用例交给 vitest → 被 exclude 面拦成「No test files found」假红

- 状态：活跃坑（待 sillyspec 工具修复；本仓已用注释改写绕开触发）
- 发现：2026-09-30，`2026-09-30-breadcrumb-dedupe-zh` flow done 测试门。

## 现象

变更只改了 `frontend/src/components/top-bar.tsx`、变更中心两页与其测试（61 用例全绿
+ `tsc --noEmit` 通过），flow done 测试门的动态子集却判定 FAIL：

```
动态测试子集（缺省）：本变更测试 ∪ FR 关联回归 ∪ import 依赖 = 1 个（deps 1）
命令：cd frontend && pnpm exec vitest run e2e/auth.spec.ts
结果：No test files found, exiting with code 1
```

且该形态**无法用 known_failures 豁免**：`judgeWithKnownFailures` 是 fail-safe 设计——
exit≠0 且输出里检测不到失败行（×/FAIL 等）时保守判 failed，豁免模式只作用于已检出
的失败行。

## 根因（已核实，三层）

1. **依赖误判（路 A：注释裸子串）**：`verify-postcheck.js` 的 `discoverModuleDependentTests`
   用裸子串 `content.includes(src)` 判「测试文件依赖变更源文件」——`frontend/e2e/auth.spec.ts`
   的**注释**里字面引用了完整路径 `frontend/src/components/top-bar.tsx`（表单结构
   事实的出处标注），注释引用被误判成 import 依赖（该 e2e 用例根本不 import top-bar）。
2. **运行器 exclude 面不对齐**：2026-09-27 R19 修复把 Playwright 文件从 `node --test`
   分流到项目运行器，命令变成 `pnpm exec vitest run e2e/auth.spec.ts`；但 frontend 的
   vitest 配置 `exclude: ['e2e/**', ...]`——项目运行器自己就不收 e2e 目录，显式传入
   被排除的文件时 vitest 直接「No test files found」exit 1。
3. **依赖误判（路 B：变更测试文件直入）**：同函数把「本次变更的测试文件」直接加进依赖
   面（`changedTests` 循环），而 `isTestFilePath` 正则 `\.(test|spec)\.[cm]?(js|ts)$`
   认 `.spec.ts` 不认 `.test.tsx`——于是改 `e2e/auth.spec.ts`（哪怕只改注释）它自己
   进依赖面，而真正的 `__tests__/*.test.tsx` 反而不进。两条路殊途同归：只要本次变更
   与 e2e 有任何交集（或 e2e 注释引用了变更源文件路径），该命令必然产生且必然 exit 1。

且该形态**无法用 known_failures 豁免**：`judgeWithKnownFailures` 是 fail-safe 设计——
exit≠0 且输出里检测不到失败行（×/FAIL 等）时保守判 failed，豁免模式只作用于已检出
的失败行。

## 本仓处置（2026-09-30）

- `frontend/vitest.config.ts` 加 `passWithNoTests: true`：被 exclude 的文件被显式
  过滤时 exit 0 而非 1（治假红的兜底；正常全量/CI 恒有文件命中，零影响）。
- `frontend/e2e/auth.spec.ts:19` 注释改写：完整路径字面量改为「顶栏 top-bar 组件，
  components/top-bar」（文档价值保留，去掉路 A 的裸子串触发面，后续改 top-bar.tsx
  不再因注释引用误入依赖面）。不改任何断言/逻辑。
- known_failures 不动（对无失败行形态无效，加了反而可能吞真实失败行）。

## 建议工具侧修复（sillyspec 仓，需用户授权后动手）

- `discoverModuleDependentTests`：依赖命中改为**只看 import/require 语句**（或至少
  剥注释后再匹配）——注释里的路径引用不该算依赖边；
- `isTestFilePath` 正则补 `tsx|jsx`（`.test.tsx`/`.spec.jsx` 现在不算测试文件，自家
  单测反而不进依赖面）；
- `buildDepsBatches` jsProject 分支：进项目运行器前过滤项目测试配置 exclude 的目录
  （至少硬编码跳过 `e2e/**`、`cypress/**` 端到端目录）——与运行器收集面取交集，
  交集为空不产命令。

## 复核条件

sillyspec 发版含上述任一修复后，改一次 `frontend/src/components/top-bar.tsx`（或任何
被 e2e 注释引用的源文件）跑 flow done，确认依赖批不再产生
`vitest run e2e/auth.spec.ts` 命令。
