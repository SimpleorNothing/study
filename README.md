# 다시풀기 · 오답 변형문제 생성기

**https://study.simpleornothing.com**

아이가 푼 문제지를 찍어 올리면 틀린 문제마다 변형문제 5개를 만들어, 문제지 + 정답·해설을 **PDF 한 파일**로 내려받습니다.

## 사용 흐름

1. **올리기** — 과목(수학·영어·국어·과학·사회·기타), 학년, 이름(선택), 문제지 사진/PDF(최대 12장), 채점 메모(선택: "3, 7번 틀림")
2. **오답 확인** — AI가 문항별로 정답/오답/빈칸을 판정. 체크를 직접 고칠 수 있음
3. **PDF 받기** — 틀린 문항마다 아래 순서로 5문항 생성 → A4 문제지 + 정답·해설 PDF

| # | 유형 | 목적 |
|---|---|---|
| 1 | 쌍둥이 | 같은 구조, 숫자·소재만 변경 |
| 2 | 쌍둥이 | 다른 숫자로 한 번 더 |
| 3 | 개념 확인 | 같은 개념을 다른 형태로 |
| 4 | 실수 정조준 | 학생이 한 실수를 다시 하면 틀리는 지점 |
| 5 | 한 단계 응용 | 생각 한 단계 확장 |

정답·해설 쪽에는 빠른 정답표, 원문항 다시 보기(내 답 → 정답), 오답 진단, 기억할 핵심이 들어갑니다.

`?demo` 또는 "예시로 먼저 보기"로 API 없이 전체 흐름을 체험할 수 있습니다.

## 구조

```
src/worker.js     Cloudflare Worker — /api/config, /api/analyze, /api/generate (Claude API, tool-use JSON)
public/           정적 사이트 (Workers Static Assets)
  index.html, styles.css, app.js
  pdf.js          A4 페이지 나누기 → html2canvas → jsPDF
  demo.js         예시 데이터
  vendor/         KaTeX, html2canvas, jsPDF (자체 호스팅)
wrangler.toml     study.simpleornothing.com 커스텀 도메인
```

- 사진은 브라우저에서 1800px JPEG로 줄인 뒤 전송, 서버에 저장하지 않음
- 변형문제는 문항별로 병렬(3개씩) 생성, 실패한 문항만 다시 시도 가능
- PDF는 브라우저에서 생성 (한글·수식 깨짐 없음), 마지막 결과는 이 기기에 저장되어 다시 받기 가능

## 배포 (Cloudflare Workers)

simpleornothing.com 존이 같은 Cloudflare 계정에 있어야 합니다.

**방법 A — 대시보드에서 GitHub 연결 (push하면 자동 배포)**

1. Cloudflare 대시보드 → Workers & Pages → Create → *Import a repository* → `SimpleorNothing/study`
2. Build command 비움, Deploy command `npx wrangler deploy`
3. Settings → Variables and Secrets 에 Secret 추가
   - `ANTHROPIC_API_KEY` (필수)
   - `ACCESS_CODE` (권장 — 설정하면 코드를 아는 사람만 AI 기능 사용 가능, 기기당 한 번 입력)

**방법 B — 로컬에서**

```bash
npm install
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ACCESS_CODE
npx wrangler deploy
```

모델은 `wrangler.toml`의 `MODEL` (기본 `claude-sonnet-5-5`). 더 정확한 채점이 필요하면 `claude-opus-5-5`로 바꾸세요.

## 로컬 개발

```bash
printf 'ANTHROPIC_API_KEY=sk-ant-...\n' > .dev.vars
npm run dev        # http://localhost:8787
```
