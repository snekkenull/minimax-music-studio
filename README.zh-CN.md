# minimax music studio

基于 GMI Cloud 上 [Minimax Music 3.0](https://docs.gmicloud.ai/model-quickstarts/audio/minimax-music-3-0) 模型开发的一个网页应用。输入一个主题，一次性生成 1 到 100 首歌曲。每一首都会保存到本地曲库中，支持搜索、回放、下载。

本项目由 **Everclaw Agent** 基于 **MiniMax M3** 模型开发。

> English version: see [README.md](./README.md).

![Screenshot](./screenshot.png)

## 它能做什么

- **批量生成（一次 1 到 100 首）** — 输入一个主题，填一个数量，按一个按钮。每一首歌都会先由 LLM 写出独立的歌词和音乐提示词，再生成音频。实时进度条告诉你当前进度。
- **一个 Generate 按钮搞定一切** — LLM 一次调用就生成歌名、歌词和音乐提示词。你可以套用到表单里继续编辑，也可以完全自己写。
- **本地曲库** — 每一首成功生成的歌曲都会保存到浏览器（IndexedDB）。可以按歌名和歌词搜索、收藏、软删除到回收站、导出为 ZIP / JSON / CSV。音频在生成完成的瞬间就被缓存为 blob，因此即使离线也能下载。
- **崩溃后接着干** — 批量进行中刷新页面，未完成的歌曲会从上次的断点继续。
- **会话历史** — 每次成功生成都会自动保存一个输入快照。点击任意一条历史记录就能把表单重新填好。
- **真正的音频下载** — 歌曲详情页的下载按钮和曲库每行的下载按钮，下载的都是真正的 MP3/WAV 字节，外加一个歌词 sidecar 文件。
- **设置页** — API key、模型选择、两个 API 端点 URL。每个 URL 字段都带实时可达性检测。"Test all settings" 一键跑完整条链路并告诉你哪一项通过。
- **深色 / 浅色 / 跟随系统主题** — 主题按钮在三种之间循环。第一次访问时跟随操作系统偏好。
- **中英双语界面** — 语言按钮在中英之间循环。第一次访问时跟随浏览器的首选语言。

## 快速开始

你需要 **Node.js 18 或更高版本**。除此之外什么都不需要。不需要 `npm install`，没有构建步骤。

### 1. 把代码拿到本地

```bash
git clone https://github.com/snekkenull/minimax-music-studio.git
cd minimax-music-studio
```

如果你没装 Git，也可以在 GitHub 仓库页面点绿色的 **Code** 按钮，选 **Download ZIP**，下载后解压并 `cd` 进去。

### 2. 启动应用

- **macOS** — 双击 `start.command`
- **Windows** — 双击 `start.bat`
- **Linux** — 在终端里执行 `./start.sh`

启动器会检查 Node，启动本地代理，并在默认浏览器里打开应用。如果没装 Node，启动器会打印出当前平台对应的安装命令（Homebrew、apt、dnf、winget、Chocolatey，或官网下载页）然后停止运行，等你装好再启动一次即可。

在启动器窗口里按 `Ctrl+C` 可以停止本地代理。

## 第一次使用

1. 点击应用右上角的**齿轮图标**，进入设置页。
2. 在 [GMI Cloud](https://console.gmicloud.ai/ref/5VHEBA7F) 申请一个 **API key**，粘贴进来。API key 只保存在你浏览器的本地存储里，不会被发送到除了 GMI Cloud 之外的任何地方。
3. 音乐模型（`minimax-music-3.0`）和 LLM 模型已经预填好了。除非你清楚自己在做什么，否则不要改。
4. 点击 **Save**，自动跳回应用主页面。
5. 在 **批量生产线** 卡片里填一个主题（比如 "rainy Tokyo café, lo-fi jazz, English lyrics"），选一个数量（1 到 100），按 **Start production**。

歌曲会随着完成一条一条出现在右侧详情面板和 **Library** 标签里。点任意一首歌就能播放，点下载按钮可以保存 MP3 和同名的歌词文件。

## 像普通应用一样使用它

| 想做的事 | 操作 |
| --- | --- |
| 用自己的歌词生成一首 | 把 Lyrics 和 Prompt 两个文本框填好，Title 留空，按 **Generate** |
| 用一个主题生成 N 首歌 | 用 **批量生产线** 卡片，填数量，按 **Start production** |
| 让 LLM 起草一首歌的整包内容 | 点 **Generate**（Apply 之后歌词和提示词仍然可以继续手改） |
| 再听一遍某首歌 | 在 **Library** 标签里点那一行，按播放 |
| 保存音频文件 | 在那一行或右侧详情面板点下载图标 |
| 找回上周做的歌 | 在 Library 标签的搜索框里搜（会搜歌名和歌词） |
| 清空回收站 | Library 标签 → Trash → Empty trash |
| 换 API key | 右上角齿轮图标 |
| 切换语言 | 右上角地球图标（zh ⇄ en） |
| 切换主题 | 右上角太阳/月亮图标（深色 ⇄ 浅色 ⇄ 跟随系统） |
| 停止本地服务 | 在终端窗口按 Ctrl+C |

## 30 秒搞懂架构

这是一个 **零构建** 项目。整个应用就是纯 HTML、CSS 和原生 JavaScript 模块 —— 没有打包器、没有编译器、没有 `package.json`。唯一的服务端文件是 `proxy.js`，一个很小的 Node 脚本，做三件事：

1. 把这个目录里的静态文件（`music-generator.html`、`settings.html`、`js/*.js`、`theme.css`、`lib/idb-keyval.min.js`）作为 HTTP 服务起来。
2. 把所有 `/api/*` 请求转发到 `https://console.gmicloud.ai/api/*`。
3. 注入 CORS 头，让浏览器（`http://127.0.0.1:8787/`）能访问上游（`https://console.gmicloud.ai/`），不会被浏览器拦截。

代理是 **必须** 的。GMI Cloud 的 API 不返回 CORS 头，所以浏览器直接 fetch 会在到达鉴权之前就报 `TypeError: Failed to fetch`。代理在本地终结 CORS，再把请求原样转过去。

### 为什么不需要构建？

每个模块都是 `music-generator.html` 和 `settings.html` 里的一个普通 `<script>` 标签。模块本身用 IIFE 包裹，把自己注册到 `window.MusicStudio` 这个全局命名空间上，按加载顺序依次执行。改一个 `.js` 文件，刷新一下页面，改动就生效了。没有"开发服务器"和"生产服务器"之分 —— 代理既是开发服务器也是生产服务器。

### 我的数据存在哪里？

所有数据都在你本地的浏览器里。没有中心化服务器、没有账号、没有埋点。

| 是什么 | 存在哪 |
| --- | --- |
| API key | `localStorage`（仅本浏览器） |
| 表单内容（避免刷新丢失输入） | `localStorage` |
| 进行中的批量任务（崩溃后能恢复） | IndexedDB |
| 已保存的歌曲（元数据 + 音频字节） | IndexedDB |
| 最近的输入历史 | IndexedDB |

要清空所有数据，打开浏览器 DevTools 控制台执行：

```js
indexedDB.deleteDatabase('minimax-metadata');
indexedDB.deleteDatabase('minimax-blobs');
indexedDB.deleteDatabase('minimax-sessions');
localStorage.clear();
```

然后刷新。

## 环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `8787` | 本地代理监听的 TCP 端口。如果 8787 被占用了就换一个。 |
| `HOST` | `127.0.0.1` | 绑定地址。默认只监听本机。除非你知道在做什么，否则不要改。 |

在启动器之前设置：

```bash
PORT=9000 ./start.sh              # macOS / Linux
$env:PORT = 9000 ; .\start.ps1    # Windows PowerShell
```

## 常见问题

**启动器提示 "Node.js is not installed"。**
装 Node.js 18 或更高版本：
- macOS: `brew install node@18`（或去 https://nodejs.org 下载）
- Linux: `sudo apt install nodejs npm`（Ubuntu 20.04+），或用你发行版的包管理器
- Windows: `winget install OpenJS.NodeJS.LTS`（或去 https://nodejs.org 下载）

装完之后关掉终端重新打开，再跑一次启动器。

**"EADDRINUSE: address already in use :::8787"。**
8787 端口被别的进程占了。要么关掉那个进程，要么用别的端口跑启动器：`PORT=9000 ./start.sh`。

**"API Key 未配置"。**
点应用右上角的齿轮图标，在 GMI Cloud 申请一个 API key 粘进来，点 Save。从 https://console.gmicloud.ai/ref/5VHEBA7F 申请的 key 以 `mock_` 开头是免费额度。

**API key 状态条显示 "HTTP 401" 或 "鉴权失败"。**
key 无效、过期了、或者还没激活。去 GMI Cloud 控制台重新申请一个。

**浏览器打开了但是页面是空白的。**
看看启动器所在终端窗口的日志 —— 代理会把每个请求都打出来。如果看到 `js/*.js` 报 404，说明启动器跑错了目录；脚本会自动往上级目录找 `proxy.js`，但在某些沙箱里（Docker bind mount 等）这个 walk 会失败。回到解压出来的目录里运行启动器。

**曲库里能看到几周前做的歌，但新歌保存不进去。**
不同浏览器对 IndexedDB 的配额不一样。打开 DevTools → Application → Storage → IndexedDB 看看配额。如果到上限了，把曲库导出为 JSON（Library 标签 → Export），清空回收站，再通过 Import 把 JSON 粘回来。

## 目录结构

仓库根目录就是发布包根目录 —— `git clone` 拿到的就是最终发布的目录。

```
minimax-music-studio/
├── proxy.js                  # Node CORS 代理 + 静态服务
├── music-generator.html      # 主应用页面
├── settings.html             # 设置页
├── theme.css                 # 深色 / 浅色 / 跟随系统主题 token
├── js/                       # 12 个原生 JS 模块（无打包器）
├── lib/idb-keyval.min.js     # 极简 IndexedDB 键值库
├── start.command             # macOS Finder 双击
├── start.sh                  # macOS + Linux 终端
├── start.bat                 # Windows 双击
├── start.ps1                 # Windows PowerShell
├── README.md                 # 英文版
├── README.zh-CN.md           # 本文件
└── VERSION                   # 0.2.0
```

## 感谢

本项目由 **Everclaw Agent** 基于 **MiniMax M3** 模型开发，由 **GMI Cloud** 提供模型。
