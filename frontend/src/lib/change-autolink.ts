/**
 * 变更名自动链接（2026-08-31 变更关联审计 P3）：变更文档 markdown 渲染时，
 * 把正文里提名的变更名（`2026-NN-NN-<slug>`）自动变成指向变更详情页的可点击
 * 链接——写文档的人零成本，文档成网。
 *
 * 背景：CLI 仓实测变更间关联的真实形态是散文提名（模块卡/design/proposal 里
 * "继 <变更名> 之后…"），无声明式字段；平台持有全量 change_key，渲染侧即可
 * 完成"提名 → 导航"的最后一跳。链接走详情页 id 直链（归档变更详情页同样
 * 可达；`?search=` 方案在 active tab 搜不到归档名，有 tab 盲区，勿用）。
 *
 * 名单口径与排除面对齐 CLI 仓 docs-check 的 collectChangeNameTokens（两侧同款
 * 语义，防平台链到的名字 CLI 校验不过、CLI 校验过的名字平台不链）：
 *   - x- 前缀化合物不拆半名（review-2026-08-08.md / run-id 时间戳）；
 *   - 紧随 `.md` 的 token 是文件名提及不是变更目录提名；
 *   - ql-* quicklog id 非变更目录名，不链。
 * 边界检查用代码判断而非 regex lookbehind：lookbehind 字面量会让旧 Safari
 * （<16.4）在模块加载期直接 SyntaxError。
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "./query-keys";
import { listChanges } from "./changes";

/** 变更名 token：日期前缀 + 字母开头 slug（≥3 字符，小写——真实变更名全小写） */
const CHANGE_NAME_RE = /\d{4}-\d{2}-\d{2}-[a-z][a-z0-9-]{2,}/g;

/** 该位置往前一个字符是否为名字组成字符（是 = 化合物前缀，非独立提名） */
function precededByNameChar(text: string, index: number): boolean {
  if (index <= 0) return false;
  const prev = text[index - 1];
  return prev !== undefined && /[A-Za-z0-9-]/.test(prev);
}

/**
 * 把文本按变更名提名切段：命中名单的段标记为链接，其余为纯文本。
 * 精确整名命中 Map 才链（`2026-08-07-foo-bar` 不会误命中 Map 里的
 * `2026-08-07-foo`，反之亦然）。
 */
export function splitByChangeNames(
  text: string,
  nameToId: Map<string, string>,
): Array<{ value: string; changeId?: string }> {
  if (!text || nameToId.size === 0) return [{ value: text }];
  const out: Array<{ value: string; changeId?: string }> = [];
  let last = 0;
  for (const m of text.matchAll(CHANGE_NAME_RE)) {
    const end = (m.index ?? 0) + m[0].length;
    if (precededByNameChar(text, m.index ?? 0)) continue;
    if (text.slice(end, end + 3).toLowerCase() === ".md") continue;
    const id = nameToId.get(m[0]);
    if (!id) continue;
    if (end - m[0].length > last) out.push({ value: text.slice(last, end - m[0].length) });
    out.push({ value: m[0], changeId: id });
    last = end;
  }
  if (last < text.length) out.push({ value: text.slice(last) });
  return out;
}

// mdast 最小节点形态（remark 插件操作用；不引 unist 依赖也不引 unist-util-visit
// ——手写递归足够，且避免为单用途加运行时依赖）
type MdastNode = {
  type?: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
};

/**
 * 递归把 parent.children 里的 text 节点替换为 text/link 混排。
 * 只处理 children 里的 text 节点：inlineCode/code 的值在自身 .value 上、无
 * children，天然跳过（代码块里的变更名不链）；link 子树不再进入（已是链接的
 * 文本不二次包装）。
 */
function linkifyTree(node: MdastNode, nameToId: Map<string, string>, workspaceId: string) {
  if (!Array.isArray(node.children)) return;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (!child) continue;
    if (child.type === "text" && typeof child.value === "string") {
      const segs = splitByChangeNames(child.value, nameToId);
      const hasLink = segs.some((s) => s.changeId);
      if (!hasLink) continue;
      const replacement: MdastNode[] = [];
      for (const s of segs) {
        if (s.changeId) {
          replacement.push({
            type: "link",
            url: `/workspaces/${workspaceId}/changes/${s.changeId}`,
            children: [{ type: "text", value: s.value }],
          });
        } else if (s.value) {
          replacement.push({ type: "text", value: s.value });
        }
      }
      node.children.splice(i, 1, ...replacement);
      i += replacement.length - 1;
    } else if (child.type !== "link" && child.type !== "linkReference" && child.children) {
      // link/linkReference 子树不进入：其内文本再包装会产生嵌套 <a>（非法 HTML）
      linkifyTree(child, nameToId, workspaceId);
    }
  }
}

/**
 * remark 插件工厂：`remarkPlugins={[[remarkChangeLink, { nameToId, workspaceId }]]}`。
 * 插件在 mdast 层变换（rehype-sanitize 之前的 remark 阶段），自产 link 节点
 * 的相对 href 可过 sanitize 协议白名单。
 *
 * unified 契约：Plugin(options) 直接返回 transformer（tree, file）=> undefined，
 * 原地改树。注意不能多包一层（ql-20260903-006：双层箭头让 transformer 返回
 * 内层函数，被 unified 当成替换树，整篇文档被换成函数、.md 预览渲染崩溃）。
 */
export function remarkChangeLink(options: { nameToId: Map<string, string>; workspaceId: string }) {
  const { nameToId, workspaceId } = options;
  return (tree: MdastNode) => {
    linkifyTree(tree, nameToId, workspaceId);
  };
}

/**
 * workspace 变更名 → id 索引（active + archive 各一页，page_size 200；超过
 * 200 个变更的 workspace 尾页不链——advisory 性质的体验增强，不做翻页拉全量）。
 * location 不传则后端不过滤会含 deleted 墓碑行，故分两次拉并显式过滤。
 * staleTime 5 分钟（对齐 session-mention-sources 供数惯例）。
 */
export function useChangeNameIndex(workspaceId: string | null | undefined): Map<string, string> {
  const enabled = !!workspaceId;
  const active = useQuery({
    queryKey: queryKeys.changeAutolink.list(workspaceId ?? "", "active"),
    queryFn: () => listChanges(workspaceId!, { location: "active", pageSize: 200 }),
    enabled,
    staleTime: 5 * 60_000,
  });
  const archive = useQuery({
    queryKey: queryKeys.changeAutolink.list(workspaceId ?? "", "archive"),
    queryFn: () => listChanges(workspaceId!, { location: "archive", pageSize: 200 }),
    enabled,
    staleTime: 5 * 60_000,
  });
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const resp of [active.data, archive.data]) {
      for (const item of resp?.items ?? []) {
        if (item.location !== "deleted" && item.change_key) map.set(item.change_key, item.id);
      }
    }
    return map;
  }, [active.data, archive.data]);
}
