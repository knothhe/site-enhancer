window.H2_DESIGN_CANVAS = {
  title: "site-enhancer · 简洁复制面板",
  boards: [
    { file: "popup-ready.html", title: "01 · 左侧说明，右侧复制", x: 0, y: 100, w: 300, h: 240 },
    { file: "popup-copied.html", title: "02 · 按钮内显示已复制", x: 340, y: 100, w: 300, h: 240 },
    { file: "popup-failed.html", title: "03 · 失败可重试", x: 680, y: 100, w: 300, h: 240 },
    { file: "popup-unavailable.html", title: "04 · 不支持的页面", x: 1020, y: 100, w: 300, h: 160 },
    { file: "popup-loading.html", title: "05 · 读取中", x: 1360, y: 100, w: 300, h: 240 },
  ],
  notes: [{ text: "左侧链接类型与短说明，右侧复制按钮；不使用卡片。去追踪保留其他参数；无参数移除全部查询参数。两种方式保留锚点。无参数按钮悬停提示搜索、筛选可能丢失。", x: 0, y: 0, w: 900 }],
};
