/**
 * study.simpleornothing.com — 오답 변형문제 생성기
 *
 *  GET  /api/config    → { requiresCode, ready, model }
 *  POST /api/analyze   → 푼 문제 사진/PDF를 읽어 문항별 정오 판정
 *  POST /api/generate  → 틀린 문항 1개에 대해 변형문제 5개 생성
 *
 * 정적 파일(public/)은 Workers Static Assets가 서빙합니다.
 * Secrets: ANTHROPIC_API_KEY (필수), ACCESS_CODE (선택: 설정 시 접속 코드 필요)
 * Vars:    MODEL (기본 claude-sonnet-5-5)
 */

const DEFAULT_MODEL = 'claude-sonnet-5-5';
const MAX_BODY_BYTES = 30 * 1024 * 1024;
const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        const status = err.status || 500;
        return json({ error: err.message || String(err) }, status);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request, env, url) {
  const path = url.pathname;

  if (path === '/api/config' && request.method === 'GET') {
    return json({
      requiresCode: Boolean(env.ACCESS_CODE),
      ready: Boolean(env.ANTHROPIC_API_KEY),
      model: env.MODEL || DEFAULT_MODEL,
    });
  }

  if (request.method !== 'POST') throw httpError(405, '지원하지 않는 요청입니다.');
  await checkAccess(request, env);
  if (!env.ANTHROPIC_API_KEY) throw httpError(500, '서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다.');

  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY_BYTES) throw httpError(413, '파일이 너무 큽니다. 사진 장수를 줄여 주세요.');
  const body = await request.json().catch(() => {
    throw httpError(400, '요청 형식이 올바르지 않습니다.');
  });

  if (path === '/api/analyze') return json(await analyze(body, env));
  if (path === '/api/generate') return json(await generate(body, env));
  throw httpError(404, '없는 API입니다.');
}

/* ------------------------------------------------------------------ */
/* 1) 채점 분석                                                         */
/* ------------------------------------------------------------------ */

const ANALYZE_SYSTEM = `당신은 한국 초·중·고 학생의 숙제와 시험지를 채점하는 꼼꼼한 담임 선생님입니다.
학생이 푼 문제지 사진(또는 PDF)을 보고, 문항마다 내용을 정확히 옮겨 적고 정답/오답을 판정합니다.

판정 규칙
1. 사용자가 준 "채점 메모"(틀린 번호, 정답 등)가 있으면 그것을 가장 우선합니다.
2. 채점 표시가 있으면 따릅니다. 한국식 채점에서 ○(동그라미)는 정답, 빗금(/)·체크(✓, V)·× 표시는 오답인 경우가 대부분입니다.
3. 채점 표시가 없으면 직접 문제를 풀어 정답을 구하고, 학생이 쓴 답과 비교해 판정합니다.
4. 학생 답이 비어 있으면 "unanswered", 사진이 흐리거나 판단 근거가 부족하면 "unclear"로 두고 evidence에 이유를 씁니다.
5. 사진에 보이는 모든 문항을 번호 순서대로 빠짐없이 기록합니다. 다른 사람의 개인정보(이름, 학교)는 옮기지 않습니다.

옮겨 적기 규칙
- problem_text에는 발문·조건·선지를 원문 그대로 적습니다. 선지는 ① ② ③ ④ ⑤ 기호를 살려 줄을 바꿔 적습니다.
- 수식은 LaTeX로 $...$ 안에 씁니다. 예: $\\frac{3}{4}$, $x^2-5x+6=0$
- 그림·도표·그래프가 있으면 figure_description에 문제를 풀 수 있을 만큼 글로 설명합니다.
- 국어·영어처럼 지문이 긴 문항은 지문을 300자 이내로 요약하고, 발문과 선지는 원문대로 적습니다.
- error_analysis에는 학생 답을 근거로 어떤 실수를 했는지 구체적으로 추정합니다(오답일 때만).

반드시 record_grading 도구로 답하세요.`;

const ANALYZE_TOOL = {
  name: 'record_grading',
  description: '문제지 채점 결과를 기록합니다.',
  input_schema: {
    type: 'object',
    properties: {
      detected_subject: { type: 'string', description: '사진으로 판단한 과목' },
      detected_grade: { type: 'string', description: '사진으로 판단한 학년 수준 (예: 중1)' },
      problems: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            number: { type: 'string', description: '문항 번호 (예: "3", "12-2")' },
            problem_text: { type: 'string', description: '발문·선지 전체. 수식은 $LaTeX$' },
            figure_description: { type: 'string', description: '그림/표 설명. 없으면 빈 문자열' },
            question_format: { type: 'string', enum: ['multiple_choice', 'short_answer', 'essay'] },
            choice_count: { type: 'integer', description: '객관식 선지 수. 주관식이면 0' },
            student_answer: { type: 'string', description: '학생이 쓴 답. 없으면 빈 문자열' },
            correct_answer: { type: 'string', description: '정답' },
            status: { type: 'string', enum: ['wrong', 'correct', 'unanswered', 'unclear'] },
            evidence: { type: 'string', description: '판정 근거 (예: "빨간 빗금", "학생 답 -2 ≠ 정답 12")' },
            concept: { type: 'string', description: '핵심 개념 (예: 일차방정식의 이항)' },
            error_analysis: { type: 'string', description: '오답일 때 실수 원인 추정. 아니면 빈 문자열' },
          },
          required: ['number', 'problem_text', 'question_format', 'student_answer', 'correct_answer', 'status', 'evidence', 'concept'],
        },
      },
      overall_note: { type: 'string', description: '보호자에게 전할 한두 문장 총평' },
    },
    required: ['problems'],
  },
};

async function analyze(body, env) {
  const files = Array.isArray(body.files) ? body.files : [];
  if (!files.length) throw httpError(400, '문제 사진이나 PDF를 올려 주세요.');
  if (files.length > 12) throw httpError(400, '한 번에 12장까지 올릴 수 있습니다.');

  const content = [];
  files.forEach((f, i) => {
    if (!ALLOWED_MEDIA.has(f.media_type) || typeof f.data !== 'string') {
      throw httpError(400, `${i + 1}번째 파일 형식을 읽을 수 없습니다. (JPG, PNG, PDF 지원)`);
    }
    content.push({ type: 'text', text: `[${i + 1}번째 페이지]` });
    if (f.media_type === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data } });
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: f.media_type, data: f.data } });
    }
  });

  content.push({
    type: 'text',
    text: [
      `과목: ${clean(body.subject) || '미지정'}`,
      `학년: ${clean(body.grade) || '미지정'}`,
      body.note ? `채점 메모(최우선): ${clean(body.note, 2000)}` : '채점 메모: 없음',
      '',
      '위 문제지를 채점해 record_grading으로 기록해 주세요.',
    ].join('\n'),
  });

  const result = await callClaude(env, {
    system: ANALYZE_SYSTEM,
    content,
    tool: ANALYZE_TOOL,
    maxTokens: 12000,
  });

  const problems = Array.isArray(result.problems) ? result.problems : [];
  return {
    detected_subject: result.detected_subject || '',
    detected_grade: result.detected_grade || '',
    overall_note: result.overall_note || '',
    problems: problems.map((p) => ({
      number: String(p.number ?? ''),
      problem_text: p.problem_text || '',
      figure_description: p.figure_description || '',
      question_format: p.question_format || 'short_answer',
      choice_count: Number(p.choice_count) || 0,
      student_answer: p.student_answer || '',
      correct_answer: p.correct_answer || '',
      status: p.status || 'unclear',
      evidence: p.evidence || '',
      concept: p.concept || '',
      error_analysis: p.error_analysis || '',
    })),
  };
}

/* ------------------------------------------------------------------ */
/* 2) 변형문제 생성                                                     */
/* ------------------------------------------------------------------ */

const GENERATE_SYSTEM = `당신은 학생이 틀린 문제를 "다음에는 맞힐 수 있도록" 변형문제를 출제하는 베테랑 출제 선생님입니다.
원문항 하나에 대해 난이도가 차근차근 올라가는 변형문제 정확히 5개를 만듭니다.

5문항 구성 (순서 고정)
1. 쌍둥이 — 원문항과 같은 구조, 숫자·소재·표현만 바꿉니다.
2. 쌍둥이 — 1번과 또 다른 숫자·소재로, 같은 구조를 한 번 더 연습합니다.
3. 개념 확인 — 같은 핵심 개념을 다른 형태로 묻습니다(거꾸로 묻기, 옳은 것/옳지 않은 것 고르기, 객관식↔주관식 등).
4. 실수 정조준 — 학생이 했던 실수(error_analysis)를 그대로 반복하면 틀리게 되는 지점을 정확히 겨냥합니다.
5. 한 단계 응용 — 같은 개념에 생각 한 단계만 더 얹은 문제입니다. 학년 수준을 넘지 않습니다.

출제 규칙
- 원문항과 같은 학년·교육과정 수준, 같은 과목 표현을 씁니다.
- 원문항이 객관식이면 1·2번은 같은 선지 수의 객관식으로 냅니다. 선지는 "1) ..." 같은 번호 없이 내용만 choices 배열에 넣습니다. 주관식이면 choices는 빈 배열입니다.
- 객관식 정답 위치가 한쪽으로 몰리지 않게 섞습니다. 정답은 반드시 하나뿐이어야 합니다.
- 모든 문항은 explanation에서 직접 풀어 검산한 뒤 answer를 적습니다. 숫자 하나라도 틀리면 안 됩니다.
- 그림이 꼭 있어야 하는 문제는 내지 않습니다. 필요한 정보는 글로 모두 제시합니다.
- 국어·영어 지문은 기존 책·기사·교과서 글을 옮기지 말고 새로 창작합니다. 지문은 한국어 400자, 영어 120단어 이내로 짧게 씁니다.
- 수식은 LaTeX로 $...$ 안에 씁니다. 줄바꿈은 \\n을 씁니다.
- answer는 객관식이면 "③"처럼 원문자 하나, 주관식이면 최종 답만 짧게 씁니다.
- diagnosis는 학생에게 말하듯 다정하게 2~3문장: 왜 틀렸는지와 다음에 꼭 기억할 한 가지.

반드시 record_variants 도구로 답하세요.`;

const GENERATE_TOOL = {
  name: 'record_variants',
  description: '틀린 문항에 대한 진단과 변형문제 5개를 기록합니다.',
  input_schema: {
    type: 'object',
    properties: {
      diagnosis: { type: 'string', description: '학생에게 건네는 2~3문장 오답 진단' },
      key_point: { type: 'string', description: '꼭 기억할 핵심 개념 한 줄' },
      variants: {
        type: 'array',
        minItems: 5,
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['쌍둥이', '개념 확인', '실수 정조준', '한 단계 응용'] },
            question: { type: 'string', description: '문제 발문(지문 포함). 수식은 $LaTeX$' },
            choices: { type: 'array', items: { type: 'string' }, description: '객관식 선지 내용. 주관식이면 []' },
            explanation: { type: 'string', description: '풀이 과정 (검산 포함, 3~6줄)' },
            answer: { type: 'string', description: '정답 (객관식은 ①~⑤ 중 하나)' },
          },
          required: ['type', 'question', 'choices', 'explanation', 'answer'],
        },
      },
    },
    required: ['diagnosis', 'key_point', 'variants'],
  },
};

async function generate(body, env) {
  const p = body.problem || {};
  if (!p.problem_text) throw httpError(400, '원문항 정보가 없습니다.');

  const lines = [
    `과목: ${clean(body.subject) || '미지정'}`,
    `학년: ${clean(body.grade) || '미지정'}`,
    '',
    `[원문항 ${clean(p.number)}번]`,
    clean(p.problem_text, 6000),
  ];
  if (p.figure_description) lines.push(`(그림 설명) ${clean(p.figure_description, 2000)}`);
  lines.push(
    '',
    `문항 형식: ${p.question_format === 'multiple_choice' ? `객관식 ${p.choice_count || 5}지선다` : '주관식'}`,
    `핵심 개념: ${clean(p.concept) || '미상'}`,
    `학생 답: ${clean(p.student_answer) || '(빈칸)'}`,
    `정답: ${clean(p.correct_answer) || '(직접 풀어서 확인)'}`,
    `실수 원인 추정: ${clean(p.error_analysis, 1500) || '(없음 — 정답과 학생 답을 비교해 직접 추정)'}`,
    '',
    '이 학생이 다음에는 맞힐 수 있도록 변형문제 5개를 record_variants로 출제해 주세요.',
  );

  const result = await callClaude(env, {
    system: GENERATE_SYSTEM,
    content: [{ type: 'text', text: lines.join('\n') }],
    tool: GENERATE_TOOL,
    maxTokens: 8000,
  });

  const variants = (Array.isArray(result.variants) ? result.variants : []).slice(0, 5).map((v) => ({
    type: v.type || '',
    question: v.question || '',
    choices: Array.isArray(v.choices) ? v.choices.map(String).filter(Boolean) : [],
    explanation: v.explanation || '',
    answer: v.answer || '',
  }));
  if (variants.length < 5) throw httpError(502, '변형문제가 5개보다 적게 만들어졌습니다. 다시 시도해 주세요.');

  return { diagnosis: result.diagnosis || '', key_point: result.key_point || '', variants };
}

/* ------------------------------------------------------------------ */
/* Claude API                                                          */
/* ------------------------------------------------------------------ */

async function callClaude(env, { system, content, tool, maxTokens }) {
  const payload = {
    model: env.MODEL || DEFAULT_MODEL,
    max_tokens: maxTokens,
    system,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
    messages: [{ role: 'user', content }],
  };

  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(1500 * attempt);
    const res = await fetch(env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.stop_reason === 'max_tokens') {
        throw httpError(502, '응답이 너무 길어 잘렸습니다. 사진을 나눠서 올려 주세요.');
      }
      const block = (data.content || []).find((b) => b.type === 'tool_use' && b.name === tool.name);
      if (!block) throw httpError(502, 'AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.');
      return block.input || {};
    }

    const errBody = await res.json().catch(() => ({}));
    const msg = errBody?.error?.message || res.statusText;
    lastError = httpError(res.status >= 500 ? 502 : res.status, `AI 호출 실패 (${res.status}): ${msg}`);
    if (![429, 500, 502, 503, 529].includes(res.status)) break;
  }
  throw lastError;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

async function checkAccess(request, env) {
  if (!env.ACCESS_CODE) return;
  const given = request.headers.get('x-access-code') || '';
  const enc = new TextEncoder();
  const a = enc.encode(given);
  const b = enc.encode(env.ACCESS_CODE);
  const ok = a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
  if (!ok) throw httpError(401, '접속 코드가 올바르지 않습니다.');
}

function clean(v, max = 200) {
  return String(v ?? '').slice(0, max).trim();
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
