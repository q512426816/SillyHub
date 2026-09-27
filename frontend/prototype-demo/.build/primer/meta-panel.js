"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetaPanel = MetaPanel;
exports.MetaPanelSection = MetaPanelSection;
const jsx_runtime_1 = require("react/jsx-runtime");
function MetaPanel({ children, className }) {
    return ((0, jsx_runtime_1.jsx)("aside", { className: `rounded-lg border text-sm ${className ?? ""}`, style: {
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--muted))",
        }, children: children }));
}
function MetaPanelSection({ title, children }) {
    return ((0, jsx_runtime_1.jsxs)("section", { className: "border-b px-4 py-3 last:border-b-0", style: { borderBottomColor: "hsl(var(--border))" }, children: [(0, jsx_runtime_1.jsx)("h3", { className: "mb-2 text-xs font-semibold text-muted-foreground", children: title }), (0, jsx_runtime_1.jsx)("div", { className: "flex flex-col gap-1.5 text-sm", children: children })] }));
}
