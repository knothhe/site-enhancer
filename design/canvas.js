window.H2_DESIGN_CANVAS = {
  title: "site-enhancer · 简洁复制面板",
  boards: [
    { file: "popup-ready.html", title: "01 · 左侧说明，右侧复制", x: 0, y: 100, w: 300, h: 240 },
    { file: "popup-copied.html", title: "02 · 按钮内显示已复制", x: 340, y: 100, w: 300, h: 240 },
    { file: "popup-failed.html", title: "03 · 失败可重试", x: 680, y: 100, w: 300, h: 240 },
    { file: "popup-unavailable.html", title: "04 · 不支持的页面", x: 1020, y: 100, w: 300, h: 160 },
    { file: "popup-loading.html", title: "05 · 读取中", x: 1360, y: 100, w: 300, h: 240 },
    { file: "popup-text-ready.html", title: "06 · 识别纯文本", x: 0, y: 480, w: 300, h: 310 },
    { file: "popup-text-pending.html", title: "07 · 准备下载", x: 340, y: 480, w: 300, h: 310 },
    { file: "popup-text-started.html", title: "08 · 已开始下载", x: 680, y: 480, w: 300, h: 310 },
    { file: "popup-text-failed.html", title: "09 · 下载失败可重试", x: 1020, y: 480, w: 300, h: 310 },
    { file: "popup-json-ready.html", title: "10 · JSON 保存为 .json", x: 1360, y: 480, w: 300, h: 310 },
  ],
  notes: [
    { text: "左侧链接类型与短说明，右侧复制按钮；不使用卡片。去追踪保留其他参数；无参数移除全部查询参数。两种方式保留锚点。无参数按钮悬停提示搜索、筛选可能丢失。", x: 0, y: 0, w: 900 },
    { text: "纯文本和 JSON 响应显示下载行；JSON 标为 JSON 文件并保存为 .json，包含 application/json、text/json 和 application/*+json。文件名过长时省略，悬停查看全名。原样保存已加载内容为 UTF-8，不重新请求或解析重排 JSON。下载中的等待、完成及错误恢复沿用文本下载状态。已开始只代表交给浏览器下载，路径由浏览器设置决定。页面已刷新或跳转时提示重新打开面板。", x: 0, y: 360, w: 1300 },
  ],
};
