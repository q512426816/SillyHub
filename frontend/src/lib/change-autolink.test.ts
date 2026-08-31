/**
 * 变更名自动链接纯逻辑测试（2026-08-31 变更关联审计 P3）。
 *
 * 覆盖 splitByChangeNames 的排除面（与 CLI 仓 docs-check collectChangeNameTokens
 * 同口径：化合物前缀 / .md 文件名 / 精确整名命中）与 remarkChangeLink 的 mdast
 * 变换（text 节点拆链 / code 与 inlineCode 不动 / 已有 link 不二次包装）。
 */
import { describe, expect, it } from "vitest";

import { remarkChangeLink, splitByChangeNames } from "./change-autolink";

const MAP = new Map([
  ["2026-08-01-alpha", "id-alpha"],
  ["2026-08-07-foo-bar", "id-foobar"],
]);

describe("splitByChangeNames 切段", () => {
  it("命中名单的提名切段为链接段", () => {
    expect(splitByChangeNames("继 2026-08-01-alpha 之后又改", MAP)).toEqual([
      { value: "继 " },
      { value: "2026-08-01-alpha", changeId: "id-alpha" },
      { value: " 之后又改" },
    ]);
  });

  it("x- 前缀化合物不拆半名（评审快照文件名 / run-id 时间戳）", () => {
    expect(splitByChangeNames("review-2026-08-01-alpha.md 见 brainstorm-review-2026-08-23-205426", MAP)).toEqual([
      { value: "review-2026-08-01-alpha.md 见 brainstorm-review-2026-08-23-205426" },
    ]);
  });

  it("紧随 .md 的 token 是文件名提及，不链", () => {
    expect(splitByChangeNames("plans/2026-08-01-alpha.md 已删", MAP)).toEqual([
      { value: "plans/2026-08-01-alpha.md 已删" },
    ]);
  });

  it("精确整名命中：长名不误吃短名的前缀", () => {
    expect(splitByChangeNames("对比 2026-08-07-foo 与 2026-08-07-foo-bar", MAP)).toEqual([
      { value: "对比 2026-08-07-foo 与 " },
      { value: "2026-08-07-foo-bar", changeId: "id-foobar" },
    ]);
  });

  it("名单外提名与空名单：原样透传", () => {
    expect(splitByChangeNames("提到 2026-99-99-unknown", MAP)).toEqual([{ value: "提到 2026-99-99-unknown" }]);
    expect(splitByChangeNames("继 2026-08-01-alpha", new Map())).toEqual([{ value: "继 2026-08-01-alpha" }]);
  });
});

describe("remarkChangeLink mdast 变换", () => {
  const run = (tree: object) => {
    const plugin = remarkChangeLink({ nameToId: MAP, workspaceId: "ws-1" });
    // remark 插件两层调用：Plugin(options)(...args)(tree, file) —— @uiw 管线同款
    (plugin as unknown as (...a: unknown[]) => (t: unknown) => void)()(tree);
    return tree;
  };

  it("段落 text 节点拆为 text/link/text 混排，url 为详情页 id 直链", () => {
    const tree = {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", value: "继 2026-08-01-alpha 之后" }] },
      ],
    };
    run(tree);
    expect(tree).toEqual({
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", value: "继 " },
            { type: "link", url: "/workspaces/ws-1/changes/id-alpha", children: [{ type: "text", value: "2026-08-01-alpha" }] },
            { type: "text", value: " 之后" },
          ],
        },
      ],
    });
  });

  it("代码块（value 无 children）与行内代码不链", () => {
    const tree = {
      type: "root",
      children: [
        { type: "code", value: "run archive --change 2026-08-01-alpha" },
        { type: "paragraph", children: [{ type: "inlineCode", value: "2026-08-01-alpha" }] },
      ],
    };
    const snapshot = JSON.stringify(tree);
    run(tree);
    expect(JSON.stringify(tree)).toBe(snapshot);
  });

  it("已是 link 子树的文本不二次包装", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "link",
          url: "https://example.com",
          children: [{ type: "text", value: "看 2026-08-01-alpha" }],
        },
      ],
    };
    const snapshot = JSON.stringify(tree);
    run(tree);
    expect(JSON.stringify(tree)).toBe(snapshot);
  });
});
