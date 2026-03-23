# social-cli

基于 Chrome DevTools Protocol (CDP) 的社交媒体自动化 CLI，支持 X（推特）、小红书、抖音、B站，无需安装浏览器插件或 Playwright，直接连接你已有的 Chrome。

## 工作原理

```
Chrome (--remote-debugging-port=9222)
        ↕ WebSocket / CDP
social-cli
  ├── adapters/<platform>.yaml   ← YAML 适配器（优先）
  └── src/adapters/<platform>.ts ← TypeScript 适配器（兜底）
```

- **YAML 适配器**：声明式步骤描述，易于阅读和修改，无需编译
- **TypeScript 适配器**：适合复杂逻辑，编译后运行
- **登录状态管理**：首次运行时引导登录，自动保存 session cookie，后续免登录

## 快速开始

### 1. 启动 Chrome（开启远程调试）

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=$HOME/.cdp-scraper/chrome-profile

# Windows
chrome.exe --remote-debugging-port=9222 --user-data-dir=%USERPROFILE%\.cdp-scraper\chrome-profile

# Linux
google-chrome --remote-debugging-port=9222 --user-data-dir=~/.cdp-scraper/chrome-profile
```

### 2. 安装依赖

```bash
npm install
```

### 3. 运行命令

```bash
# 开发模式（tsx，无需编译）
tsx src/cli.ts <platform> <command> [args...]

# 或使用 package.json 快捷脚本
npm run xhs -- search 法律ai
npm run x   -- search "claude ai"
```

## 支持的平台和命令

### X（推特）

| 命令 | 参数 | 说明 |
|------|------|------|
| `search` | `keyword` | 搜索推文 |
| `like` | `url` | 点赞 / 取消点赞 |
| `reply` | `url text` | 回复推文 |
| `post` | `text` | 发推 |
| `retweet` | `url` | 转推 |

```bash
tsx src/cli.ts x search "claude ai"
tsx src/cli.ts x like "https://x.com/user/status/123"
tsx src/cli.ts x reply "https://x.com/user/status/123" "很有意思！"
tsx src/cli.ts x post "Hello from social-cli!"
tsx src/cli.ts x retweet "https://x.com/user/status/123"
```

### 小红书（xhs / xiaohongshu）

| 命令 | 参数 | 说明 |
|------|------|------|
| `search` | `keyword` | 搜索笔记 |
| `hot` | — | 获取首页热门笔记 |
| `like` | `url` | 点赞 / 取消点赞 |
| `comment` | `url text` | 发表评论 |
| `post` | `title content` | 发布图文笔记 |

```bash
tsx src/cli.ts xhs search 法律ai
tsx src/cli.ts xhs hot
tsx src/cli.ts xhs like "https://www.xiaohongshu.com/explore/..."
tsx src/cli.ts xhs comment "https://..." "太棒了！"
tsx src/cli.ts xhs post --title "我的标题" --content "正文内容"
```

### 抖音（douyin）

| 命令 | 参数 | 说明 |
|------|------|------|
| `search` | `keyword` | 搜索视频 |
| `like` | `url` | 点赞（Z 键） |
| `comment` | `url text` | 发表评论 |
| `follow` | `url` | 关注用户 |
| `post` | `video title desc` | 发布视频 |

```bash
tsx src/cli.ts douyin search 猫咪
tsx src/cli.ts douyin like "https://www.douyin.com/video/..."
tsx src/cli.ts douyin comment "https://..." "哈哈哈"
tsx src/cli.ts douyin post /path/to/video.mp4 "标题" "描述"
```

### B站（bilibili）

| 命令 | 参数 | 说明 |
|------|------|------|
| `search` | `keyword` | 搜索视频 |
| `like` | `url` | 点赞视频 |
| `follow` | `url` | 关注 UP 主 |
| `comment` | `url text` | 发表评论 |
| `reply` | `url text` | 回复第一条评论 |
| `post` | `video title desc` | 投稿视频 |

```bash
tsx src/cli.ts bilibili search TypeScript教程
tsx src/cli.ts bilibili like "https://www.bilibili.com/video/BV..."
tsx src/cli.ts bilibili comment "https://..." "讲得很好！"
tsx src/cli.ts bilibili post /path/to/video.mp4 "视频标题" "视频描述"
```

## YAML 适配器格式

YAML 适配器位于 `adapters/` 目录，无需编译即可生效，支持热修改。

```yaml
platform: myplatform
login_url: https://example.com
login_check:
  cookie: session_cookie_name   # 用于判断是否已登录

commands:
  search:
    args: [keyword]             # 位置参数名
    steps:
      - open: "https://example.com/search?q={{keyword}}"
      - wait: 3000
      - extract:
          selector: ".item"
          fields:
            title: ".title"
            link:
              selector: "a"
              attr: href
```

### 支持的 Step 类型

| Step | 说明 |
|------|------|
| `open: url` | 导航到 URL |
| `wait: ms` | 等待毫秒数 |
| `wait: { selector }` | 等待元素出现 |
| `click: selector` | 点击元素 |
| `click: { text: "..." }` | 按文本内容点击 |
| `fill: { selector, value }` | 填写 input 表单 |
| `type_rich: { selector, value }` | 输入到 contenteditable 元素 |
| `eval: "js"` | 执行 JavaScript |
| `capture: { name, eval }` | 执行 JS 并保存结果到变量 |
| `extract: { selector, fields }` | 批量抓取列表数据 |
| `return: [{ field, value }]` | 输出结果表格 |
| `upload: { selector, file }` | 上传本地文件 |
| `screenshot: path` | 截图保存 |
| `key: "key"` | 模拟按键（如 `Enter`, `z`, `x`） |
| `keyboard_insert: text` | 逐字符发送（适用于 Draft.js / React 输入框） |
| `insert_text: text` | CDP 直接插入文本（可穿透 shadow DOM） |
| `assert: { eval, message }` | 断言，失败则报错 |

模板变量使用 `{{varName}}` 语法，也支持 JS 表达式：`{{a === 'true' ? '是' : '否'}}`

## 编译发布

```bash
npm run build         # 编译 TypeScript → dist/
```

编译后可作为 `social-cli` 命令使用（需全局安装或 `npx`）。

## 项目结构

```
cdp-scraper/
├── adapters/              # YAML 适配器（运行时读取，优先生效）
│   ├── x.yaml
│   ├── xhs.yaml
│   ├── xiaohongshu.yaml
│   ├── douyin.yaml
│   └── bilibili.yaml
├── src/
│   ├── cli.ts             # CLI 入口，适配器解析与路由
│   ├── runner/
│   │   ├── yaml-runner.ts # YAML 步骤执行引擎
│   │   └── step-executor.ts
│   ├── browser/
│   │   ├── cdp.ts         # CDP WebSocket 客户端
│   │   ├── session.ts     # Cookie session 持久化
│   │   └── runner.ts      # TS 适配器运行器
│   ├── adapters/          # TypeScript 适配器（兜底）
│   │   ├── base.ts
│   │   ├── xiaohongshu.ts
│   │   └── index.ts
│   └── output/
│       └── table.ts       # 终端表格渲染
└── package.json
```

## License

MIT
