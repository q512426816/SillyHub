---
author: qinyi
created_at: 2026-08-18T15:37:00
---

# 验证报告 — 工作区文件浏览器（只读）

## 结论: PASS WITH NOTES

## 测试结果

### daemon（sillyhub-daemon）
- **套件**: vitest 全量（含 file-rpc-explorer.test.ts 24 用例 + file-rpc.test.ts 守卫用例）
- **结果**: 2420 passed / 0 failed / 9 skipped（64.47s）
- **覆盖**: realpath 双校验/ symlink 逃逸/ 10MB 截断/ 二进制 base64/ 搜索上限 100/ 噪声排除/ encoding 非法值 forbidden/ POSIX 分隔符

### backend（explorer 模块）
- **套件**: pytest tests/modules/explorer/test_explorer.py
- **结果**: 39 passed / 0 failed（20.92s）
- **覆盖**: containment 拒绝矩阵×10/ 绑定缺失与 daemon_id NULL→404/ RPC 错误映射×8/ download 头与字节往返/ 鉴权 401×4+非成员 403/ search 参数校验

### frontend（explorer 组件+页面）
- **套件**: vitest（file-explorer 14 + file-preview 11 + explorer-page 11）
- **结果**: 36 passed / 0 failed
- **覆盖**: 懒加载/ 搜索防抖/ 祖先链直达/ 代码高亮分发/ Markdown 渲染/ 图片 blob→objectURL/ 二进制元信息卡/ 截断黄条/ 三降级态 502/404/422/ 标签栏「文件」项

## 集成证据

### Runtime Evidence

1. **daemon↔backend RPC 链路实测（task-09，真实 daemon 绑定环境）**:
   - `explorer_search` 以 "README" 全树搜索：16 匹配，耗时 153.48 ms，未触发 truncated
   - `explorer_read_file` 读取 10MB 文件+base64 编码：耗时 11.69 ms，产出 payload 13.98 MB（距 WS 16MiB 上限余量约 2.0 MB）
   - 以上为真实 daemon 宿主机磁盘 IO，非 mock

2. **三降级态触发验证**:
   - daemon 离线→502：backend explorer.service 捕获 WebSocket 连接失败，映射为 ExplorerDaemonOffline(502)
   - 未绑定→404：MemberBindingResolver.resolve_member_binding_or_none 返回 None → ExplorerNotBound(404)
   - 版本过旧→422：daemon 未注册 explorer_* 方法→method_not_found→ExplorerDaemonTooOld(422)
   - 以上均有 backend 单测（FakeHub mock）+ 前端组件测试（mock API error）双重覆盖

3. **安全校验实测（task-03 daemon 测试矩阵）**:
   - junction symlink 逃逸被拒（realpath 落点校验）
   - `../` 路径穿越被拒
   - allowed_roots 双重校验通过

## P2 遗留（不阻断）

| 编号 | 描述 | 原因 |
|---|---|---|
| G-01 | backend download 全链路（backend→WS→daemon→磁盘→base64→StreamingResponse）真实 daemon 绑定环境 smoke 未做 | 本机 backend 跑在 Docker（Linux），daemon 在 Windows 宿主机，Docker 内无法直连 WS 到本机 daemon；需用户本机手动触发 |
| G-02 | Windows bind mount 大仓库（>10k 文件）search 深树遍历耗时尚无实测 | 本仓库约数千文件，153ms 已测；更大仓库待用户验证；已有 60s 超时+结果上限 100 兜底 |
