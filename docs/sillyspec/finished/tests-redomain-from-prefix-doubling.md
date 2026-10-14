# tests --redomain --from 域名含路径前缀时自拼出 fr/fr/ 双前缀（2026-10-14）

## 现象

`flow done` 收口输出 FR 域路由降级时给出的迁移命令示例为：

```
sillyspec tests --redomain --from fr/auto-backend --to agent --by-change <本变更名> --write
```

照抄执行报错：

```
❌ 域迁移被拒：源域文件不存在：fr/fr/auto-backend.md
```

工具把 `--from` 值再拼一层 `fr/` 前缀（`fr/` + `fr/auto-backend.md`），与它自己提示的命令形态自相矛盾。

## 影响

- 照抄工具输出命令必失败（误导）；无数据损坏（fail-fast 拒绝，不写盘）。
- 正确用法是 `--from` 只给域名不带 `fr/` 前缀：

```
sillyspec tests --redomain --from auto-backend --to agent --by-change <本变更名> --write
```

（2026-10-14-agent-profile-express-preset 实测成功：5 条 FR 迁入 `fr/agent.md`，ID 不变，INDEX 路由行已补。）

## 建议

工具二选一修复：要么 `--from` 规范化为纯域名（容忍带 `fr/` 前缀的输入，剥掉再拼），要么修正 `flow done` 输出的示例命令去掉前缀。

## 状态

✅ **已修复（2026-10-14）**——sillyspec 仓轻量变更 `2026-10-14-redomain-domain-arg-normalize`（证据提交 sillyspec@309184f5）：
- `src/redomain.js` 新增导出 `normalizeDomainArg`（trim + 剥前导 `fr/`（大小写不敏感）+ 剥尾随 `.md`，幂等），`redomainFrEntries`/`planRedomain` 入参防御性归一，剥空拒绝不落盘；
- CLI `tests --redomain` 同源归一，回显/报错统一裸域名，用法行补形态说明；flow done 提示语的 `fr/` 前缀形态自此合法，照抄不再失败；
- 测试：`test/redomain.test.mjs` 新增 ⑥⑦ 用例 7/7 绿；全量 `npm test` 779 文件 EXIT=0、`npm run lint` 970 文件 EXIT=0；
- 真实仓实测：`--from fr/agent` 形态干跑/落盘均正常（本仓 `fr/agent.md` 迁移已用裸名形态完成，属同口径）。

