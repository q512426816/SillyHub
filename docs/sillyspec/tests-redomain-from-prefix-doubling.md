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

活跃坑（sillyspec 3.32.0 实测）。
