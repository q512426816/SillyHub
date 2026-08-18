---
schema_version: 1
doc_type: module-card
module_id: local-yaml-writer
author: qinyi
created_at: 2026-08-18 01:45:00
---

# YAML 顶层段替换工具（local-yaml-writer）

## 定位

文本级 YAML 顶层段替换工具（sillyspec 仓 sync.js 的段替换算法 TS 重写，
init-provision-local-yaml change 产物）。定位是「只改指定段、保留文件其余所有
字节」——不用 YAML parser 序列化（那会重排/丢注释）。当前唯一消费方是 spec-sync
的 init lease 流程（handleInitLease 把平台下发的 token 写进项目
`.sillyspec/local.yaml`）。

## 契约摘要

- `findTopLevelSectionRange(text, key): { start, end } | null`——定位顶层段行范围
  （半开区间），不存在返回 null。
- `replaceTopLevelSection(text, key, entries): string`——entries 为 string 时替换
  或追加该段；entries 为 null 时删除该段（不存在则原样返回）。
- `writeLocalYaml(rootPath, local, serverOrigin): Promise<void>`——init 下发写盘
  入口，`local = { platform_token, mcp_token }`。

## 关键逻辑

```
段 = key 行（行首非空白 + 以 "key:" 开头）+ 后续连续缩进行；空行/注释/下一顶层 key 即段结束
writeLocalYaml:
  读原 local.yaml（不存在 → 空串）
  platform 段: 无条件覆盖（url = serverOrigin 去尾斜杠, token = platform_token）
  mcp 段: 仅不存在时写入（url = platformUrl + '/mcp', token = mcp_token；D-004 有才留）
  确保 .sillyspec 目录存在 → 写盘
```

## 注意事项

- **CRLF 兼容机制**：全程 `split('\n')/join('\n')` 操作，CRLF 下 `\r` 留在行尾随行
  原样带过，重组即原样还原——不做行级内容改写，故不破坏 Windows 换行。
- 段不存在时的追加：去尾换行 + 空行分隔 + 新段；空文件直接起段。
- 写失败抛错（不吞），由 handleInitLease 第 4 步 catch 转成 ok:false → lease
  failed，保证 init 失败可见。
- 顶层段判断是文本级（行首非空白 + 前缀匹配 `key:`），key 名需无歧义（如
  `platform` 不会误匹配 `platform_x:`，因匹配的是 `platform:` 完整前缀）。
- 替换语义只认「第一个」匹配段（findTopLevelSectionRange 取首个 start）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
