import { connectTab } from '../browser/cdp.js';

const client = await connectTab(9222);
await client.send('Page.bringToFront');
await new Promise(r => setTimeout(r, 300));

// Deep focus into bili-comments shadow DOM
const focused = await client.eval<string>(`(function(){
  var host = document.querySelector("bili-comments");
  if(!host) return "no bili-comments";
  function deepFocus(root){
    var sr = root.shadowRoot;
    if(!sr) return null;
    var editor = sr.querySelector(".brt-editor");
    if(editor) { editor.click(); editor.focus(); return "ok"; }
    var els = sr.querySelectorAll("*");
    for(var i=0; i<els.length; i++){
      var r = deepFocus(els[i]);
      if(r) return r;
    }
    return null;
  }
  return deepFocus(host) || "not found";
})()`);
console.log('focus result:', focused);

await new Promise(r => setTimeout(r, 500));

// Try Input.insertText
await client.send('Input.insertText', { text: 'hello shadow insertText' });
await new Promise(r => setTimeout(r, 500));

const content = await client.eval<string>(`(function(){
  var ed = document.querySelector("bili-comments")
    .shadowRoot.querySelector("bili-comments-header-renderer")
    .shadowRoot.querySelector("bili-comment-box")
    .shadowRoot.querySelector("bili-comment-rich-textarea")
    .shadowRoot.querySelector(".brt-editor");
  return ed ? JSON.stringify({ text: ed.textContent.trim(), html: ed.innerHTML.slice(0,100) }) : "not found";
})()`);
console.log('editor content:', content);

client.close();
