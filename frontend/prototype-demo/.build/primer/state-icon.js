"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateIcon = StateIcon;
const jsx_runtime_1 = require("react/jsx-runtime");
/** 单图标 viewBox=0 0 16 16、fill none、stroke currentColor(1.5)。 */
function glyph(name) {
    switch (name) {
        case "openCircle":
            return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("circle", { cx: "8", cy: "8", r: "5.5" }), (0, jsx_runtime_1.jsx)("circle", { cx: "8", cy: "8", r: "1.6", fill: "currentColor", stroke: "none" })] }));
        case "mergedCheck":
            return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("path", { d: "M4 13V8a4 4 0 014-4h3.5" }), (0, jsx_runtime_1.jsx)("circle", { cx: "4", cy: "13.5", r: "1.6" }), (0, jsx_runtime_1.jsx)("path", { d: "M8.5 8.5l2 2 3.5-3.5" })] }));
        case "zap":
            return (0, jsx_runtime_1.jsx)("path", { d: "M9 1.5L3 9h3.5L6.5 14.5 13 7H9.5L9 1.5z" });
        case "clock":
            return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("circle", { cx: "8", cy: "8", r: "6" }), (0, jsx_runtime_1.jsx)("path", { d: "M8 4.5V8l2.5 1.5" })] }));
        case "check":
            return (0, jsx_runtime_1.jsx)("path", { d: "M3 8.5l3.5 3.5L13 4.5" });
        case "x":
            return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("path", { d: "M4 4l8 8" }), (0, jsx_runtime_1.jsx)("path", { d: "M12 4l-8 8" })] }));
    }
}
function StateIcon({ name, size = 16, className }) {
    return ((0, jsx_runtime_1.jsx)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", className: className, children: glyph(name) }));
}
