import { newTab } from '../browser/cdp.js';

const client = await newTab(9222);
await client.navigate('https://x.com/search?q=AI+law&src=typed_query&f=top', 4000);

const info = await client.eval<string>(`JSON.stringify({
  url: location.href,
  tweetItems: (() => {
    var tweets = [...document.querySelectorAll('[data-testid="tweet"]')];
    return tweets.slice(0,3).map(function(t){
      return {
        text: t.querySelector('[data-testid="tweetText"]')?.textContent?.trim()?.slice(0,60) || '',
        user: t.querySelector('[data-testid="User-Name"]')?.textContent?.trim()?.slice(0,30) || '',
        link: (() => {
          var a = [...t.querySelectorAll('a')].find(function(a){ return /\\/status\\//.test(a.href); });
          return a ? a.href : '';
        })(),
        time: t.querySelector('time')?.getAttribute('datetime') || ''
      };
    });
  })()
})`);

const d = JSON.parse(info);
console.log('URL:', d.url);
console.log('\n搜索结果结构:');
d.tweetItems.forEach((t: Record<string, string>, i: number) => {
  console.log(`\n[${i+1}]`);
  console.log('  text:', t.text);
  console.log('  user:', t.user);
  console.log('  link:', t.link);
  console.log('  time:', t.time);
});

client.close();
