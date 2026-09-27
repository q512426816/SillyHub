"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ISSUE_ROW_GRID = void 0;
exports.IssueRow = IssueRow;
exports.IssueRowHeader = IssueRowHeader;
const jsx_runtime_1 = require("react/jsx-runtime");
const state_icon_1 = require("./state-icon");
/** 行网格列：行首插槽 | 状态图标 | 主体（两段） | 右侧元数据。 */
exports.ISSUE_ROW_GRID = "grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-start gap-x-3";
const STATE_TO_ICON = {
    open: "openCircle",
    merged: "mergedCheck",
    attention: "zap",
    done: "check",
    error: "x",
    neutral: "check",
};
function IssueRow({ state, title, meta, right, onClick, hoverActions, leading, className, }) {
    const interactive = typeof onClick === "function";
    return ((0, jsx_runtime_1.jsxs)("div", { role: interactive ? "button" : undefined, tabIndex: interactive ? 0 : undefined, onClick: onClick, onKeyDown: interactive
            ? (e) => {
                if (e.key === "Enter")
                    onClick();
            }
            : undefined, className: `group relative ${exports.ISSUE_ROW_GRID} px-3 py-2.5 text-sm transition-colors ${interactive ? "cursor-pointer hover:bg-muted/60" : ""} ${className ?? ""}`, children: [leading ? (0, jsx_runtime_1.jsx)("div", { className: "flex items-center pt-0.5", children: leading }) : null, (0, jsx_runtime_1.jsx)("div", { className: "flex items-center pt-0.5 text-muted-foreground", children: (0, jsx_runtime_1.jsx)(state_icon_1.StateIcon, { name: STATE_TO_ICON[state], size: 16 }) }), (0, jsx_runtime_1.jsxs)("div", { className: "flex min-w-0 flex-col gap-1", children: [(0, jsx_runtime_1.jsx)("div", { className: "flex min-w-0 flex-wrap items-center gap-x-2", children: title }), meta ? ((0, jsx_runtime_1.jsx)("div", { className: "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground", children: meta })) : null] }), (0, jsx_runtime_1.jsxs)("div", { className: "flex items-start justify-end gap-3 text-xs text-muted-foreground", children: [right, hoverActions ? ((0, jsx_runtime_1.jsx)("div", { className: "hidden items-center gap-1 group-hover:flex", children: hoverActions })) : null] })] }));
}
function IssueRowHeader({ leading, title, right, className, }) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: `${exports.ISSUE_ROW_GRID} border-b px-3 py-2 text-xs font-medium text-muted-foreground ${className ?? ""}`, style: { borderBottomColor: "hsl(var(--border))" }, children: [leading ? (0, jsx_runtime_1.jsx)("div", { children: leading }) : (0, jsx_runtime_1.jsx)("div", {}), (0, jsx_runtime_1.jsx)("div", {}), (0, jsx_runtime_1.jsx)("div", { children: title }), (0, jsx_runtime_1.jsx)("div", { className: "flex justify-end", children: right })] }));
}
