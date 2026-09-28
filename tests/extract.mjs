// 从 Scriptable 脚本里取出要注入到 WebView 的那段代码（magicScript 模板字符串）
import fs from 'fs';

export function extractInjected(path) {
  const src = fs.readFileSync(path, 'utf8');
  const start = src.indexOf('const magicScript = `');
  if (start < 0) throw new Error('找不到 magicScript: ' + path);
  const end = src.indexOf('`;', start + 25);
  const tpl = src.slice(start + 'const magicScript = '.length, end + 1);
  const m = src.match(/const VERSION = '([^']+)'/);
  // 用外层的 VERSION 展开模板里的 ${VERSION}
  return new Function('VERSION', 'return ' + tpl)(m ? m[1] : 'unknown');
}

export function checkOuterSyntax(path) {
  const src = fs.readFileSync(path, 'utf8');
  // Scriptable 会把脚本包在 async 函数里执行（允许顶层 await）
  new Function('return (async () => {' + src + '\n})');
}
