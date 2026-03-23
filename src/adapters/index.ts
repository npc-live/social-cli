import { XiaohongshuAdapter } from './xiaohongshu.js';
// import { TwitterAdapter }     from './twitter.js';
// import { BilibiliAdapter }    from './bilibili.js';
// import { ZhihuAdapter }       from './zhihu.js';

import type { Adapter } from './base.js';

export const adapters: Record<string, Adapter> = {
  xhs:          new XiaohongshuAdapter(),
  xiaohongshu:  new XiaohongshuAdapter(),
  // twitter:   new TwitterAdapter(),
  // bilibili:  new BilibiliAdapter(),
  // zhihu:     new ZhihuAdapter(),
};
