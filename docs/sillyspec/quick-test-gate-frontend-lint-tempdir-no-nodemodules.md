# 已解决坑：quick --done 测试门禁在临时目录跑 `next lint` 必败（node_modules 半装 + CNF 硬拦）

- **踩坑日期**：2026-09-23（ql-20260923-003-9b6c，external worker 会话双缺口修复）
- **复核反转日期**：2026-09-23（sillyspec 仓 ql-20260923-022-f7f4 处理时实证复核）
- **状态**：已解决（环境已修复 + 工具侧 CNF 降档已落 sillyspec，待发版生效）

## 现象（原始记录）

`quick` 末步 `--done` 的测试门禁（TEST_GATE）在临时沙箱目录执行质量检查：

```
C:\Users\qinyi\AppData\Local\Temp\sillyspec-gate-03Wvkl\frontend
> next lint
ELIFECYCLE  Command failed with exit code 1.
'next' 不是内部或外部命令，也不是可运行的程序
```

mypy（974 文件）等检查通过，唯独前端 `next lint` 失败——失败原因是
**临时目录里没有 node_modules**（`next` 可执行文件不存在），不是代码问题。

## 复核结论（2026-09-23 反转：沙箱 junction 无罪，真因在主仓环境）

- **junction 机制实证无罪**：把本仓 sillyhub-daemon（健康 pnpm 布局）与修复后的
  frontend node_modules 分别 junction 进临时目录（完全模拟门禁快照手法），
  `pnpm exec tsc` / `pnpm exec next` 均正常解析——健康 pnpm node_modules 经
  junction 跨根可用，本文原「沙箱没有 node_modules」诊断不成立。
- **真因=主仓 frontend/node_modules 半装态**（时间戳 2026-09-23 03:18，疑似一次
  被中断的 pnpm install）：`.pnpm` 虚拟 store 完整，但 `node_modules/.bin` 整个
  缺失、顶层包链接部分悬空（react/next 等指向不存在的目标）。此形态下
  `pnpm exec next` 在**主仓同样失败**——沙箱只是忠实继承了坏环境。
- **坑中坑**：半装态下直接 `pnpm install --frozen-lockfile` 只补链一部分（pnpm
  信任残留的 `.modules.yaml` 状态清单）；彻底修复需删 node_modules 重装。

## 环境修复（已执行）

```bash
cd frontend && rm -rf node_modules && pnpm install --frozen-lockfile
# Done in 11.1s（store 完好，纯本地重链）
```

验证：`node_modules/react/package.json` 可解析、`pnpm exec next --version`
→ Next.js v14.2.5、`pnpm exec eslint --version` → v8.57.0；沙箱 junction 形态
（临时目录 + junction + `pnpm exec next`）复测通过。事后本仓门禁不再需要 skip。

## 工具侧修复（sillyspec 仓 ql-20260923-022-f7f4 / commit 0444a0b0）

对原「期望修复」三选一的落地回应：

1. **实际方案（≈期望 1 的链式命令版）**：门禁共享检查层新增 CNF
   （command-not-found）识别——`'X' 不是内部或外部命令` / `is not recognized` /
   `command not found` / pnpm `Command "X" not found` 四族签名（尾部窗扫描，
   防测试 fixture 噪音误触发），命中且无真实失败面（无可归属文件路径/判账行集
   全 wrapper 噪声）时降档为 **skipped + 响亮修复指引**（「补装依赖后恢复实测」），
   不再硬拦 `--done`。链式命令无需拆分前端段——`&&` 语义保证 CNF 前段全绿。
2. 期望 2（沙箱用仓库本机 node_modules）：即 junction 机制本身，已实证无罪。
3. 期望 3（per-project gate 范围配置）：不采纳——`test_strategy: module` +
   `modules:` 块已提供模块粒度收窄（本仓已配置）。

附带连根修了「乱码一行难归因」：zh-Windows cmd 报错按 GBK 输出、门禁按 utf8
解码成乱码——现改 buffer 捕获 + 智能解码（utf8 无损直通，含替换符时试 GBK），
失败输出恢复可读中文。

## 升级前注意

本机 CLI 升级到含 ql-20260923-022 的版本前，同类场景（环境缺件）仍会硬拦——
处置口径不变：先修环境（见上），确属环境问题且与改动无关时才走
`SILLYSPEC_QUICK_TEST_GATE=skip` 审计留痕。

## 原始绕过记录（踩坑时处置）

改动与前端零交集、真实聚焦测试（99 passed）+ ruff + mypy 均绿的前提下，用
审计留痕通道跳过门禁：

```bash
SILLYSPEC_QUICK_TEST_GATE=skip sillyspec run quick --done --change <id> ...
```
