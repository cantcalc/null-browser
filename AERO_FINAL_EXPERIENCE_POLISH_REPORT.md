# Aero Browser — Final Experience Polish / Connected Chrome 보고서

작성일: 2026-09-10

## 1. 적용 기준

이번 작업은 아래 두 문서를 함께 기준으로 삼았다.

- `Aero Browser — FINAL EXPERIENCE POLISH MASTER PHASE`
- `Aero Browser — Connected Chrome Visual Correction`

두 문서의 공통 범위인 시각 디자인, 모션, 정보 계층, 연결형 브라우저 크롬만 수정했다. 브라우저 아키텍처, `WebContentsView`, 상태 모델, IPC, 단축키, 탐색 로직, 번역 백엔드에는 변경을 추가하지 않았다.

## 2. 완료한 변경

### 2.1 Connected Chrome

- Workspace bar, horizontal tab bar, toolbar를 `aero-connected-chrome` 단일 surface 흐름으로 통합했다.
- 탭 바와 툴바 사이의 강한 박스 경계와 이중 구분선을 줄였다.
- 활성 탭은 하단 경계를 툴바와 맞물리게 하고, 그림자를 제거해 상단 크롬 안에 연결된 상태로 보이게 했다.
- 비활성 탭 hover는 낮은 대비의 surface 변화만 사용한다.
- 콘텐츠 영역과 크롬 사이의 경계는 얇고 낮은 대비로 조정했다.
- Workspace·탭·새로고침·주소창 툴바 전체는 사용자가 선택한 Aero 테마 색상을 사용한다. 웹페이지의 다크/라이트 모드는 브라우저 크롬 색상에 영향을 주지 않으며, 페이지 DOM/스타일도 변경하지 않는다.

### 2.2 Toolbar / Omnibox

- 주소창을 큰 독립 캡슐처럼 보이지 않도록 연결형 크롬 색상에 가깝게 조정했다.
- 기본 상태의 테두리와 그림자를 제거하고, hover/focus 때만 약한 surface와 accent ring을 표시한다.
- 포커스가 없을 때 `https://` 및 불필요한 쿼리 표시를 줄여 hostname/path 중심의 compact 표시를 사용한다.
- 포커스하면 기존 전체 URL 입력값을 그대로 사용하므로 편집/복사/탐색 동작은 유지된다.
- 긴 설명형 placeholder 대신 짧은 `검색` 표시만 남겨 입력창의 시각적 노이즈를 줄였다.

### 2.3 Motion system

`src/index.css`에 공통 모션 토큰을 추가했다.

- `--motion-instant: 80ms`
- `--motion-fast: 120ms`
- `--motion-normal: 160ms`
- `--motion-panel: 200ms`
- `--motion-color: 180ms`
- 공통 easing: `--ease-aero`, `--ease-aero-out`

탭 추가, popover/modal, Aside 패널 진입에 짧은 opacity/translate 기반 모션을 적용했다. 버튼과 리스트의 hover/active 반응은 같은 토큰을 사용하며, active 상태에서는 아주 작은 눌림 피드백만 사용한다.

`prefers-reduced-motion: reduce`에서는 애니메이션과 전환을 사실상 끄고, 스크롤의 부드러운 이동도 비활성화한다.

### 2.4 Private visual identity

- `App` 루트에 `aero-private` 상태 클래스를 연결했다.
- Private 창의 chrome/content/active tab에 제한적인 violet 계열 undertone을 적용했다.
- New Tab의 Aero 워드마크 아래에 작은 `PRIVATE` 표시를 추가했다.
- 기존 시크릿 탐색 동작과 저장 정책은 변경하지 않았다.

### 2.5 New Tab / Settings / Panels

- New Tab 검색창은 기존 Aero 스타일을 유지하면서 과한 그림자를 제거하고 focus ring을 정리했다.
- 설정 화면의 기존 row/card에 공통 radius와 surface 규칙을 덧씌워 컴포넌트별 모서리 편차를 줄였다.
- Settings navigation, segment, list row, popover, modal, Aside가 동일한 transition/radius 계층을 사용하도록 정리했다.
- 새 기능이나 동작이 없는 시각 상태만 조정했다.

## 3. 의도적으로 추가하지 않은 항목

- AI API 또는 AI 기능
- 화면 캡처 기반 색상 분석이나 지속적인 색상 추적
- 새로운 탭/워크스페이스/번역 기능
- Safari식 UI 복제
- 데이터 모델 또는 영구 저장 구조 변경

사이트의 `theme-color`나 페이지 배경색을 브라우저 크롬 색상으로 읽거나 주입하는 동작은 최종 상태에서 제거했다. 따라서 Google 다크모드와 같은 사이트 설정이 Workspace, 탭, 툴바, 주소창을 덮어쓰지 않는다.

## 4. 검증 결과

다음 명령을 순서대로 실행했고 모두 성공했다.

```text
npx tsc --noEmit
npm run typecheck:electron
npm run build
npm run test:navigation
npm run test:tabs
```

확인 결과:

- React TypeScript 타입 오류 0개
- Electron TypeScript 타입 오류 0개
- Vite 및 Electron 번들 생성 성공
- navigation parser regression test 통과
- 실제 TabManager 기반 20개 WebContentsView 생성 및 정리 테스트 통과
- 일반 New Tab 및 Private New Tab의 최신 Vite 화면을 시각 확인
- 사이트 다크모드가 브라우저 크롬 테마를 변경하지 않는 최종 CSS/IPC 경로 확인

## 5. 현재 남은 확인 범위

- 실제 외부 사이트가 로드된 상태에서 여러 Aero 테마의 툴바 대비를 확인하는 수동 검수는 별도 사이트 fixture가 필요하다. 사이트 색상을 크롬에 반영하는 기능은 최종 범위에서 제외했다.
- 네이티브 전체화면, OAuth 팝업, PiP 같은 OS 의존 화면은 이번 디자인 변경으로 로직을 건드리지 않았으며, 기능 회귀 검증은 기존 기능 보고서 범위에 둔다.
- 현재 개발 실행은 Vite `http://localhost:5173/`와 Electron 개발 프로세스 기준이다. 배포용 DMG/EXE 패키징은 이번 디자인 작업 범위가 아니다.

## 6. 결론

두 문서의 핵심 요구인 `Connected Chrome`, compact omnibox, 조용한 active/inactive 상태, 중앙 모션 토큰, reduced-motion 대응, Private 시각 구분을 코드에 반영했다. 기능과 네이티브 브라우저 구조는 유지했으며, 자동화된 타입/빌드/기존 회귀 테스트도 모두 통과했다.
