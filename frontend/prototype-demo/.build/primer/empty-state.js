"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmptyState = EmptyState;
const jsx_runtime_1 = require("react/jsx-runtime");
function EmptyState({ title = "暂无数据", description, icon, children, className, }) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: `flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center ${className ?? ""}`, children: [icon ? (0, jsx_runtime_1.jsx)("div", { className: "text-muted-foreground", children: icon }) : null, (0, jsx_runtime_1.jsx)("div", { className: "text-sm font-medium", children: title }), description ? ((0, jsx_runtime_1.jsx)("div", { className: "max-w-md text-xs leading-5 text-muted-foreground", children: description })) : null, children ? (0, jsx_runtime_1.jsx)("div", { className: "mt-2", children: children }) : null] }));
}
