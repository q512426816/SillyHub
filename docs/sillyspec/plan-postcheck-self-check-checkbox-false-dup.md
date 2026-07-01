# plan-postcheck Contract 校验把自检 checkbox 误解析为 task + reopen 修订崩溃

- 发现时间：2026-07-01
- sillyspec 版本：全局安装（nvm v24.15.0 node_modules/sillyspec）
- 触发场景：`sillyspec run plan --change <变更>` 完成阶段 4/4 时的 Plan→Execute Contract 校验

## 现象

变更 `2026-07-01-collaborative-workspace` plan.md 写完后，step 4 `--done` 时 Contract 校验报：

```
❌ Plan → Execute Contract 校验失败：
   - task id 重复: task-1 出现 2 次
   - task id 重复: task-4 出现 2 次
   - task id 不连续: 期望 task-02, 实际 task-01
```

## 根因

Contract 校验器扫描 plan.md 时，把 **`## 自检` 段里 `- [x]` 开头的行**也当 task 定义行解析，提取其中的 `task-XX` 数字 id。例如：

```markdown
## 自检
- [x] 每个 task 有编号(task-01~12),总数 12(≤15)        ← 提取出 task-1
- [x] 无泛泛风险(转为具体验收条目与 task-04/task-06 等)  ← 提取出 task-4
```

这两个被误提取的 id 与 Wave 下的 `- [ ] task-01:` / `- [ ] task-04:` checkbox 重复，导致「重复」与「不连续」误报。

校验器应只认 Wave 下的 `- [ ] task-XX:` 任务定义行，不应扫自检/其他段的 `- [x]` 行。

## 规避

plan.md 的 `## 自检` 段不要用 `- [x]` checkbox 格式，改用 `✅` 前缀的纯文本，且避免在非 Wave 区出现裸 `task-数字` 模式（写「task-NN」或不写具体编号）。

## 附带：reopen 修订模式崩溃

修好 plan.md 后想用 `sillyspec run plan --reopen --from-step 4 --change <变更>` 重开 step 4 重新触发校验，CLI 直接崩：

```
file:///.../sillyspec/src/stages/plan-postcheck.js:388
    changeDir = resolveChangeDir(cwd, progress, specDir)
                ^
TypeError: resolveChangeDir is not a function
    at executePlanPostcheck (plan-postcheck.js:388:17)
```

修订模式（--reopen --from-step）下 `plan-postcheck.js` 调用未导入的 `resolveChangeDir`，整个 postcheck 无法执行。即修订 plan 阶段 step 4 的路径走不通。

## 附带：libuv assertion

plan 阶段 `--done` 完成后进程退出时偶发：

```
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76
```

Windows 下 Node 事件循环清理 bug，不影响数据（输出在 assertion 之前已写盘），但会以非零退出码结束，可能干扰脚本调用。

## 建议（给 sillyspec 工具方）

1. Contract 校验器：只解析「## Wave N」段下、以 `- [ ] task-XX:` 开头的行作为 task 定义；忽略自检段与其他 `- [x]` / `- [ ]` 非 task 行。
2. plan-postcheck.js:388 修订模式补 `resolveChangeDir` 导入或改用已有解析函数。
3. 排查 Windows 退出时 libuv handle 双关断言。
