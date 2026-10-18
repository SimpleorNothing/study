/* 다시풀기 — 화면 흐름: 올리기 → 오답 확인 → 변형문제 생성 → PDF */
(function () {
  const $ = (s) => document.querySelector(s);
  const { rich, esc } = window.Worksheet;

  const MAX_SIDE = 1800;
  const MAX_FILES = 12;
  const MAX_PDF_BYTES = 20 * 1024 * 1024;
  const CONCURRENCY = 3;
  const LS_CODE = 'study:code';
  const LS_LAST = 'study:last';

  const STATUS_LABEL = { wrong: '오답', correct: '정답', unanswered: '빈칸', unclear: '확인 필요' };

  const state = {
    subject: '수학',
    files: [],
    analysis: null,
    meta: null,
    selected: new Set(),
    jobs: [],
    images: null,
    doc: null,
    demo: false,
    config: { requiresCode: false, ready: true },
  };

  /* ---------------- storage (실패해도 동작) ---------------- */
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  /* ---------------- 화면 전환 ---------------- */
  function show(step) {
    ['upload', 'review', 'result'].forEach((s, i, all) => {
      $(`#step-${s}`).hidden = s !== step;
      const li = document.querySelector(`.steps li[data-step="${s}"]`);
      li.classList.toggle('on', s === step);
      li.classList.toggle('done', all.indexOf(step) > i);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function banner(msg, type = 'error') {
    const b = $('#banner');
    if (!msg) { b.hidden = true; return; }
    b.textContent = msg;
    b.className = `banner ${type === 'error' ? 'error' : ''}`;
    b.hidden = false;
    b.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function busy(on, text, sub) {
    $('#busy').hidden = !on;
    if (text) $('#busy-text').textContent = text;
    if (sub !== undefined) $('#busy-sub').textContent = sub;
  }

  /* ---------------- API ---------------- */
  async function api(path, body) {
    for (let tries = 0; tries < 3; tries++) {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-access-code': store.get(LS_CODE) || '' },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        store.del(LS_CODE);
        const ok = await askCode(tries > 0 ? '코드가 맞지 않아요. 다시 입력해 주세요.' : '');
        if (!ok) throw new Error('접속 코드가 필요해요.');
        continue;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `서버 오류 (${res.status})`);
      return data;
    }
    throw new Error('접속 코드가 맞지 않아요.');
  }

  function askCode(errorText) {
    return new Promise((resolve) => {
      const dlg = $('#code-dialog');
      const err = $('#code-error');
      err.textContent = errorText || '';
      err.hidden = !errorText;
      $('#code-input').value = '';
      const done = () => {
        dlg.removeEventListener('close', done);
        const v = $('#code-input').value.trim();
        if (dlg.returnValue === 'ok' && v) { store.set(LS_CODE, v); resolve(true); } else resolve(false);
      };
      dlg.addEventListener('close', done);
      dlg.showModal();
    });
  }

  /* ---------------- 파일 ---------------- */
  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  async function compressImage(file) {
    let bmp;
    try {
      bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      bmp = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('unreadable'));
        img.src = URL.createObjectURL(file);
      });
    }
    const w = bmp.width;
    const hgt = bmp.height;
    const k = Math.min(1, MAX_SIDE / Math.max(w, hgt));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * k);
    canvas.height = Math.round(hgt * k);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { media_type: 'image/jpeg', data: dataUrl.split(',')[1], thumb: dataUrl };
  }

  async function addFiles(list) {
    banner(null);
    const files = Array.from(list || []);
    for (const f of files) {
      if (state.files.length >= MAX_FILES) { banner(`한 번에 ${MAX_FILES}장까지 올릴 수 있어요.`); break; }
      try {
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
          if (f.size > MAX_PDF_BYTES) { banner(`${f.name}: PDF는 20MB까지 올릴 수 있어요.`); continue; }
          const data = await readAsBase64(f);
          state.files.push({ id: crypto.randomUUID(), name: f.name, media_type: 'application/pdf', data, thumb: null });
        } else {
          const img = await compressImage(f);
          state.files.push({ id: crypto.randomUUID(), name: f.name, ...img });
        }
      } catch {
        banner(`${f.name}: 이 파일은 읽을 수 없어요. HEIC 사진이라면 JPG로 바꾸거나 휴대폰에서 바로 올려 주세요.`);
      }
    }
    renderThumbs();
  }

  function renderThumbs() {
    const ul = $('#thumbs');
    ul.innerHTML = '';
    state.files.forEach((f, i) => {
      const li = document.createElement('li');
      li.innerHTML = f.thumb
        ? `<img alt="" src="${f.thumb}">`
        : `<div class="pdf">PDF<br><small>${esc(f.name)}</small></div>`;
      li.insertAdjacentHTML('beforeend', `<span class="idx">${i + 1}</span><button class="x" type="button" aria-label="삭제">×</button>`);
      li.querySelector('.x').onclick = () => { state.files.splice(i, 1); renderThumbs(); };
      ul.append(li);
    });
    $('#btn-analyze').disabled = state.files.length === 0;
  }

  /* ---------------- 1 → 2 : 채점 ---------------- */
  async function runAnalyze() {
    banner(null);
    state.demo = false;
    state.meta = {
      subject: state.subject,
      grade: $('#grade').value,
      name: $('#name').value.trim(),
    };
    busy(true, '문제지를 채점하는 중…', '사진 장수에 따라 30초~1분 정도 걸려요');
    try {
      const res = await api('/api/analyze', {
        ...state.meta,
        note: $('#note').value.trim(),
        files: state.files.map(({ media_type, data }) => ({ media_type, data })),
      });
      if (!res.problems || !res.problems.length) throw new Error('문항을 찾지 못했어요. 문제가 잘 보이게 다시 찍어 주세요.');
      state.analysis = res;
      renderReview();
      show('review');
    } catch (e) {
      banner(e.message);
    } finally {
      busy(false);
    }
  }

  function startDemo() {
    banner(null);
    state.demo = true;
    state.meta = { ...window.DEMO.meta };
    state.analysis = JSON.parse(JSON.stringify(window.DEMO.analysis));
    renderReview();
    show('review');
  }

  function renderReview() {
    const a = state.analysis;
    const probs = a.problems;
    state.selected = new Set(probs.filter((p) => p.status === 'wrong' || p.status === 'unanswered').map((p) => p.number));
    const wrong = probs.filter((p) => p.status === 'wrong').length;
    $('#review-summary').textContent =
      `${state.meta.subject} · ${state.meta.grade}  —  총 ${probs.length}문항 중 오답 ${wrong}개` +
      (state.demo ? '  (예시 데이터)' : '');
    $('#overall-note').hidden = !a.overall_note;
    $('#overall-note').textContent = a.overall_note || '';

    const ul = $('#problem-list');
    ul.innerHTML = '';
    probs.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'pitem';
      const id = `p-${p.number}-${Math.random().toString(36).slice(2, 7)}`;
      li.innerHTML = `
        <input type="checkbox" id="${id}">
        <div>
          <label class="head" for="${id}">
            <span class="no">${esc(p.number)}번</span>
            <span class="badge ${esc(p.status)}">${STATUS_LABEL[p.status] || p.status}</span>
            <span class="concept">${esc(p.concept)}</span>
          </label>
          <div class="ptext"></div>
          <button type="button" class="link more" hidden>전체 보기</button>
          <div class="ans">
            <span><b>학생 답</b><span class="stu"></span></span>
            <span><b>정답</b><span class="cor"></span></span>
          </div>
          <div class="why"></div>
        </div>`;
      const cb = li.querySelector('input');
      cb.checked = state.selected.has(p.number);
      li.classList.toggle('sel', cb.checked);
      cb.onchange = () => {
        cb.checked ? state.selected.add(p.number) : state.selected.delete(p.number);
        li.classList.toggle('sel', cb.checked);
        updateGenerateBtn();
      };
      const pt = li.querySelector('.ptext');
      rich(pt, p.problem_text + (p.figure_description ? `\n(그림) ${p.figure_description}` : ''));
      rich(li.querySelector('.stu'), p.student_answer || '(빈칸)');
      rich(li.querySelector('.cor'), p.correct_answer || '-');
      rich(li.querySelector('.why'), [p.evidence, p.error_analysis].filter(Boolean).join(' — '));
      ul.append(li);
      requestAnimationFrame(() => {
        if (pt.scrollHeight > pt.clientHeight + 4) {
          const more = li.querySelector('.more');
          more.hidden = false;
          more.onclick = () => { pt.classList.add('open'); more.hidden = true; };
        } else pt.classList.add('open');
      });
    });
    updateGenerateBtn();
  }

  function setSelection(fn) {
    state.selected = new Set(state.analysis.problems.filter(fn).map((p) => p.number));
    document.querySelectorAll('#problem-list .pitem').forEach((li, i) => {
      const p = state.analysis.problems[i];
      const cb = li.querySelector('input');
      cb.checked = state.selected.has(p.number);
      li.classList.toggle('sel', cb.checked);
    });
    updateGenerateBtn();
  }

  function updateGenerateBtn() {
    const n = state.selected.size;
    const btn = $('#btn-generate');
    btn.disabled = n === 0;
    btn.textContent = n ? `변형문제 만들기 (${n}문항 × 5 = ${n * 5}개)` : '변형문제 만들 문항을 골라 주세요';
  }

  /* ---------------- 2 → 3 : 변형문제 ---------------- */
  async function runGenerate() {
    banner(null);
    const picked = state.analysis.problems.filter((p) => state.selected.has(p.number));
    state.jobs = picked.map((p) => ({ problem: p, status: 'wait', result: null, error: '' }));
    state.images = null;
    $('#preview').innerHTML = '';
    $('#result-actions').hidden = true;
    $('#result-title').textContent = '변형문제를 만들고 있어요';
    $('#result-sub').textContent = '문항마다 쌍둥이 2 · 개념 확인 · 실수 정조준 · 한 단계 응용 순서로 만들어요.';
    renderProgress();
    show('result');

    await pool(state.jobs.map((job) => () => runJob(job)), CONCURRENCY);
    await finalize();
  }

  async function runJob(job) {
    job.status = 'run';
    job.error = '';
    renderProgress();
    try {
      if (state.demo) {
        await new Promise((r) => setTimeout(r, 700 + Math.random() * 600));
        const r = window.DEMO.results[job.problem.number];
        if (!r) throw new Error('예시 데이터가 없는 문항이에요.');
        job.result = JSON.parse(JSON.stringify(r));
      } else {
        job.result = await api('/api/generate', {
          subject: state.meta.subject,
          grade: state.meta.grade,
          problem: job.problem,
        });
      }
      job.status = 'ok';
    } catch (e) {
      job.status = 'err';
      job.error = e.message;
    }
    renderProgress();
  }

  async function pool(tasks, n) {
    let i = 0;
    const workers = Array.from({ length: Math.min(n, tasks.length) }, async () => {
      while (i < tasks.length) await tasks[i++]();
    });
    await Promise.all(workers);
  }

  function renderProgress() {
    const ul = $('#progress');
    ul.innerHTML = '';
    state.jobs.forEach((job) => {
      const li = document.createElement('li');
      const label = { wait: '대기 중', run: '만드는 중', ok: '완료', err: job.error }[job.status];
      li.innerHTML = `<span class="st ${job.status}"></span>
        <span class="lbl">원문항 ${esc(job.problem.number)}번 <small>${esc(job.problem.concept || '')}</small></span>
        <span class="muted small">${esc(label)}</span>`;
      if (job.status === 'err') {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'link retry';
        b.textContent = '다시 시도';
        b.onclick = async () => { await runJob(job); await finalize(); };
        li.append(b);
      }
      ul.append(li);
    });
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  }

  async function finalize() {
    if (state.jobs.some((j) => j.status === 'run' || j.status === 'wait')) return;
    const ok = state.jobs.filter((j) => j.status === 'ok');
    const failed = state.jobs.length - ok.length;
    if (!ok.length) {
      $('#result-title').textContent = '변형문제를 만들지 못했어요';
      $('#result-sub').textContent = '아래에서 다시 시도해 주세요.';
      return;
    }
    const doc = {
      meta: { ...state.meta, date: today() },
      groups: ok.map((j) => ({
        orig: j.problem,
        diagnosis: j.result.diagnosis,
        key_point: j.result.key_point,
        variants: j.result.variants,
      })),
    };
    await buildPdf(doc);
    store.set(LS_LAST, JSON.stringify(doc));
    $('#last-run').hidden = false;
    const total = doc.groups.length * 5;
    $('#result-title').textContent = `변형문제 ${total}개가 준비됐어요`;
    $('#result-sub').textContent =
      `문제지와 정답·해설 ${state.images.length}쪽` + (failed ? ` · ${failed}문항은 실패했어요(다시 시도하면 PDF에 추가돼요)` : '');
  }

  async function buildPdf(doc) {
    busy(true, 'PDF 페이지를 그리는 중…', '');
    try {
      state.doc = doc;
      state.images = await window.Worksheet.render(doc, (d, t) => {
        $('#busy-sub').textContent = `${d} / ${t}쪽`;
      });
      const pv = $('#preview');
      pv.innerHTML = '';
      state.images.forEach((src, i) => {
        const fig = document.createElement('figure');
        fig.innerHTML = `<img alt="${i + 1}쪽" src="${src}"><figcaption>${i + 1}쪽</figcaption>`;
        pv.append(fig);
      });
      $('#result-actions').hidden = false;
    } catch (e) {
      banner(`PDF를 만들지 못했어요: ${e.message}`);
    } finally {
      busy(false);
    }
  }

  function fileName(doc) {
    const m = doc.meta;
    const parts = ['오답변형', m.subject, m.grade, m.name, (m.date || today()).replace(/\./g, '')].filter(Boolean);
    return `${parts.join('_').replace(/[\\/:*?"<>|\s]+/g, '')}.pdf`;
  }

  function download() {
    if (!state.images) return;
    window.Worksheet.toPdf(state.images, fileName(state.doc));
  }

  function printPages() {
    if (!state.images) return;
    const root = document.createElement('div');
    root.id = 'print-root';
    root.style.display = 'none';
    state.images.forEach((src) => { const img = new Image(); img.src = src; root.append(img); });
    document.body.append(root);
    const cleanup = () => { root.remove(); window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => window.print(), 100);
  }

  async function redownloadLast() {
    const raw = store.get(LS_LAST);
    if (!raw) return;
    try {
      const doc = JSON.parse(raw);
      state.meta = doc.meta;
      state.jobs = [];
      $('#progress').innerHTML = '';
      $('#result-title').textContent = `지난번 변형문제 (${doc.meta.date || ''})`;
      $('#result-sub').textContent = doc.groups.map((g) => `원문항 ${g.orig.number}번`).join(', ');
      show('result');
      await buildPdf(doc);
    } catch (e) {
      banner('지난 결과를 불러오지 못했어요.');
    }
  }

  /* ---------------- 초기화 ---------------- */
  function bind() {
    document.querySelectorAll('#subjects .chip').forEach((chip) => {
      chip.onclick = () => {
        document.querySelectorAll('#subjects .chip').forEach((c) => c.classList.remove('on'));
        chip.classList.add('on');
        state.subject = chip.dataset.v;
      };
    });

    const drop = $('#drop');
    $('#file').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
    document.addEventListener('paste', (e) => {
      if ($('#step-upload').hidden) return;
      const imgs = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
      if (imgs.length) addFiles(imgs);
    });

    $('#btn-analyze').onclick = runAnalyze;
    $('#btn-demo').onclick = startDemo;
    $('#btn-back').onclick = () => show('upload');
    $('#sel-wrong').onclick = () => setSelection((p) => p.status === 'wrong');
    $('#sel-none').onclick = () => setSelection(() => false);
    $('#btn-generate').onclick = runGenerate;
    $('#btn-download').onclick = download;
    $('#btn-print').onclick = printPages;
    $('#btn-restart').onclick = () => {
      state.files = [];
      renderThumbs();
      $('#note').value = '';
      banner(null);
      show('upload');
    };
    $('#btn-last').onclick = redownloadLast;
    $('#last-run').hidden = !store.get(LS_LAST);
  }

  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) return;
      state.config = await res.json();
      if (!state.config.ready) {
        banner('서버에 AI 키가 아직 설정되지 않았어요. "예시로 먼저 보기"는 지금도 쓸 수 있어요.', 'warn');
      }
    } catch { /* 로컬 정적 미리보기 등 */ }
  }

  bind();
  loadConfig();
  if (new URLSearchParams(location.search).has('demo')) startDemo();
})();
