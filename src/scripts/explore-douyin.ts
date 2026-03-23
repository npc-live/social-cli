import { connectTab } from '../browser/cdp.js';

const client = await connectTab(9222);
await client.send('Page.bringToFront');
await new Promise(r => setTimeout(r, 200));

// Get follow button (JbfEzak6) coordinates
const coords = await client.eval<string>(`(function(){
  var el = document.querySelector('.JbfEzak6');
  if(!el) return 'null';
  var r = el.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) });
})()`);
console.log('follow btn coords:', coords);

// check current state by checking parent avatar area
const beforeInfo = await client.eval<string>(`JSON.stringify({
  JbfEzak6Count: document.querySelectorAll('.JbfEzak6').length,
  hasFollowedState: document.body.innerHTML.includes('已关注')
})`);
console.log('before:', JSON.parse(beforeInfo));

const { x, y } = JSON.parse(coords);
await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
await new Promise(r => setTimeout(r, 2000));

const afterInfo = await client.eval<string>(`JSON.stringify({
  JbfEzak6Count: document.querySelectorAll('.JbfEzak6').length,
  hasFollowedState: document.body.innerHTML.includes('已关注'),
  bodySnippet: [...document.querySelectorAll('[class*=follow]')].map(function(el){ return el.className.slice(0,60) + ':' + el.textContent.trim().slice(0,20); }).join(' | ')
})`);
console.log('after:', JSON.parse(afterInfo));

client.close();
