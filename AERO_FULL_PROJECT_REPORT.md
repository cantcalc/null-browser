# Aero Browser 전체 구현·검증 보고서

검토일: 2026-09-10 (최종 브라우저 크롬 색상 수정 반영)  
프로젝트: `/Users/jeong-yeongjun/.gemini/antigravity/scratch/custom-browser`  
검토 범위: 현재 소스 코드, 검증 스크립트, 개발 서버 UI, 기존 인계 문서의 주장 대조

## 1. 요약

Aero Browser는 단순한 목업 단계가 아니다. 탭, 내비게이션, WebContentsView 기반 웹 페이지 렌더링, 워크스페이스, 설정 저장, 다운로드·권한·기록 데이터 관리, 번역 요청 연결 등 핵심 브라우저 골격은 실제 코드로 연결되어 있다.

다만 이전 문서의 표현처럼 “모든 기능이 완성된 완벽한 브라우저”라고 부를 단계는 아니다. 현재 정확한 상태는 다음과 같다.

- 네이티브 탭 아키텍처: 구현 완료 및 런타임·수명주기 검증 완료
- 기본 브라우저 조작: 대부분 구현
- 워크스페이스와 탭 관리: 구현되어 있으며 이름 변경·저장도 연결됨
- UI 리디자인: Connected Chrome 방향으로 반영됨. 다양한 OS·DPI·창 크기 추가 QA 필요
- 번역: 실제 외부 번역 요청은 연결되어 있으나 온라인·키 없는 Google 모바일 엔드포인트에 의존하는 제한적 구현
- 광고 차단: 전체 필터 엔진이 아닌 하드코딩 호스트/경로 차단
- AI 기능: 구현하지 않음
- 배포: macOS DMG 산출물은 있으나 설치·재실행·첫 실행 전체 QA 부족. Windows EXE 설정은 없음

따라서 현재 판단은 **“개발용으로 핵심 흐름을 확인할 수 있는 브라우저 프로토타입+실사용 골격”**이다. **“상용 출시 완료” 또는 “모든 스펙 완료”로 판정하면 부정확하다.**

## 2. 상태 표기 기준

| 표기 | 의미 |
|---|---|
| 완료 | 실제 로직이 있고 이번 검토에서 관련 실행·타입·빌드 검증까지 확인한 항목 |
| 구현 | 소스에 실제 연결되어 있으나 모든 환경·경계 조건을 검증하지 않은 항목 |
| 부분 | 동작은 하지만 명확한 범위·품질·공급자 제약이 있는 항목 |
| 미구현 | 현재 소스에서 제품 기능으로 확인되지 않는 항목 |
| 검증 필요 | 코드상 경로는 있으나 배포 환경, 다양한 사이트 또는 장시간 사용 검증이 부족한 항목 |

## 3. 현재 아키텍처 확인

### 3.1 메인 프로세스와 웹 콘텐츠

- `electron/main.ts`가 Electron 앱, `BrowserWindow`, IPC, 메뉴, 세션, 다운로드, 권한을 관리한다.
- `electron/TabManager.ts`가 탭마다 Electron 34의 `WebContentsView`와 `webContents`를 생성·보관·전환·삭제한다.
- 각 탭의 페이지는 React DOM 안의 `<webview>`나 iframe으로 렌더링되지 않는다. 네이티브 `WebContentsView`가 `BrowserWindow.contentView`에 붙는다.
- `src/components/WebViewContainer.tsx`는 페이지를 그리는 컴포넌트가 아니라 React 크롬 영역의 위치·크기를 `ResizeObserver`로 측정해 메인 프로세스에 전달하는 앵커 역할이다.
- `electron/preload.ts`는 필요한 IPC만 `contextBridge`로 노출한다. 전체 `ipcRenderer` 공개 방식은 확인되지 않았다.
- 웹 콘텐츠 WebContentsView에 `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`가 적용되어 있다.

### 3.2 iframe 관련 표현의 정정

현재 `TabManager`에는 동일 출처 프레임의 텍스트를 번역하기 위해 페이지 내부에서 `iframe, frame`을 찾는 코드가 있다. 이것은 브라우저 페이지를 iframe으로 렌더링하는 구조가 아니다. **렌더링 아키텍처는 WebContentsView이고, iframe 문자열은 번역 대상 탐색용 DOM 처리**다.

## 4. 기능별 실제 상태

| 영역 | 상태 | 현재 확인 내용 |
|---|---|---|
| WebContentsView 탭 구조 | 완료 | 실제 네이티브 뷰 생성·bounds·visible·삭제 동작 확인 |
| 탭 생성·전환·닫기 | 구현 | 일반 탭, 새 탭, 마지막 탭 처리, 닫은 탭 재열기 흐름 존재 |
| 탭 가로 스크롤 | 구현/검증 필요 | 휠 `deltaX`·`deltaY`, 트랙패드 입력, 자동 스크롤 보정 로직 존재. 다양한 입력 장치 추가 테스트 필요 |
| 탭 닫기 X 표시 | 완료 | 기본 숨김, 해당 탭 hover/focus 시 표시. 실제 마우스 hover에서 표시 확인 |
| 탭 고정·음소거·복제 | 구현 | App과 TabManager에 연결된 상태·IPC 흐름 존재 |
| 뒤로·앞으로·새로고침·중지 | 구현 | WebContentsView 실제 내비게이션 API에 연결 |
| 주소창 URL/검색 판별 | 완료 | 검색 단축어, localhost, IP, 포트, 파일·외부 프로토콜 처리와 테스트 통과 |
| 워크스페이스 생성·선택·삭제 | 구현 | WorkspaceBar와 App 상태에 연결 |
| 워크스페이스 이름 변경 | 구현 | 이름 입력·길이 제한·저장 경로 존재. 기본 일반 워크스페이스 이름은 `work` |
| 워크스페이스 분할 | 구현/검증 필요 | 2개 뷰, 비율, 6px gutter, visible bounds 처리 존재. 실제 두 사이트 동시 사용 QA 추가 필요 |
| 설정·테마 | 구현 | 12개 테마, 9개 accent, 검색엔진, 시작 동작, 즐겨찾기 등 설정 저장 경로 존재 |
| 설정 미리보기/취소 | 구현 | 드래프트 상태와 live preview, 취소·저장 분리 구조 존재 |
| 개발 실행 시 온보딩 | 구현 | 개발 환경에서는 첫 실행 설정창을 건너뛰는 조건 존재 |
| 패키지 첫 실행 온보딩 | 구현/검증 필요 | `firstRunCompleted` 기반 조건 존재. 실제 DMG 설치 후 재실행 확인 필요 |
| 다운로드 | 구현 | DownloadManager와 다운로드 IPC/UI 이벤트 흐름 존재 |
| 기록·북마크·닫은 탭 | 구현 | DataManager 및 Library 관련 흐름 존재 |
| 권한 요청 | 구현 | PermissionManager와 프롬프트·저장 흐름 존재 |
| 팝업 | 구현 | 새 창을 별도 관리 탭으로 흡수하는 흐름 존재 |
| 마우스 측면 버튼/트랙패드 | 구현 | guest preload에서 뒤로·앞으로와 페이지 가장자리 스와이프 연결 |
| 우클릭 드래그 제스처 | 구현 | HUD와 뒤로·앞으로·새로고침·상단 이동 액션 연결 |
| 페이지 번역 | 부분 | 실제 온라인 번역 요청·페이지 텍스트 적용/복구 연결. 범위와 공급자 제한 큼 |
| 광고 차단 | 부분 | 호스트 목록·경로 휴리스틱. EasyList급 전체 필터 엔진은 아님 |
| AI 기능 | 미구현 | AI API, Gemini 계정 연동, AI 탭·버튼은 추가하지 않음 |
| 브라우저 확장 프로그램 | 미구현 | Chrome 확장 설치·권한·background service worker 지원 없음 |
| Windows EXE 배포 | 미구현/검증 필요 | 현재 package 설정은 macOS 중심이며 Windows target 스크립트가 확인되지 않음 |

## 5. 최근 UI 수정 상태

최근 요구사항인 “탭 닫기 X를 평소에는 숨기고 마우스를 올리면 보이게”는 다음과 같이 반영되어 있다.

- 대상: `/Users/jeong-yeongjun/.gemini/antigravity/scratch/custom-browser/src/components/HorizontalTabBar.tsx`
- 스타일: `/Users/jeong-yeongjun/.gemini/antigravity/scratch/custom-browser/src/index.css`
- 기본 상태: close 버튼 opacity 0
- hover/focus 상태: 해당 탭의 close 버튼 노출
- active 탭도 평상시에는 close 버튼을 숨김
- 해당 탭 hover 또는 close 버튼 keyboard focus 시에만 close 버튼을 표시

Connected Chrome 리디자인도 현재 소스에 반영되어 있다.

- `WorkspaceBar`, `HorizontalTabBar`, `AddressBar`를 `.aero-connected-chrome` 안에서 하나의 상단 surface로 묶었다.
- 탭 바·툴바·주소창의 배경과 경계를 분리된 카드처럼 보이지 않도록 조정했다.
- 새 탭은 기존 Safari 유사 심볼 대신 CSS airflow 형태의 Aero mark를 사용한다.
- 주소창 placeholder는 긴 안내문 대신 최소 텍스트 `검색`으로 줄였고, New Tab 검색창은 비워 둔 상태로 두었다.
- 좁은 폭에서 home/devtools 같은 보조 컨트롤을 숨기는 CSS breakpoint가 추가되어 있다.
- 최신 실제 UI smoke 확인은 1280×720 크기에서 수행했다. 320/360px 실기기 수준의 시각 QA는 아직 다시 수행하지 않았다.

### 최종 브라우저 크롬 색상 정책

- Workspace, 탭, 새로고침/뒤로가기/앞으로가기, 주소창·검색창 영역은 모두 사용자가 선택한 Aero 테마와 accent 색상을 따른다.
- Google을 포함한 웹사이트의 다크/라이트 모드나 `theme-color`는 Aero 크롬에 자동 반영하지 않는다.
- 사이트 색상을 읽어 선택 탭·툴바에 주입하던 경로를 최종 상태에서 제거했다. 따라서 Google 다크모드가 상단 브라우저 UI를 덮어쓰지 않는다.
- 페이지는 계속 Electron `WebContentsView` 안에서 원래 스타일로 렌더링된다. 페이지 DOM, CSS, 콘텐츠를 수정하지 않는다.

## 6. 번역 기능의 실제 범위와 한계

### 6.1 실제로 구현된 것

- `electron/translation.ts`에 중앙 제한값과 오류 코드가 있다.
- 번역 공급자는 현재 키 없이 접근하는 Google 모바일 웹 엔드포인트 하나에 의존한다.
- 페이지 번역은 텍스트 노드를 순회해 번역하고, 원문을 보관해 복구할 수 있다.
- 텍스트를 여러 조각으로 나누되 결과가 준비된 뒤 적용하는 방식으로 중간 상태 노출을 줄인다.
- 페이지 이동·새로고침·뒤로·앞으로·탭 종료·탭 전환 시 이전 번역 작업을 무효화하는 경로가 있다.
- 선택 텍스트 번역에는 길이 제한과 HTML escape 처리가 있다.
- 자동으로 모든 페이지를 계속 스캔하거나 백그라운드에서 무한 폴링하는 구조는 확인되지 않았다.
- 번역 로그에는 원문 전체를 남기지 않고 공급자·오류·소요시간 중심으로 기록한다.

### 6.2 현재 제한값

- 번역 대상 노드 최대 1,000개
- 요청 단위 텍스트 최대 1,500자
- 한 요청 최대 8개 텍스트
- 요청 문자 수 최대 1,500자
- 동시 요청 최대 3개
- 선택 텍스트 UI는 별도 최대 5,000자 제한

### 6.3 번역을 “완전한 페이지 번역”이라고 부를 수 없는 이유

- 공식 Google Translate API나 Gemini API를 사용하지 않는다.
- 인터넷 연결이 필수다.
- Google 모바일 웹 엔드포인트의 정책·응답 형식·접근 제한에 영향을 받는다.
- 403, 429, timeout, network, parse, empty, invalid response 오류가 발생할 수 있다.
- 교차 출처 iframe, shadow DOM, canvas 기반 텍스트, 이미지·PDF OCR, 동영상 자막 등은 보장하지 않는다.
- 큰 페이지는 1,000개 노드/요청 제한에 걸릴 수 있다.
- 외부 번역 서버로 텍스트가 전송되므로 “완전한 로컬·비공개 번역”이 아니다.

결론적으로 번역은 **실제 연결된 제한적 온라인 기능**이지, 오프라인·공식 API·모든 사이트를 보장하는 완성 기능은 아니다.

## 7. 내비게이션·탭·워크스페이스 세부 검토

### 주소창과 검색

`src/utils/navigationParser.ts`에는 다음 경로가 확인된다.

- 일반 검색어를 기본 검색엔진 URL로 변환
- `g`, `gh`, `yt`, `mdn`, `n` 등 검색 단축어 처리
- Google, Naver, DuckDuckGo, Bing, Brave, 사용자 지정 검색엔진
- `localhost`, `127.0.0.1`, IPv4/IPv6, 호스트명과 포트 판별
- `http`, `https`, `file`, `mailto`, `tel`, `vscode`의 명시적 처리
- 위험한 `javascript:` 입력 차단
- 내부 Aero URL 정규화

`scratch/verify-navigation-parser.js`에서 빈 입력, 단축어, localhost, IP, 잘못된 포트, javascript 차단, 사용자 지정 검색엔진 케이스가 통과했다.

### 탭 수명주기

`TabManager`에는 로딩 시작/종료, 제목, favicon, navigation, in-page navigation, 로딩 실패, 미디어 재생, 렌더러 종료 이벤트가 연결되어 있다. 탭을 닫을 때 번역 작업 무효화와 WebContentsView 제거·webContents 종료가 수행된다.

20개 탭 테스트는 실제 `TabManager`가 20개의 native child view를 소유하는지 확인하고 전체 정리까지 수행했다. 다만 모든 탭에서 서로 다른 무거운 사이트를 동시에 로드하는 메모리·성능 벤치마크는 아니다.

### 분할 보기

- App에서 보조 탭과 비율을 관리한다.
- TabManager는 화면 비율을 대략 0.2~0.8 범위로 제한한다.
- 두 뷰 사이에 6px gutter를 둔다.
- overlay가 켜지거나 조건이 맞지 않으면 분할 뷰를 숨긴다.

코드 경로는 실제로 존재하지만, 두 개의 실제 페이지를 띄운 상태에서 주소 입력·탭 전환·새로고침·창 크기 변경을 함께 검증하는 시나리오는 출시 전 추가해야 한다.

## 8. UI/UX 현재 판단

### 개선된 부분

- 상단 chrome을 하나의 연결된 surface로 묶는 방향이 반영됨
- 탭과 툴바의 과한 박스 분리를 완화함
- 활성·비활성·hover 상태가 같은 버튼 처리 규칙을 사용함
- 탭 close 버튼을 기본 노출하지 않아 시각적 노이즈를 줄임
- New Tab의 긴 안내 placeholder와 Safari 유사 심볼을 줄임
- 12개 테마와 9개 accent preview를 기존 드래프트 시스템 안에서 유지함
- 좁은 폭에서 일부 보조 버튼을 숨기는 반응형 규칙이 있음

### 아직 검증이 필요한 부분

- macOS traffic-light 버튼과 Aero 상단 chrome의 실제 위치는 창 장식, OS 버전, DPI에 따라 달라질 수 있음
- 1280×720 이외의 800×600, 초광폭, Retina 배율에서 탭·주소창·워크스페이스 overflow를 추가 확인해야 함
- 탭이 아주 많을 때 제목 축약, close 버튼, 가로 스크롤 판정이 모든 트랙패드·마우스에서 같은지 확인 필요
- 사이트 색이 chrome으로 자동 추출되어 스며드는 “완전한 site-adaptive tint”는 현재 구현되어 있지 않음. 현재 Connected Chrome은 테마와 accent 기반의 시각 연결이다.
- 실제 사이트가 WebContentsView 위에 표시되는 영역과 React modal/overlay가 충돌하지 않는지 각 모달별 재검증이 필요함

## 9. 보안·개인정보 검토

### 긍정적인 현재 구조

- 웹 콘텐츠에 Node integration을 노출하지 않는다.
- context isolation과 sandbox를 사용한다.
- 외부 `mailto:`, `tel:`, `vscode:` 링크는 OS 외부 열기 흐름으로 보낸다.
- 팝업은 임의의 새 BrowserWindow를 만드는 대신 관리 탭으로 흡수한다.
- 시크릿 창은 임시 partition을 사용하고 일반 기록 저장 대상에서 분리한다.
- 번역 로그에 원문 전체를 기록하지 않는다.

### 추가 검토가 필요한 부분

- `file://` 이동을 허용하는 경로가 있으므로 로컬 파일 접근 범위와 위험 모델을 출시 전에 다시 검토해야 한다.
- 광고 차단 목록이 코드에 고정되어 있어 우회·누락·유지보수 문제가 있다.
- 키 없는 외부 번역 엔드포인트는 안정성뿐 아니라 서비스 정책과 개인정보 전송 관점에서도 제품 정책을 확정해야 한다.
- 세션에 Chrome User-Agent를 전역 지정하고 있으므로 사이트 호환성 변화에 대한 유지보수가 필요하다.
- 권한·다운로드·외부 프로토콜에 대한 악성 사이트 테스트가 필요하다.

## 10. AI 기능 상태

사용자의 조건에 따라 AI 기능은 추가하지 않았다.

- Gemini/OpenAI API 키 연동 없음
- AI 채팅·AI 탭·AI 검색 버튼 없음
- AI 서버 또는 백그라운드 에이전트 없음
- 번역 기능은 외부 번역 엔드포인트를 사용하는 별도 기능이며, AI 기능을 구현했다는 의미가 아님

따라서 현재 프로젝트는 API 없이도 기본 브라우징을 개발·확인할 수 있다. 번역은 인터넷과 외부 번역 서비스가 필요하다.

## 11. 배포 상태

현재 `release/`에 macOS arm64 DMG와 앱 산출물이 있다. 그러나 다음은 이번 검토에서 완료로 판정하지 않았다.

- DMG 실제 설치 후 앱 실행
- 앱 삭제 후 재설치
- 설치 후 첫 실행 온보딩 표시
- 온보딩 완료 후 재실행 시 다시 표시되지 않는지 확인
- 권한·다운로드·번역·시크릿 창의 패키지 환경 확인
- Intel Mac 또는 Windows 실행 확인

현재 package 설정은 macOS 중심이며 Windows EXE target/스크립트는 확인되지 않았다. 따라서 “DMG/EXE 배포 완료”라는 표현은 현재 기준으로는 과장이다.

## 12. 이번 검토에서 통과한 검증

프로젝트 루트에서 다음 명령을 실행했고 모두 종료 코드 0으로 통과했다.

| 명령 | 결과 | 검증 내용 |
|---|---|---|
| `npx tsc --noEmit` | PASS | React/TypeScript 타입 검사 |
| `npm run typecheck:electron` | PASS | Electron 메인 프로세스 타입 검사 |
| `npm run build` | PASS | Vite와 Electron 번들 빌드 |
| `npm run test:navigation` | PASS | 내비게이션 파서 경계 조건 |
| `npx electron scratch/verify-webcontentsview.js` | PASS | 20개 native WebContentsView 생성 및 정리 |
| `npx electron scratch/test-apis.js` | PASS | Electron 34 WebContentsView/BaseWindow/BrowserWindow API와 contentView 메서드 확인 |

실제 개발 브라우저 UI smoke 확인 항목:

- 개발 서버 `http://localhost:5173/` 실행
- 1280×720에서 Connected Chrome 상단 UI 확인
- 탭 생성·닫기 흐름 확인
- 탭 hover 시 close X 노출 확인
- 주소창 focus 동작 확인
- 워크스페이스 이름 변경 모달 확인
- Command Palette 표시 확인
- Snow Light 테마 preview 후 취소 확인
- 기본 상태에서 명확한 overflow가 발생하지 않는 것 확인

이번 검증에 포함되지 않은 항목:

- 장시간 브라우징 및 메모리 누수
- 20개 실제 웹사이트 동시 로딩 성능
- 모든 사이트의 번역 성공률
- DMG 설치 후 패키지 앱 QA
- Windows EXE 실행
- 320/360px 폭의 실브라우저 시각 QA
- 모든 macOS 버전·Retina 배율·다중 모니터 조합

참고로 프로젝트 루트는 현재 Git repository로 인식되지 않아 commit/diff 기반 변경 이력 검증은 수행할 수 없었다.

## 13. 이전 스펙·보고서 표현의 정정

다음 표현은 그대로 믿으면 안 된다.

1. **“모든 기능 완성”**: 핵심 기능이 많이 구현된 것은 맞지만 번역, 광고 차단, 배포, 확장 프로그램, 호환성 QA에 명확한 제한이 있다.
2. **“완전한 페이지 번역”**: 실제 번역은 노드 수·문자 수·동시 요청·동일 출처 프레임 제한을 받는다.
3. **“완전한 site-adaptive chrome”**: 현재는 테마/accent 기반 Connected Chrome이며, 사이트 색을 자동 추출해 적용하는 로직은 없다.
4. **“20개 탭 스트레스 테스트 통과”**: 20개 native view lifecycle과 cleanup은 통과했지만, 20개 무거운 사이트의 성능 테스트는 아니다.
5. **“DMG/EXE 배포”**: macOS arm64 산출물은 있으나 설치·재실행 QA와 Windows target은 확인되지 않았다.
6. **`walkthrough.md` 위치**: 프로젝트 루트가 아니라 `/Users/jeong-yeongjun/.gemini/antigravity/brain/3b724ab2-e4d9-4f53-85e5-a265523ee979/walkthrough.md`에 있다. 이 문서는 과거 시점의 설명이므로 현재 소스와 충돌하면 현재 소스를 기준으로 봐야 한다.

## 14. 우선순위별 다음 작업

### P0 — 출시 전 필수

- 실제 DMG 설치·재실행·첫 실행 온보딩 시나리오 검증
- `file://` 허용 정책과 로컬 파일 접근 보안 재검토
- 분할 보기에서 두 실제 페이지를 동시에 로드하는 E2E 테스트
- 탭 1개·다수·최대 폭·최소 폭·Retina 환경의 UI 회귀 테스트
- 번역 오류·중단·페이지 이동·복구를 실제 사이트 fixture로 검증
- 다운로드·권한·팝업·외부 프로토콜 악성 입력 테스트

### P1 — 품질과 안정성 개선

- 공식 번역 API 또는 사용자 선택 가능한 안정적 공급자 검토
- 필요 시 로컬 번역 옵션 검토. 설치 용량·성능·개인정보 정책을 별도로 결정해야 함
- EasyList 호환 필터 또는 명확한 광고 차단 범위 제공
- 탭 가로 스크롤을 trackpad, mouse wheel, shift-wheel, RTL/비표준 delta 입력별로 자동 테스트
- 실제 사이트 상단 색을 사용할 계획이라면 안전한 색 추출·채도 제한·접근성 대비 규칙 설계

### P2 — 장기 브라우저 기능

- 확장 프로그램
- 동기화와 계정
- 고급 기록 검색
- password manager·autofill
- 인쇄·PDF 저장·페이지 캡처
- Windows/Intel/다중 플랫폼 패키징

## 15. 결론

Aero Browser의 핵심 기반은 실제로 만들어져 있으며, “아무 기능도 없는 가짜 UI”라고 판단할 상태는 아니다. 특히 WebContentsView 전환, 탭 수명주기, 기본 내비게이션, 워크스페이스, 설정 드래프트, 다운로드·권한·기록 경로는 코드로 연결되어 있고 주요 검증도 통과했다.

반대로 번역, 광고 차단, site-adaptive 색상, 배포, 다양한 환경 QA는 현재 제한적이거나 미완료다. 앞으로는 기능을 무작정 추가하기보다 P0 검증을 먼저 끝내고, 번역 공급자·광고 차단 범위·배포 플랫폼을 명확히 결정하는 것이 완성도와 신뢰성을 가장 크게 높인다.

이 보고서는 이전 인계 문서의 홍보성 표현이 아니라 **2026-09-10 현재 소스와 실행 결과를 기준으로 한 사실 보고서**다.
