/**
 * 小红书 adapter
 *
 * Commands:
 *   search <keyword>                搜索笔记
 *   hot                             首页推荐
 *   post --title <t> --content <c> [--images <p1,p2>]   发布图文
 */
import path from 'path';
import fs from 'fs';
import { Adapter, type CommandResult } from './base.js';
import type { CDPClient } from '../browser/cdp.js';
import { sleep } from '../browser/cdp.js';

// ─── selectors ────────────────────────────────────────────────────────────────

const SEL = {
  // 搜索 / 首页
  noteItem:       '.note-item',
  noteTitle:      '.title, [class*="title"]',
  noteAuthor:     '.author .name, .nickname, [class*="author"] span',
  noteLikes:      '[class*="like"] span, .like-wrapper [class*="count"]',
  // 发布
  postFileInput:  'input[type=file][accept*=jpg]',
  postTitle:      'input.d-text[placeholder*="标题"]',
  postContent:    '.tiptap.ProseMirror',
  postSubmit:     'button:last-of-type',
  // 笔记详情页互动
  likeBtn:        '.like-wrapper',
  collectBtn:     '.collect-wrapper',
  commentArea:    '.comment-container, .comments-container',
  commentInput:   '.content-input',           // contenteditable
  commentSubmit:  '.btn-send',
  commentPlaceholder: '说点什么...',
};

// ─── helpers ──────────────────────────────────────────────────────────────────

interface Note { title: string; author: string; likes: string; link: string }

function parseNotes(raw: string): Note[] {
  try { return JSON.parse(raw) as Note[]; } catch { return []; }
}

const NOTE_COLUMNS = [
  { key: 'index',  header: '#',   width: 3  },
  { key: 'title',  header: '标题', width: 36 },
  { key: 'author', header: '作者', width: 16 },
  { key: 'likes',  header: '点赞', width: 8  },
  { key: 'link',   header: '链接', width: 48 },
];

const SCRAPE_NOTES = `
(function() {
  const r = [];
  document.querySelectorAll('${SEL.noteItem}').forEach(el => {
    const title  = el.querySelector('${SEL.noteTitle}')?.textContent?.trim() ?? '';
    const author = el.querySelector('${SEL.noteAuthor}')?.textContent?.trim() ?? '';
    const likes  = el.querySelector('${SEL.noteLikes}')?.textContent?.trim() ?? '';
    const href   = el.querySelector('a')?.href ?? '';
    if (title) r.push({ title, author, likes, link: href.split('?')[0] });
  });
  return JSON.stringify(r);
})()`;

// ─── post helpers ─────────────────────────────────────────────────────────────

function parsePostArgs(args: string[]): { title: string; content: string; images: string[] } {
  let title = '', content = '', images: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--title')   { title   = args[++i] ?? ''; continue; }
    if (args[i] === '--content') { content = args[++i] ?? ''; continue; }
    if (args[i] === '--images')  {
      images = (args[++i] ?? '').split(',').map(p => path.resolve(p)).filter(p => fs.existsSync(p));
      continue;
    }
  }
  return { title, content, images };
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class XiaohongshuAdapter extends Adapter {
  platform = 'xiaohongshu';
  loginUrl  = 'https://www.xiaohongshu.com';

  async isLoggedIn(client: CDPClient): Promise<boolean> {
    const cookies = await client.getAllCookies();
    return cookies.some(c => c.name === 'web_session');
  }

  commands = {

    // ── search ────────────────────────────────────────────────────────────────
    search: async (client: CDPClient, args: string[]): Promise<CommandResult> => {
      const keyword = args[0];
      if (!keyword) throw new Error('用法: xhs search <关键词>');
      const url = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_explore_feed`;
      await client.navigate(url, 4000);
      const raw = await client.eval<string>(SCRAPE_NOTES);
      const notes = parseNotes(raw);
      return { columns: NOTE_COLUMNS, rows: notes.map((n, i) => ({ index: i + 1, ...n })) };
    },

    // ── hot ───────────────────────────────────────────────────────────────────
    hot: async (client: CDPClient): Promise<CommandResult> => {
      await client.navigate('https://www.xiaohongshu.com/explore', 4000);
      const raw = await client.eval<string>(SCRAPE_NOTES);
      const notes = parseNotes(raw);
      return { columns: NOTE_COLUMNS, rows: notes.map((n, i) => ({ index: i + 1, ...n })) };
    },

    // ── like ──────────────────────────────────────────────────────────────────
    like: async (client: CDPClient, args: string[]): Promise<CommandResult> => {
      const url = args[0];
      if (!url) throw new Error('用法: xhs like <笔记URL>');

      await client.navigate(url, 4000);

      const result = await client.eval<string>(`
        (function() {
          var btn = document.querySelector('.like-wrapper');
          if (!btn) return JSON.stringify({ok: false, reason: 'like button not found'});
          var wasLiked = btn.classList.contains('like-active');
          btn.click();
          var isLiked = btn.classList.contains('like-active');
          var count = btn.querySelector('.count') ? btn.querySelector('.count').textContent.trim() : '?';
          return JSON.stringify({ok: true, wasLiked: wasLiked, isLiked: isLiked, count: count});
        })()
      `);
      const r = JSON.parse(result as string) as { ok: boolean; wasLiked: boolean; isLiked: boolean; count: string; reason?: string };

      if (!r.ok) throw new Error(r.reason ?? '点赞失败');

      const action = r.wasLiked ? '取消点赞' : '点赞成功';
      const status = r.isLiked ? '❤️  已点赞' : '🤍 未点赞';

      return {
        columns: [
          { key: 'field', header: '字段', width: 12 },
          { key: 'value', header: '值',   width: 40 },
        ],
        rows: [
          { field: '操作', value: action },
          { field: '状态', value: status },
          { field: '点赞数', value: r.count },
          { field: '链接', value: url },
        ],
      };
    },

    // ── comment ───────────────────────────────────────────────────────────────
    comment: async (client: CDPClient, args: string[]): Promise<CommandResult> => {
      const url    = args[0];
      const text   = args[1];
      if (!url || !text) throw new Error('用法: xhs comment <笔记URL> <评论内容>');

      await client.navigate(url, 4000);

      // 1. 点击「说点什么...」激活输入框
      await client.eval<void>(`
        (function() {
          var placeholder = [...document.querySelectorAll('*')].find(function(e) {
            return e.textContent.trim() === '说点什么...' && e.children.length === 0;
          });
          if (placeholder) placeholder.click();
        })()
      `);
      await sleep(800);

      // 2. 写入评论内容（用 execCommand 兼容 contenteditable）
      await client.eval<void>(`
        (function() {
          var editor = document.querySelector('.content-input');
          if (!editor) return;
          editor.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, ${JSON.stringify(text)});
        })()
      `);
      await sleep(500);

      // 3. 验证内容已写入
      const inputText = await client.eval<string>(`
        (document.querySelector('.content-input') || {}).textContent || ''
      `);
      console.log(`  ✏️  输入内容: "${inputText}"`);

      // 4. 点击发送
      const sent = await client.eval<boolean>(`
        (function() {
          var btn = document.querySelector('.btn-send');
          if (!btn) {
            var btns = [...document.querySelectorAll('button')];
            btn = btns.find(function(b) { return b.textContent.trim() === '发送'; });
          }
          if (btn && !btn.disabled) { btn.click(); return true; }
          return false;
        })()
      `);

      if (!sent) throw new Error('发送按钮未找到或被禁用（评论内容可能为空）');
      await sleep(1500);

      // 5. 验证：新评论是否出现在列表里
      const appeared = await client.eval<boolean>(`
        (function() {
          var comments = [...document.querySelectorAll('.comment-item, [class*=comment-item]')];
          return comments.some(function(c) { return c.textContent.includes(${JSON.stringify(text.slice(0, 10))}); });
        })()
      `);

      return {
        columns: [
          { key: 'field', header: '字段', width: 12 },
          { key: 'value', header: '值',   width: 50 },
        ],
        rows: [
          { field: '状态',   value: appeared ? '✅ 评论成功' : '⚠️  请在浏览器中确认' },
          { field: '评论内容', value: text },
          { field: '链接',   value: url },
        ],
      };
    },

    // ── post ──────────────────────────────────────────────────────────────────
    post: async (client: CDPClient, args: string[]): Promise<CommandResult> => {
      const { title, content, images } = parsePostArgs(args);
      if (!title && !content) throw new Error('用法: xhs post --title <标题> --content <内容> [--images <图片路径>]');

      // 1. 导航到发布页
      await client.navigate('https://creator.xiaohongshu.com/publish/publish?source=official', 3000);

      // 2. 切换到「上传图文」tab
      await client.eval<void>(`
        (function() {
          const els = [...document.querySelectorAll('*')].filter(e =>
            e.textContent.trim() === '上传图文' && e.children.length === 0
          );
          if (els.length >= 2) els[1].click();
          else if (els.length === 1) els[0].click();
        })()
      `);
      await sleep(1500);

      // 3. 上传图片（如果有）
      if (images.length > 0) {
        await client.uploadFiles('input[type=file][accept*=jpg]', images);
        console.log(`  📎 上传图片: ${images.join(', ')}`);
        await sleep(4000); // 等待图片上传完成
      } else {
        // 没有图片时，小红书要求至少一张图，用「文字配图」模式
        await client.eval<void>(`
          (function() {
            const el = [...document.querySelectorAll('*')].find(e =>
              e.textContent.trim() === '文字配图' && e.children.length === 0
            );
            if (el) el.click();
          })()
        `);
        await sleep(2000);
      }

      // 4. 填写标题
      if (title) {
        await client.eval<void>(`
          (function() {
            const input = document.querySelector('input.d-text[placeholder*="标题"]');
            if (!input) return;
            input.focus();
            const nativeInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
            nativeInput.set.call(input, ${JSON.stringify(title)});
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          })()
        `);
        await sleep(500);
        console.log(`  ✏️  标题: ${title}`);
      }

      // 5. 填写正文
      if (content) {
        await client.eval<void>(`
          (function() {
            const editor = document.querySelector('.tiptap.ProseMirror');
            if (!editor) return;
            editor.focus();
            // 清空并输入内容
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, ${JSON.stringify(content)});
          })()
        `);
        await sleep(500);
        console.log(`  📝 正文: ${content.slice(0, 50)}${content.length > 50 ? '...' : ''}`);
      }

      await sleep(1000);

      // 6. 点击发布
      const clicked = await client.eval<boolean>(`
        (function() {
          const btns = [...document.querySelectorAll('button')];
          const btn = btns.reverse().find(b => b.textContent.trim() === '发布');
          if (btn && !btn.disabled) { btn.click(); return true; }
          return false;
        })()
      `);

      if (!clicked) throw new Error('未找到发布按钮，或按钮不可点击（可能图片还在上传中）');

      await sleep(2000);

      // 7. 检查是否发布成功
      const result = await client.eval<string>(`
        JSON.stringify({
          url: location.href,
          toast: document.querySelector('[class*=toast],[class*=message],[class*=notice]')?.textContent?.trim() ?? ''
        })
      `);
      const { url, toast } = JSON.parse(result as string) as { url: string; toast: string };

      const success = url.includes('manage') || url.includes('success') || !url.includes('publish');
      const status = success ? '✅ 发布成功' : '⚠️  请在浏览器中确认';

      return {
        columns: [
          { key: 'field', header: '字段', width: 12 },
          { key: 'value', header: '值',   width: 60 },
        ],
        rows: [
          { field: '状态',   value: status },
          { field: '标题',   value: title   || '（无）' },
          { field: '正文',   value: content.slice(0, 60) || '（无）' },
          { field: '图片',   value: images.length > 0 ? `${images.length} 张` : '（无）' },
          { field: '当前URL', value: url },
          { field: '提示',   value: toast   || '（无）' },
        ],
      };
    },
  };
}
