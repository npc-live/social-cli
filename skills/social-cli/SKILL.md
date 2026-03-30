---
name: social-cli
version: 0.1.0
description: >
  How to automate social media actions using the @harness.farm/social-cli CDP CLI tool.
  Use this skill whenever the user wants to search, like, comment, follow, post, or scrape
  content on 小红书 (XHS/xiaohongshu), X (Twitter), 抖音 (Douyin), B站 (Bilibili),
  or Temu — even if they just say "帮我搜一下小红书" or "给这个视频点个赞" or
  "post to douyin". Also trigger when the user asks about running social-cli commands,
  automating social platforms via CDP, or debugging Chrome remote debugging setup.
---

# social-cli 使用指南

`@harness.farm/social-cli` 是一个 CDP（Chrome DevTools Protocol）社交媒体自动化 CLI，通过控制真实 Chrome 浏览器执行操作，支持已登录账号的全部功能。

## 安装

```bash
npm install -g @harness.farm/social-cli
```

安装后可直接使用 `social-cli` 命令。

---

## 前置条件：启动 Chrome CDP

**每次使用前必须先启动 Chrome**（终端卡住是正常现象，保持运行）：

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=$HOME/.cdp-scraper/chrome-profile
```

验证 Chrome 就绪：
```bash
curl -s http://localhost:9222/json/version
```
返回 JSON 表示就绪。

**首次使用某平台时**，Chrome 会打开登录页，需要手动登录。之后操作会复用登录状态（cookie 保存在 `--user-data-dir` 指定目录）。

---

## 基本用法

```bash
social-cli <platform> <command> [args...]
```

---

## 平台 & 命令速查

### 小红书 (xhs / xiaohongshu)

| 命令 | 参数 | 说明 |
|------|------|------|
| `search` | `<keyword>` | 搜索笔记，返回标题/作者/链接 |
| `hot` | — | 获取首页热门笔记 |
| `like` | `<url>` | 点赞/取消点赞一篇笔记 |
| `comment` | `<url> <text>` | 发表评论 |
| `post` | `<image> <title> <content>` | 发布图文笔记（图片路径必填） |
| `post_video` | `<video> <title> <desc>` | 发布视频笔记 |

```bash
social-cli xhs search 法律ai
social-cli xhs like "https://www.xiaohongshu.com/explore/abc123"
social-cli xhs comment "https://..." "写得很好！"
social-cli xhs post "/path/to/image.jpg" "标题" "正文内容"
social-cli xhs post_video "/path/to/video.mp4" "标题" "描述"
```

### X (Twitter)

| 命令 | 参数 | 说明 |
|------|------|------|
| `search` | `<keyword>` | 搜索推文，返回内容/用户/链接/时间 |
| `like` | `<url>` | 点赞/取消点赞 |
| `reply` | `<url> <text>` | 回复推文 |
| `post` | `<text>` | 发新推文 |
| `retweet` | `<url>` | 转推 |

```bash
social-cli x search "AI tools"
social-cli x post "Hello from CLI!"
social-cli x reply "https://x.com/user/status/123" "Great point!"
social-cli x retweet "https://x.com/user/status/123"
```

### 抖音 (douyin)

| 命令 | 参数 | 说明 |
|------|------|------|
| `search` | `<keyword>` | 搜索视频 |
| `like` | `<url>` | 点赞（按 Z 键） |
| `comment` | `<url> <text>` | 发表评论（按 X 键打开评论区） |
| `follow` | `<url>` | 关注 UP 主 |
| `post` | `<video> <title> <desc>` | 发布视频 |

```bash
social-cli douyin search 编程教程
social-cli douyin like "https://www.douyin.com/video/123"
social-cli douyin comment "https://..." "太棒了！"
social-cli douyin post "/path/video.mp4" "标题" "描述"
```

### B站 (bilibili)

| 命令 | 参数 | 说明 |
|------|------|------|
| `search` | `<keyword>` | 搜索视频 |
| `like` | `<url>` | 点赞视频 |
| `comment` | `<url> <text>` | 发表评论（自动处理 shadow DOM） |
| `reply` | `<url> <text>` | 回复第一条评论 |
| `follow` | `<url>` | 关注 UP 主 |
| `post` | `<video> <title> <desc>` | 投稿视频（等待上传完成） |

```bash
social-cli bilibili search 机器学习
social-cli bilibili comment "https://www.bilibili.com/video/BVxxx" "学到了！"
social-cli bilibili post "/path/video.mp4" "标题" "简介"
```

---

## 常见问题排查

| 错误 | 原因 | 解决 |
|------|------|------|
| `无法连接到 Chrome CDP (端口 9222)` | Chrome 未启动或未开启调试模式 | 按上方命令启动 Chrome |
| `Unknown platform` | 平台名拼写错误 | 可用平台：`xhs`/`xiaohongshu`、`x`、`douyin`、`bilibili` |
| 操作失败/无响应 | 未登录该平台 | 在 Chrome 中手动登录后重试 |
| 视频上传卡住 | B站/抖音上传需要等待，CLI 会自动轮询 | 耐心等待，超时为 5 分钟 |
