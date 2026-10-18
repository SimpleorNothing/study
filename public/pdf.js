/* A4 문제지 + 정답·해설 페이지를 만들고 PDF 한 파일로 묶습니다. */
(function () {
  const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
  const PAGE_SCALE = 2; // 794px → 1588px (약 190dpi)

  function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /** 줄바꿈과 $LaTeX$ 수식을 렌더링합니다. */
  function rich(el, text) {
    el.innerHTML = esc(text).replace(/\r?\n/g, '<br>');
    if (window.renderMathInElement) {
      window.renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true },
        ],
        throwOnError: false,
      });
    }
    return el;
  }

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function stripChoiceMark(s) {
    return String(s).replace(/^\s*(?:[①-⑳]|\(?[1-9]\)|[1-9][.)]|[A-Ea-e][.)])\s*/, '');
  }

  function visualLen(s) {
    return String(s).replace(/\$[^$]*\$/g, (m) => 'x'.repeat(Math.ceil(m.length / 2.5))).length;
  }

  function choiceColumns(choices) {
    const n = choices.length;
    const max = Math.max(...choices.map(visualLen));
    if (n === 5) return max <= 8 ? 5 : max <= 18 ? 3 : 1;
    if (n === 4) return max <= 10 ? 4 : max <= 24 ? 2 : 1;
    return max <= 12 ? n : 1;
  }

  /* ---------------------------------------------------------------- */
  /* 블록 만들기                                                        */
  /* ---------------------------------------------------------------- */

  function titleBlock(meta, total, kind) {
    const wrap = h('div');
    const box = h('div', 'ws-title');
    const left = h('div');
    const h1 = h('h1');
    h1.innerHTML = kind === 'answer' ? '정답 및 <span>해설</span>' : '오답 <span>변형문제</span>';
    left.append(h1);
    const metaLine = [meta.subject, meta.grade, meta.name && `${meta.name}`, meta.date].filter(Boolean).join('  ·  ');
    left.append(h('div', 'meta', metaLine));
    box.append(left);
    const score = h('div', 'score');
    if (kind === 'answer') {
      score.innerHTML = `총 문항<b>${total}</b>`;
    } else {
      score.innerHTML = `맞힌 개수<b>&nbsp;&nbsp;&nbsp;&nbsp;/ ${total}</b>`;
    }
    box.append(score);
    wrap.append(box);
    if (kind !== 'answer') {
      wrap.append(
        h('div', 'ws-guide',
          '틀렸던 문제마다 5문항씩: ① ② 쌍둥이 → ③ 개념 확인 → ④ 실수 정조준 → ⑤ 한 단계 응용 순서예요. ' +
          '앞 문제부터 차근차근 풀고, 다 푼 뒤에 정답지로 채점하세요.'),
      );
      wrap.style.display = 'grid';
      wrap.style.gap = '10px';
    }
    return wrap;
  }

  function groupHeader(g) {
    const e = h('div', 'ws-group');
    e.innerHTML = `<b>원문항 ${esc(g.orig.number)}번</b><span>${esc(g.orig.concept || '')}</span>`;
    return e;
  }

  function questionBlock(v, num, subject) {
    const q = h('div', 'ws-q');
    q.append(h('div', 'num', String(num)));
    const body = h('div');
    const line = h('div', 'qtext');
    const tag = h('span', 'tag', v.type || '');
    const text = h('span');
    rich(text, v.question);
    line.append(tag, text);
    body.append(line);

    const choices = (v.choices || []).map(stripChoiceMark).filter(Boolean);
    if (choices.length >= 2) {
      const grid = h('div', 'ws-choices');
      grid.style.gridTemplateColumns = `repeat(${choiceColumns(choices)}, 1fr)`;
      choices.forEach((c, i) => {
        const cell = h('div');
        cell.append(h('span', 'm', CIRCLED[i] || `${i + 1})`));
        cell.append(rich(h('span'), c));
        grid.append(cell);
      });
      body.append(grid);
      if (subject === '수학' || subject === '과학') body.append(h('div', 'ws-work'));
    } else {
      body.append(h('div', `ws-work${subject === '수학' || subject === '과학' ? ' math' : ''}`));
      const al = h('div', 'ws-ansline');
      al.innerHTML = '답<i></i>';
      body.append(al);
    }
    q.append(body);
    return q;
  }

  function quickTable(answers) {
    const table = h('table', 'ws-quick');
    for (let i = 0; i < answers.length; i += 10) {
      const trh = h('tr');
      const trd = h('tr');
      for (let j = i; j < i + 10; j++) {
        trh.append(h('th', null, j < answers.length ? String(j + 1) : ''));
        const td = h('td');
        if (j < answers.length) {
          const a = answers[j];
          rich(td, visualLen(a) > 14 ? '해설 참고' : a);
        }
        trd.append(td);
      }
      table.append(trh, trd);
    }
    return table;
  }

  function origBlock(g) {
    const o = g.orig;
    const box = h('div', 'ws-orig');
    box.append(h('div', 'h', `원문항 ${o.number}번 다시 보기 · ${o.concept || ''}`));
    box.append(rich(h('div', 't'), o.problem_text));
    if (o.figure_description) box.append(rich(h('div', 'fig'), `(그림) ${o.figure_description}`));
    const a = h('div', 'a');
    a.innerHTML = '내 답 ';
    const s = h('s');
    rich(s, o.student_answer || '(빈칸)');
    a.append(s);
    a.append(document.createTextNode('   →   정답 '));
    a.append(rich(h('b'), o.correct_answer || '-'));
    box.append(a);
    if (g.diagnosis) box.append(rich(h('div', 'dx'), g.diagnosis));
    if (g.key_point) box.append(rich(h('div', 'kp'), `기억할 것: ${g.key_point}`));
    return box;
  }

  function solutionBlock(v, num) {
    const s = h('div', 'ws-sol');
    s.append(h('div', 'num', String(num)));
    const body = h('div');
    const ans = h('div');
    ans.append(h('span', null, '정답  '));
    ans.append(rich(h('span', 'ans'), v.answer));
    body.append(ans);
    if (v.explanation) body.append(rich(h('div', 'ex'), v.explanation));
    s.append(body);
    return s;
  }

  /* ---------------------------------------------------------------- */
  /* 페이지 나누기                                                      */
  /* ---------------------------------------------------------------- */

  function makePage(root, meta, sectionLabel) {
    const page = h('div', 'ws-page');
    const head = h('div', 'ws-head');
    const who = ['오답 변형문제', meta.subject, meta.grade, meta.name].filter(Boolean).join(' · ');
    head.innerHTML = `<span><b>${esc(who)}</b></span><span class="sec">${esc(sectionLabel)}</span>`;
    const body = h('div', 'ws-body');
    const foot = h('div', 'ws-foot', '- 0 / 0 -'); // 높이 확보용 자리표시
    page.append(head, body, foot);
    root.append(page);
    return { page, body, foot };
  }

  // 캡처 시 미세한 줄 높이 차이를 흡수하도록 아래쪽 8px 여유를 둡니다.
  function overflows(body) {
    const last = body.lastElementChild;
    if (!last) return false;
    const bottom = last.getBoundingClientRect().bottom - body.getBoundingClientRect().top;
    return bottom > body.clientHeight - 8;
  }

  function shrinkToFit(block, body) {
    for (const f of [0.92, 0.85, 0.78, 0.72, 0.66]) {
      if (!overflows(body)) return;
      block.style.fontSize = `${f}em`;
    }
  }

  async function waitFonts() {
    if (!document.fonts) return;
    const loads = ['400', '700', '900'].flatMap((w) => [
      document.fonts.load(`${w} 16px "Noto Serif KR"`, '가나다'),
      document.fonts.load(`${w} 16px "Noto Sans KR"`, '가나다'),
    ]);
    await Promise.race([Promise.allSettled(loads), new Promise((r) => setTimeout(r, 4000))]);
    await document.fonts.ready;
  }

  async function paginate(root, meta, sections) {
    // 1) 전부 한 번 붙여서 KaTeX 글꼴까지 불러오게 한 뒤
    const scratch = makePage(root, meta, '');
    sections.forEach((s) => s.blocks.forEach((b) => scratch.body.append(b)));
    await waitFonts();
    await new Promise((r) => setTimeout(r, 60));
    scratch.page.remove();

    // 2) 실제 페이지로 흘려 넣기 — 늦게 도착한 글꼴로 줄바꿈이 바뀌면 다시 흘림
    let pages = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      pages.forEach((p) => p.page.remove());
      pages = flow(root, meta, sections);
      await document.fonts?.ready;
      await new Promise((r) => setTimeout(r, 120));
      if (!pages.some((p) => p.body.children.length > 1 && overflows(p.body))) break;
    }
    pages.forEach((p, i) => (p.foot.textContent = `- ${i + 1} / ${pages.length} -`));
    return pages;
  }

  function flow(root, meta, sections) {
    const pages = [];
    for (const sec of sections) {
      let cur = makePage(root, meta, sec.label);
      pages.push(cur);
      for (const block of sec.blocks) {
        block.style.fontSize = '';
        cur.body.append(block);
        if (!overflows(cur.body)) continue;
        if (cur.body.children.length > 1) {
          block.remove();
          cur = makePage(root, meta, sec.label);
          pages.push(cur);
          cur.body.append(block);
        }
        shrinkToFit(block, cur.body);
      }
    }
    return pages;
  }

  /* ---------------------------------------------------------------- */
  /* 공개 API                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * doc = { meta:{subject,grade,name,date}, groups:[{orig, diagnosis, key_point, variants:[5]}] }
   * onProgress(done, total) — 페이지 이미지화 진행률
   * returns [jpeg dataURL, ...]
   */
  async function render(doc, onProgress) {
    const root = document.getElementById('render-root');
    root.innerHTML = '';
    const { meta, groups } = doc;
    const subject = meta.subject;
    const total = groups.reduce((n, g) => n + g.variants.length, 0);

    // 문제지
    const qBlocks = [titleBlock(meta, total, 'question')];
    let n = 0;
    groups.forEach((g) => {
      g.variants.forEach((v, i) => {
        n += 1;
        const qb = questionBlock(v, n, subject);
        if (i === 0) {
          const unit = h('div');
          unit.style.display = 'grid';
          unit.style.gap = '10px';
          unit.append(groupHeader(g), qb);
          qBlocks.push(unit);
        } else {
          qBlocks.push(qb);
        }
      });
    });

    // 정답 및 해설
    const answers = groups.flatMap((g) => g.variants.map((v) => v.answer));
    const aHead = titleBlock(meta, total, 'answer');
    aHead.style.display = 'grid';
    aHead.style.gap = '12px';
    aHead.append(quickTable(answers));
    const aBlocks = [aHead];
    n = 0;
    groups.forEach((g) => {
      aBlocks.push(origBlock(g));
      g.variants.forEach((v) => {
        n += 1;
        aBlocks.push(solutionBlock(v, n));
      });
    });

    const pages = await paginate(root, meta, [
      { label: '문제지', blocks: qBlocks },
      { label: '정답 및 해설', blocks: aBlocks },
    ]);

    const images = [];
    for (let i = 0; i < pages.length; i++) {
      const canvas = await window.html2canvas(pages[i].page, {
        scale: PAGE_SCALE,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true,
        scrollX: 0,
        scrollY: 0,
        windowWidth: 1200,
      });
      images.push(canvas.toDataURL('image/jpeg', 0.9));
      canvas.width = canvas.height = 0;
      onProgress && onProgress(i + 1, pages.length);
    }
    root.innerHTML = '';
    return images;
  }

  function toPdf(images, filename) {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    images.forEach((img, i) => {
      if (i) pdf.addPage('a4', 'portrait');
      pdf.addImage(img, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    });
    pdf.setProperties({ title: filename.replace(/\.pdf$/, ''), creator: 'study.simpleornothing.com' });
    pdf.save(filename);
  }

  window.Worksheet = { render, toPdf, rich, esc };
})();
