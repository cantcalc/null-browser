# Aero Browser — Translation Reliability & Privacy Repair

검토일: 2026-09-10

## Translation Architecture Before

- 페이지 번역은 React의 `handleTranslatePage`에서 시작해 `preload` IPC의 `tab:translate`를 거쳐 `TabManager.translatePage()`로 전달되었습니다.
- 선택 텍스트는 `guestPreload`의 context menu/선택 HUD에서 `translate:text` IPC를 호출하고, 결과를 선택 번역 카드에 표시했습니다.
- Aside 텍스트 번역도 `electronAPI.translateText()`를 호출했지만, 개발용 브라우저 미리보기에서는 별도의 공개 번역 endpoint를 직접 호출했습니다.
- 메인 프로세스는 Google 모바일 웹 endpoint 실패 시 다른 공개 번역 서비스로 자동 전송했습니다.
- 페이지 번역은 Text Node를 수집했지만 chunk 응답을 받는 즉시 일부 DOM을 변경했기 때문에 후속 chunk 실패 시 혼합 언어가 남을 수 있었습니다.
- 번역 중 navigation/tab switch/reload를 구분하는 per-job 식별자가 없었습니다.
- 이전 빌드 호환 복원 경로에는 element `innerHTML`을 되돌리는 코드가 있었습니다.

## Translation Architecture After

- 페이지 번역 흐름은 `React → preload IPC → main의 단일 Google 번역 요청 → TabManager의 안전한 Text Node 적용`으로 유지됩니다.
- 선택 텍스트와 Aside 텍스트는 사용자가 직접 선택/입력하거나 번역 명령을 실행했을 때만 IPC를 통해 전송됩니다.
- 페이지 `TreeWalker`가 현재 문서와 접근 가능한 same-origin `iframe`/`frame`의 visible Text Node를 수집합니다.
- script/style/noscript/code/pre/textarea/input/select/option/contenteditable/SVG/canvas 및 `data-aero-ignore-translation` 영역은 제외합니다.
- 보이는 부모 element의 style 판정은 문서별 `WeakMap`에 캐시하고, 텍스트에는 문자 수와 의미 있는 문자 존재 여부를 적용합니다.
- 번역 요청은 최대 8개 노드와 최대 1,500자 기준으로 나누며, 최대 3개 요청만 병렬 실행합니다.
- 모든 chunk 응답을 먼저 검증하고, 전체 응답이 성공한 뒤 한 번에 Text Node에 적용합니다. 실패하면 페이지 DOM에 번역 결과를 적용하지 않습니다.
- 사이트가 요청 중 Text Node를 변경한 경우 현재 값이 추출 당시 원문과 같을 때만 번역합니다.
- 복원 시에도 현재 값이 Aero가 넣은 번역 결과와 정확히 일치할 때만 원문으로 되돌립니다. 이후 사이트가 바꾼 텍스트는 덮어쓰지 않습니다.
- 번역 상태는 페이지 기준으로 `idle`, `translating`, `translated`, `restoring`, `failed`를 관리하고, 중복 클릭을 막습니다.

## Privacy Changes

- MyMemory 자동 fallback을 완전히 제거했습니다.
- 프로젝트 코드에서 해당 endpoint를 호출하는 경로와 Aside 개발용 직접 fallback 요청을 제거했습니다.
- Google 모바일 endpoint만 사용하며, 이는 공식 API가 아닌 keyless web endpoint임을 코드 주석에 명시했습니다.
- 403, 429, timeout, 네트워크 오류, 빈 응답, 파싱 오류를 provider 오류로 구분합니다.
- CAPTCHA 우회, rate limit 우회, User-Agent 반복 변경, 무작위 제3자 provider 전송을 하지 않습니다.
- 성공한 번역만 최대 500개까지 메모리 LRU 캐시에 저장하며 디스크에 페이지 원문이나 번역 결과를 저장하지 않습니다.
- 번역 진단 로그에는 provider, 오류 코드, HTTP 상태, 소요 시간만 기록하며 페이지 전문/번역 텍스트/선택 텍스트는 기록하지 않습니다.
- `Always Translate This Site`는 사용자가 직접 설정한 경우에만 자동 번역을 시도합니다. 기본 사이트 번역은 자동 활성화하지 않습니다.
- Private Window에서도 사용자가 번역을 요청할 수 있지만, 온라인 provider로 텍스트가 전송된다는 점은 동일합니다. Private browsing이 provider로의 전송을 숨긴다고 표현하지 않습니다.

## DOM Safety

- 페이지 전체 번역에서 `element.innerText = translated`와 `element.innerHTML = translated`를 사용하지 않습니다.
- 링크, span, button, React DOM 구조, event listener, style, dataset을 보존하고 실제 Text Node의 `nodeValue`만 변경합니다.
- Text Node마다 `original`, prefix, suffix, translated 값을 저장합니다.
- 원문 복원은 저장된 Text Node가 아직 연결되어 있고 현재 값이 Aero가 적용한 값과 일치하는 경우에만 실행합니다.
- 이전의 element 전체 HTML 복원 호환 경로를 제거하여 오래된 snapshot으로 사이트 구조를 덮어쓰지 않습니다.
- 선택 번역 HUD의 결과와 오류도 자체 UI element의 `textContent`로 삽입합니다.

## Cancellation / Race Handling

- 탭별 monotonic translation job version을 사용합니다.
- 새 번역 요청, full navigation, in-page navigation, reload, back/forward, tab switch, tab close, renderer 종료 시 기존 job을 무효화합니다.
- 응답을 받은 뒤에도 탭 객체, URL, WebContents 생존 여부, job ID를 다시 확인합니다.
- Page A 요청이 늦게 돌아온 뒤 Page B 또는 새 DOM에 적용되는 경로를 차단합니다.
- cancellation 또는 chunk 실패 시 적용 전이면 상태만 폐기하고, 적용 중 예외가 발생하면 연결된 Text Node 중 Aero가 넣은 값만 안전하게 복원합니다.
- SPA의 DOM 변경을 상시 감시하거나 자동 재번역하지 않습니다. 현재 요청 시점의 DOM만 번역합니다.

## Performance

- 번역 버튼/명령이 실행되지 않으면 document scan, screenshot, MutationObserver, polling을 수행하지 않습니다.
- 최대 수집 노드는 `TRANSLATION_LIMITS.maxTranslatableNodes = 1000`으로 중앙 관리합니다.
- 텍스트 최대 길이, 요청당 노드 수, 요청당 문자 수, 동시 요청 수를 `electron/translation.ts`에서 중앙 관리합니다.
- chunk는 최대 8개/1,500자, 동시 요청은 최대 3개입니다.
- 실패 시 concurrency를 늘리거나 무제한 재시도하지 않습니다.
- 동일 문자열의 성공 결과만 bounded memory cache에 보관합니다.

## Test Results

통과:

- `npx tsc --noEmit`
- `npm run typecheck:electron`
- `npm run build`
- `npm run test:navigation`
- `npx electron scratch/verify-webcontentsview.js`
- 코드 검색으로 provider endpoint 및 자동 fallback 호출 제거 확인
- 개발 화면에서 번역 관련 UI가 Electron IPC 없이 제3자 endpoint를 직접 호출하지 않는 것 확인

실행 결과:

- React/renderer TypeScript 검사: 통과
- Electron TypeScript 검사: 통과
- Vite + Electron production build: 통과
- navigation parser 회귀 테스트: 통과
- 실제 TabManager 20개 WebContentsView 생성 및 19개 정리 테스트: 통과

아직 자동화하지 않은 매트릭스:

- static page의 heading/paragraph/nested span/link DOM 검증
- SPA 동적 텍스트 변경 후 복원 검증
- same-origin/cross-origin iframe 조합
- 1,000개에 가까운 대형 문서에서 실제 provider 응답/rollback 검증
- HTTP 403/429와 실제 offline 상태의 end-to-end UI 검증

## Known Limitations

- Google 모바일 웹 endpoint는 공식 번역 API가 아니므로 성공률, 응답 형식, rate limit을 보장할 수 없습니다.
- 인터넷 연결이 필요하며, 오프라인 로컬 번역 모델은 없습니다.
- cross-origin iframe, closed/open shadow DOM, PDF, canvas, 이미지 속 문자는 지원하지 않습니다.
- visible DOM Text Node만 대상으로 하며 최대 1,000개 노드와 텍스트/요청 길이 제한이 있습니다.
- 일부 동적 사이트는 번역 요청 이후 자체적으로 DOM을 갱신할 수 있습니다. 이 경우 변경된 사이트 텍스트를 보호하기 위해 해당 노드는 번역하지 않습니다.
- 번역 실패 시 페이지는 정상 표시되지만, 공개 provider의 응답 상태에 따라 사용자에게 재시도 안내가 표시됩니다.
- 선택 번역과 Aside 텍스트 번역은 Electron 실행 환경에서 IPC를 통해 동작하며, 일반 Vite 브라우저 미리보기에서는 온라인 번역 요청을 실행하지 않고 사용할 수 없음 상태를 표시합니다.
- 이번 작업은 번역 기능에 한정했으며 Browser Core, WebContentsView, Workspace, Split View, Tabs, Downloads, Settings 로직은 변경하지 않았습니다.
