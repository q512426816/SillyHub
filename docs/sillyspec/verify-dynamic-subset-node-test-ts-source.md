# verify 动态测试子集把 TS 源码归入 node --test 批跑出伪败

- **发现日**:2026-10-10
- **变更**:2026-10-10-repo-native-no-platform-markers（flow done 实测门）
- **状态**:活跃坑（工具缺陷，待 sillyspec 修复）

## 现象

flow done 实测门（动态测试子集）把 `sillyhub-daemon/src/spec-sync.ts`（**TS 源码**，
非测试文件）归入 `deps(auto-js)` 批并用 `node --test` 执行——node 24 直接跑 .ts 源码
import 链（`./config.js` ESM 后缀解析）必然 `ERR_MODULE_NOT_FOUND`，TAP 输出失败行：

```
not ok 1 - sillyhub-daemon\src\spec-sync.ts
```

整单实测 FAIL，中断于 ledger 子步。而该文件在 sillyhub-daemon 的 vitest 套件中
（tests/test_init_lease.test.ts 31/31 全绿）真实覆盖，伪败与代码质量无关。

## 根因

动态子集的 import 依赖推断（2026-09-26-dynamic-test-inference）把测试文件 import 的
**源码文件**也计进"要跑的测试面"；runner 按"最近 package.json"推断运行器时，
`sillyhub-daemon/src/*.ts`（无 `.test.` 后缀）被判给 `node --test` 批（auto-js）而非
vitest（auto-jsx）。node --test 对 TS 源码是必然失败的错误运行器。

对照：同批 `deps(auto-jsx)` 5 个 .test.ts 文件正确走 vitest 全绿；唯一 auto-js 条目
恰是那个被误判的源码文件。

## 绕过（当前 local.yaml known_failures 已加锚定条目）

```yaml
- '^not ok 1 - sillyhub-daemon\\src\\spec-sync\.ts$'
```

锚定式（`^…$`）整行匹配，不掩盖 spec-sync 相关 vitest 套件的真实失败（那些失败行
带测试名/断言详情，不匹配本锚定）。

## 修复建议（工具侧）

1. 动态子集的 import 依赖面只应产生**测试文件**候选；源码依赖应作为「测试文件的选择
   依据」（import 了它的测试要跑），而不是自身进 runner 面。
2. 或 runner 推断兜底：无 `.test.`/`_test`/`test_` 后缀的文件不进 node --test 批
   （node --test 语义是「文件即测试」）。

## 复核条件

sillyspec 发版修复动态子集推断后，删除 local.yaml 该锚定条目与本文件（移 finished/）。
