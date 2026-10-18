// node_modules의 브라우저 라이브러리를 public/vendor로 복사합니다. (라이브러리 버전 올릴 때만 실행)
import { cpSync, mkdirSync, readdirSync } from 'node:fs';

const nm = 'node_modules';
const out = 'public/vendor';
mkdirSync(`${out}/katex/fonts`, { recursive: true });
mkdirSync(`${out}/katex/contrib`, { recursive: true });

cpSync(`${nm}/html2canvas/dist/html2canvas.min.js`, `${out}/html2canvas.min.js`);
cpSync(`${nm}/jspdf/dist/jspdf.umd.min.js`, `${out}/jspdf.umd.min.js`);
cpSync(`${nm}/katex/dist/katex.min.js`, `${out}/katex/katex.min.js`);
cpSync(`${nm}/katex/dist/katex.min.css`, `${out}/katex/katex.min.css`);
cpSync(`${nm}/katex/dist/contrib/auto-render.min.js`, `${out}/katex/contrib/auto-render.min.js`);
for (const f of readdirSync(`${nm}/katex/dist/fonts`)) {
  if (f.endsWith('.woff2')) cpSync(`${nm}/katex/dist/fonts/${f}`, `${out}/katex/fonts/${f}`);
}
console.log('vendor files copied →', out);
