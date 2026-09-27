"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChangeDetailView = ChangeDetailView;
const jsx_runtime_1 = require("react/jsx-runtime");
/**
 * prototype-as-code 演示视图 —— 变更详情（GitHub PR 式）。
 * 真实 primer 组件（PageHead/StateLabel/Timeline/MetaPanel/StateIcon）+
 * Tailwind + themes.ts token，fixture 数据；build.mjs 编译为独立 HTML。
 */
const React = __importStar(require("react"));
const primer_1 = require("../primer");
const demo_chrome_1 = require("./demo-chrome");
const STAGES = [
    { name: "头脑风暴", state: "done" },
    { name: "方案设计", state: "done" },
    { name: "执行", state: "current" },
    { name: "验证", state: "pending" },
    { name: "归档", state: "pending" },
];
function ChecksBar() {
    return ((0, jsx_runtime_1.jsx)("div", { className: "mt-6 flex items-center gap-1 overflow-x-auto rounded-lg border px-3 py-2.5", style: { borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--card))" }, children: STAGES.map((s, i) => {
            const color = s.state === "done"
                ? "hsl(var(--success))"
                : s.state === "current"
                    ? "var(--color-brand-600)"
                    : "hsl(var(--muted-foreground))";
            return ((0, jsx_runtime_1.jsxs)(React.Fragment, { children: [i > 0 && ((0, jsx_runtime_1.jsx)("span", { className: "mx-1 h-px w-6 flex-shrink-0", style: { backgroundColor: "hsl(var(--border))" } })), (0, jsx_runtime_1.jsxs)("span", { className: "flex flex-shrink-0 items-center gap-1.5 text-sm", style: { color }, children: [(0, jsx_runtime_1.jsx)(primer_1.StateIcon, { name: s.state === "done" ? "check" : s.state === "current" ? "openCircle" : "clock", size: 14 }), (0, jsx_runtime_1.jsx)("span", { className: s.state === "current" ? "font-semibold" : "", children: s.name }), s.state === "current" && (0, jsx_runtime_1.jsx)("span", { className: "text-xs text-muted-foreground", children: "6/13" })] })] }, s.name));
        }) }));
}
function MetaRow({ k, v }) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "flex items-center justify-between gap-3 text-xs", children: [(0, jsx_runtime_1.jsx)("span", { className: "text-muted-foreground", children: k }), (0, jsx_runtime_1.jsx)("span", { className: "min-w-0 truncate text-right", children: v })] }));
}
function ChangeDetailView() {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "min-h-screen bg-background text-foreground", children: [(0, jsx_runtime_1.jsx)(demo_chrome_1.DemoBar, {}), (0, jsx_runtime_1.jsxs)("main", { className: "mx-auto max-w-5xl px-6 py-8", children: [(0, jsx_runtime_1.jsx)(primer_1.PageHead, { breadcrumb: (0, jsx_runtime_1.jsxs)("span", { className: "flex items-center gap-1.5", children: [(0, jsx_runtime_1.jsx)("span", { children: "SillyHub" }), (0, jsx_runtime_1.jsx)("span", { className: "text-muted-foreground/60", children: "/" }), (0, jsx_runtime_1.jsx)("span", { children: "multi-agent-platform" }), (0, jsx_runtime_1.jsx)("span", { className: "text-muted-foreground/60", children: "/" }), (0, jsx_runtime_1.jsx)("span", { children: "\u53D8\u66F4" }), (0, jsx_runtime_1.jsx)("span", { className: "text-muted-foreground/60", children: "/" }), (0, jsx_runtime_1.jsx)("span", { className: "text-foreground", children: "\u89C2\u6D4B\u4E8B\u4EF6\u901A\u9053 v3" })] }), title: "\u89C2\u6D4B\u4E8B\u4EF6\u901A\u9053 v3 \u00B7 \u91CD\u6784", titleExtra: (0, jsx_runtime_1.jsx)(primer_1.StateLabel, { variant: "open", size: "md", children: "\u8FDB\u884C\u4E2D" }), subtitle: (0, jsx_runtime_1.jsx)("span", { className: "font-mono", children: "2026-09-25-observation-events-v3-r16sf \u00B7 \u521B\u5EFA\u4E8E 09-25 14:02" }), actions: (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("button", { type: "button", className: "h-8 rounded-md border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted", style: { borderColor: "hsl(var(--border))" }, children: "\u5F52\u6863" }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90", children: "\u7EE7\u7EED\u6267\u884C" })] }) }), (0, jsx_runtime_1.jsx)(ChecksBar, {}), (0, jsx_runtime_1.jsxs)("div", { className: "mt-6 flex gap-6", children: [(0, jsx_runtime_1.jsxs)("section", { className: "min-w-0 flex-1", children: [(0, jsx_runtime_1.jsx)("h2", { className: "mb-4 text-sm font-semibold text-muted-foreground", children: "\u6D3B\u52A8\u65F6\u95F4\u7EBF" }), (0, jsx_runtime_1.jsxs)(primer_1.Timeline, { children: [(0, jsx_runtime_1.jsx)(primer_1.TimelineItem, { icon: (0, jsx_runtime_1.jsx)(primer_1.StateIcon, { name: "check", size: 14 }), tone: "success", title: "\u5934\u8111\u98CE\u66B4\u5B8C\u6210", time: "09-25 14:02" }), (0, jsx_runtime_1.jsx)(primer_1.TimelineItem, { icon: (0, jsx_runtime_1.jsx)(primer_1.StateIcon, { name: "check", size: 14 }), tone: "success", title: "\u8BBE\u8BA1\u6587\u6863\u5B9A\u7A3F \u00B7 5 \u8F6E\u8BC4\u5BA1", time: "09-26 01:32", children: `> grill: 交叉审查发现 5 处覆盖缺口，全部 immediately_answered
> decisions: D-001@v1 三层落地 / D-002@v1 Wave 分批 / D-003@v1 范围边界
> verify-probes --init --draft: 13 任务矩阵预填完成` }), (0, jsx_runtime_1.jsx)(primer_1.TimelineItem, { icon: (0, jsx_runtime_1.jsx)(primer_1.StateIcon, { name: "check", size: 14 }), tone: "success", title: "\u6267\u884C \u00B7 task-06 \u5B8C\u6210\uFF08\u53D8\u66F4\u8BE6\u60C5\u9875\u91CD\u6392\uFF09", time: "09-27 01:58", children: `> 修改 frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
> 测试 134/134 全绿 · tsc 0 · eslint 0` }), (0, jsx_runtime_1.jsx)(primer_1.TimelineItem, { icon: (0, jsx_runtime_1.jsx)(primer_1.StateIcon, { name: "openCircle", size: 14 }), tone: "current", title: "\u6267\u884C \u00B7 task-07 \u8FDB\u884C\u4E2D\uFF08\u5DE5\u4F5C\u533A\u5217\u8868\u884C\u5F0F\u5316\uFF09", time: "\u8FD0\u884C\u4E2D \u00B7 \u5DF2 12 \u5206\u949F", children: `> 读 workspace-card.tsx / workspace-drag-grid.tsx
> draft: 行式条目（主行=名称+徽章，meta 行=技术栈+时间）` }), (0, jsx_runtime_1.jsx)(primer_1.TimelineItem, { icon: (0, jsx_runtime_1.jsx)(primer_1.StateIcon, { name: "clock", size: 14 }), title: "\u9A8C\u8BC1\uFF08\u7B49\u5F85\u6267\u884C\u5B8C\u6210\uFF09", time: "\u2014" })] })] }), (0, jsx_runtime_1.jsx)("aside", { className: "w-[296px] flex-shrink-0", children: (0, jsx_runtime_1.jsxs)(primer_1.MetaPanel, { children: [(0, jsx_runtime_1.jsxs)(primer_1.MetaPanelSection, { title: "\u57FA\u672C\u4FE1\u606F", children: [(0, jsx_runtime_1.jsx)(MetaRow, { k: "\u53D8\u66F4 key", v: (0, jsx_runtime_1.jsx)("span", { className: "font-mono", children: "observation-events-v3-r16sf" }) }), (0, jsx_runtime_1.jsx)(MetaRow, { k: "\u5DE5\u4F5C\u533A", v: "multi-agent-platform" }), (0, jsx_runtime_1.jsx)(MetaRow, { k: "\u521B\u5EFA", v: "2026-09-25 14:02" }), (0, jsx_runtime_1.jsx)(MetaRow, { k: "\u7C7B\u578B", v: "\u5B8C\u6574\u6D41\u7A0B" })] }), (0, jsx_runtime_1.jsx)(primer_1.MetaPanelSection, { title: "\u8D1F\u8D23\u4EBA", children: (0, jsx_runtime_1.jsxs)("div", { className: "flex items-center gap-2", children: [(0, jsx_runtime_1.jsx)("span", { className: "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold", style: {
                                                            backgroundColor: "var(--color-brand-50)",
                                                            color: "var(--color-brand-600)",
                                                        }, children: "Q" }), (0, jsx_runtime_1.jsx)("span", { className: "text-sm", children: "qinyi \u00B7 \u4E3B\u63A7" })] }) }), (0, jsx_runtime_1.jsxs)(primer_1.MetaPanelSection, { title: "\u6D88\u8017\u7EDF\u8BA1", children: [(0, jsx_runtime_1.jsx)(MetaRow, { k: "\u7D2F\u8BA1 token", v: (0, jsx_runtime_1.jsx)("span", { className: "font-mono", children: "2.4M" }) }), (0, jsx_runtime_1.jsx)(MetaRow, { k: "\u4F1A\u8BDD\u6B21\u6570", v: (0, jsx_runtime_1.jsx)("span", { className: "font-mono", children: "18" }) }), (0, jsx_runtime_1.jsx)(MetaRow, { k: "\u9884\u4F30\u6210\u672C", v: (0, jsx_runtime_1.jsx)("span", { className: "font-mono", children: "\u00A586.20" }) })] }), (0, jsx_runtime_1.jsxs)(primer_1.MetaPanelSection, { title: "\u9636\u6BB5\u8FDB\u5EA6", children: [(0, jsx_runtime_1.jsx)(MetaRow, { k: "\u5F53\u524D\u9636\u6BB5", v: "\u6267\u884C \u00B7 task-07" }), (0, jsx_runtime_1.jsx)(MetaRow, { k: "\u4EFB\u52A1", v: (0, jsx_runtime_1.jsx)("span", { className: "font-mono", children: "6 / 13" }) })] }), (0, jsx_runtime_1.jsxs)(primer_1.MetaPanelSection, { title: "\u5173\u8054\u4F1A\u8BDD", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex items-center justify-between text-xs", children: [(0, jsx_runtime_1.jsx)("span", { className: "truncate", children: (0, jsx_runtime_1.jsx)("a", { href: "#", className: "text-primary hover:underline", children: "sess-ff095390 \u00B7 \u6267\u884C\u4E2D" }) }), (0, jsx_runtime_1.jsx)(primer_1.StateLabel, { variant: "open", withIcon: false, children: "\u6D3B\u8DC3" })] }), (0, jsx_runtime_1.jsx)(MetaRow, { k: "\u5386\u53F2\u4F1A\u8BDD", v: (0, jsx_runtime_1.jsx)("span", { className: "font-mono", children: "17" }) })] }), (0, jsx_runtime_1.jsxs)(primer_1.MetaPanelSection, { title: "\u5E73\u53F0\u540C\u6B65", children: [(0, jsx_runtime_1.jsx)(MetaRow, { k: "\u72B6\u6001", v: "\u5DF2\u540C\u6B65" }), (0, jsx_runtime_1.jsx)(MetaRow, { k: "\u4E0A\u6B21\u56DE\u6267", v: "3 \u5206\u949F\u524D" })] })] }) })] })] })] }));
}
