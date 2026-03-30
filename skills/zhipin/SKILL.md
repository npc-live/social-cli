---
name: zhipin
version: 0.2.0
description: >
  How to automate Boss直聘 (BOSS直聘) recruitment tasks using the zhipin CDP adapter.
  Use this skill whenever the user wants to: check how many candidates messaged them,
  view chat statistics, list candidates, download/screenshot resumes from Boss直聘,
  or filter/screen candidates using AI based on job requirements.
  Trigger on phrases like "帮我看下简历", "下载简历", "筛选候选人", "有多少人投简历",
  "有多少人通过", "按标准筛选", "Boss直聘", "直聘", "候选人", "招聘", "查看简历",
  or any question about automating Boss直聘 recruitment workflow.
---

# zhipin (Boss直聘) 使用指南

通过 CDP 控制已登录的 Chrome，自动化 Boss直聘 招聘流程。

## 前置条件

Chrome 必须已开启 CDP 并登录 Boss直聘：

```bash
# 启动 Chrome
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=$HOME/.cdp-scraper/chrome-profile

# 验证连接
curl -s http://localhost:9222/json/version
```

---

## YAML 适配器命令（social-cli）

适配器文件：`adapters/zhipin.yaml`

### chat_stats — 统计发起对话人数

```bash
npm run dev -- zhipin chat_stats
# 或（全局安装后）
social-cli zhipin chat_stats
```

输出示例：
```
┌──────────┬──────────────────────────────────────────────┐
│ 总会话数  │ 40                                           │
│ 未读会话数 │ 40                                          │
│ 未读明细  │ 张三(后端工程师) 未读1条: 您好，我对贵公司…  │
└──────────┴──────────────────────────────────────────────┘
```

### candidates — 获取所有候选人列表

```bash
npm run dev -- zhipin candidates
# 或
social-cli zhipin candidates
```

返回所有发起对话的候选人：姓名、应聘职位、最新消息摘要。

---

## TypeScript 脚本：批量下载简历截图

脚本路径：`src/scripts/zhipin-download-resumes.ts`

```bash
# 默认输出到 ./resumes/
npm run zhipin:resumes

# 指定输出目录
npm run zhipin:resumes -- ./my-resumes
```

### 工作流程

```
1. 打开聊天列表 → 滚动加载全部候选人（自动处理分页）
2. 逐个候选人：
   ├── 点击候选人
   ├── 点击「在线简历」按钮
   ├── 等待 WASM 渲染完成（简历用 Canvas + WebAssembly 渲染）
   ├── 滚动截图（长简历自动分段，每段一张 PNG）
   └── 关闭弹窗，继续下一位
3. 输出 _summary.json
```

### 输出结构

```
./resumes/
├── 001_张三/
│   ├── resume_01.png    # 简历第一屏
│   └── resume_02.png    # 简历第二屏（长简历）
├── 002_李四/
│   └── resume_01.png
├── ...
└── _summary.json        # 所有候选人汇总（姓名/职位/UID/截图路径）
```

### 为什么是截图而不是文字

Boss直聘简历采用三层保护，无法提取 DOM 文字：

```
API 返回 encryptGeekDetailInfo（AES 加密）
        ↓
   WASM 模块解密
        ↓
  Canvas 渲染（无文字节点）
```

截图可完整保留姓名、年龄、工作经历、教育经历、技能标签、自我介绍等全部内容。

---

---

## TypeScript 脚本：AI 筛选候选人

脚本路径：`src/scripts/zhipin-screen-resumes.ts`

基于已下载的简历截图，用 Claude Vision 逐个分析并按招聘标准打分。

```bash
# 基本用法
npm run zhipin:screen -- <resumeDir> "<招聘标准>"

# 示例
npm run zhipin:screen -- ./resumes "要求3年以上Python经验，熟悉大模型训练（微调/RLHF），本科及以上学历，有NLP项目经验优先"
```

### 输出示例

```
🔍 招聘标准：要求3年以上Python经验，熟悉大模型训练...
👥 候选人数：40

✅ [1/40] 张三  后端工程师
   评分: ████████░░ 8/10
   摘要: 清华CS硕士，4年PyTorch大模型训练经验
   亮点: 有完整预训练/SFT/RLHF经验 · 开源LLM贡献者
   欠缺: 英文论文发表经验不足

❌ [3/40] 李四  数据标注师
   评分: ██░░░░░░░░ 2/10
   欠缺: 无模型训练技术经验 · 无编程能力

════════════════════════════════════════════
📊 筛选结果汇总
总候选人：40  |  通过：12  |  未通过：28  |  平均分：5.2

✅ 通过名单（12 人，按评分排序）：
   9/10  张三   — 清华CS硕士，完整LLM训练经验
   8/10  王五   — 3年PyTorch经验，有RLHF项目
   ...
```

### 完整工作流

```bash
# 第一步：下载所有候选人简历截图
npm run zhipin:resumes -- ./resumes

# 第二步：AI 筛选
npm run zhipin:screen -- ./resumes "你的招聘标准描述"

# 结果保存在
# ./resumes/_screen_result.json  （JSON 详细数据）
# 终端输出通过/未通过名单
```

### 环境要求

- `ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_API_KEY`（Claude API Key）
- 可选：`ANTHROPIC_BASE_URL`（ZenMux 等代理端点）
- 可选：`ANTHROPIC_DEFAULT_SONNET_MODEL`（自定义模型，默认 `claude-sonnet-4-6`）

---

## 常见问题

| 错误 | 原因 | 解决 |
|------|------|------|
| `连接失败` | Chrome 未启动 | 按前置条件启动 Chrome |
| `候选人列表为空` | 未登录 Boss直聘 | 在 Chrome 里手动登录后重试 |
| `在线简历按钮未出现` | 聊天详情未加载 | 增大 sleep 等待时间 |
| 截图为空白 | WASM 未渲染完成 | 脚本已内置 3.5s 等待，可在代码里调大 |
