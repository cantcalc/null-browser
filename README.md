# NULL Browser

워크스페이스별 로그인 환경과 단정한 인터페이스를 제공하는 Electron/Chromium 기반 데스크톱 브라우저입니다. 가벼운 사용 흐름을 목표로 개발 중입니다.

현재 공개 배포는 **macOS Apple Silicon용 1.0.1-beta.3 Pre-release**입니다. Windows 배포·검증은 사용자의 요청으로 보류했습니다.

현재 소스 개발 버전은 **1.1.0-beta.2 — NULL 에이전트 실험판**입니다. 아래 기존 다운로드에는 AI가 포함되지 않습니다. 에이전트 전용 사이드바와 단순화한 연결 설정, 실제 탭 이동/완료 검증을 추가했으며 새 Release는 공개하지 않았습니다. [에이전트 수정 보고서](docs/AGENT_REPAIR_2026-11-04.md), [AI 사용·보안·제약](docs/AI_INTEGRATION.md), [구현/검증 보고서](docs/AI_IMPLEMENTATION_REPORT_2026-11-04.md)를 확인하세요.

[GitHub Releases](https://github.com/cantcalc/null-browser/releases/tag/v1.0.1-beta.3) · [문제 제보](https://github.com/cantcalc/null-browser/issues) · [검증 보고서](docs/RELEASE_VERIFICATION_1.0.1-beta.3.md)

## 다운로드와 설치

- [macOS ARM64 DMG](https://github.com/cantcalc/null-browser/releases/download/v1.0.1-beta.3/NULL-1.0.1-beta.3-arm64.dmg)
- [macOS ARM64 ZIP](https://github.com/cantcalc/null-browser/releases/download/v1.0.1-beta.3/NULL-1.0.1-beta.3-arm64.zip)

실행 중인 기존 Aero/Vyro/NULL을 종료하고, DMG를 열어 **NULL.app**을 **Applications**로 복사합니다. ZIP은 압축을 풀어 앱을 복사합니다. 기존 프로필·워크스페이스 저장소 및 암호화 식별자는 데이터 호환을 위해 유지합니다. 설치 전 중요한 데이터는 백업하세요.

**테스트 배포이며 안정판이 아닙니다.** 현재 빌드는 로컬 ad-hoc 서명이고 **Apple Developer ID 서명/공증이 아닙니다**. Gatekeeper가 실행을 차단할 수 있습니다. 서명/공증을 우회하거나 완료로 표시하지 않았습니다. 서명 상태와 실제 검증 범위를 확인하고 설치 여부를 판단하세요.

일반 Intel Mac, Linux 및 Windows 설치 파일은 현재 Release에서 제공하지 않습니다. Windows 코드·기존 검사 기록은 보존하지만 추가 Windows 작업과 자동 배포는 중단했습니다.

## 주요 기능

- 주소 입력·검색, 뒤로/앞으로, 새로고침, 탭 고정·복제·음소거·닫은 탭 복구.
- 분할 보기, 페이지 내 찾기, 확대/축소, PDF 저장, 개발자 도구.
- 북마크·방문 기록·검색 기록·다운로드·메모 관리.
- 워크스페이스별 로그인·쿠키·사이트 저장소 분리.
- 다크/화이트, 탭 인터페이스 5종과 검색 홈 5종의 독립 선택.
- 비영구 세션의 시크릿 창.
- Chrome 웹 스토어 설치 연결과 일부 확장 API 보완.

공개 1.0.1 배포본은 내장 AI를 제공하지 않습니다. 개발 소스 1.1에는 BYOK AI 사이드바·페이지 참조·에이전트를 추가했습니다. 커맨드 팔레트, 기존 내장 번역·광고차단, 검색 추천은 복구하지 않았습니다. AI 선택 텍스트 번역과 확장 프로그램의 번역/광고차단은 별개입니다.

## NULL AI 개발판

Gemini / Groq / OpenRouter 키를 워크스페이스별로 연결하고, 확인된 무료 모델로 스트리밍 대화·페이지/선택 텍스트 분석·캡처 전송·제한된 브라우저 에이전트를 사용할 수 있도록 구현했습니다. 기본 비활성화이며 페이지 데이터/제공자 변경 전송에는 동의가 필요합니다. 키는 메인 프로세스의 비동기 OS 암호화 저장소를 사용하고 원본을 renderer/웹사이트/확장에 반환하지 않습니다.

대화는 메모리에만 유지하고 종료 시 삭제합니다. 에이전트의 중요하거나 불확실한 작업은 개별 승인하고 로그인/비밀번호/결제/파일 업로드는 직접 처리합니다. 일반/시크릿 및 워크스페이스 저장소 정책을 유지합니다.

**1.1.0-beta.2에서 실제 Gemini 연결로 “유튜브 켜줘” → 실제 페이지 표시 → 완료 답변을 확인했습니다.** 다른 제공자 유효 키, 실제 한도 전환·이미지 이해·복잡한 여러 사이트 에이전트 작업은 아직 미검증입니다. 모의 API와 실제 브라우저 조작/암호화/UI 검사를 구분해 기록했습니다. 맥 패키지를 일반 앱 실행 방식(LaunchServices)으로 열어 실제 OS 암호화·재시작 후 키 복원을 확인했습니다. 테스트 도구의 실행 파일 직접 실행에서는 키체인 거부가 재현되어 실행 환경 차이를 기록했습니다. 안정판 완성을 뜻하지 않으며 무료 계정 과금 상태·모델 가용성·외부 제공자의 데이터 보관도 보장하지 않습니다.

## UI와 테마

일반 테마는 **다크 / 화이트**이며 별도 강조 색상 설정은 없습니다. 사이트 색상이 브라우저 상단을 바꾸지 않습니다.

설정 → **모양 및 새 탭**에서 선택하고 **설정 저장**을 누릅니다.

| 구분 | 선택지 |
| --- | --- |
| 탭 인터페이스 | Core / Air / Studio / Focus / Outline |
| 검색 홈 | Center / Compact / Elevated / Horizontal / Grounded |

검색 홈은 로고·검색창의 위치, 크기, 간격, 형태가 다른 프리셋 방식입니다. 드래그/임의 좌표 편집은 없습니다. 로고와 검색창만 표시하고 긴 placeholder·추천·기록 드롭다운은 사용하지 않습니다. 설정 취소와 재실행 복원을 지원합니다.

## 워크스페이스별 로그인 환경

생성·이름 변경·삭제·전환을 지원합니다.

- **분리:** 쿠키·로그인 세션, localStorage, IndexedDB, CacheStorage 등 사이트 데이터.
- **공유:** 북마크, 방문/검색 기록, 설정, 일반 창 다운로드 목록, 설치된 확장 목록.
- 확장은 각 세션 안에서 실행되고 해당 저장소를 사용합니다.
- 새 워크스페이스로 기존 쿠키를 복사하지 않습니다.

별도 IP나 OS 사용자 수준 격리를 뜻하지 않습니다. 저장소/테스트 HTTP 격리는 검사했지만 실제 Google/OAuth의 모든 조합을 보장하지 않습니다.

## 시크릿 모드

툴바의 선글라스 버튼 또는 **Cmd+Shift+N**으로 엽니다. 검정/보라색 배경과 보라색 로고를 사용하며 선택한 검색 홈 배치는 유지합니다. 워크스페이스·설정 UI는 표시하지 않습니다. 비영구 세션과 일반 기록 분리를 사용하고 일반 확장 브리지는 연결하지 않습니다. 익명화나 모든 추적 차단을 보장하지 않습니다.

## Chrome 확장 프로그램

퍼즐 버튼 또는 설정 → 확장 프로그램에서 웹 스토어를 열고, 확장 페이지의 추가 버튼과 권한 확인으로 설치합니다. URL 직접 입력·수동 압축 해제가 기본 경로는 아닙니다.

누적 QA에서는 Dark Reader와 uBlock Origin Lite의 공개 스토어 설치·페이지 적용·팝업·재시작·제거를 확인했습니다. 별도 프로필에서 TWP의 번역/복원과 Volume Master의 오디오 증폭도 확인했습니다.

Electron/호환 라이브러리는 Chrome API 전체 구현이 아닙니다. `permissions.remove`의 실제 세부 권한 회수에는 제한이 있고, 확장 자동 업데이트는 꺼져 있습니다. 일부 userScripts/tabCapture/native companion, 모든 광고 및 YouTube 광고 차단은 보장하지 않습니다. 기존 페이지 새로고침이 필요하거나 worker 경고가 남을 수 있습니다. Google의 공식 Chrome 호환 인증 제품이 아닙니다.

## 자동 업데이트

제공자는 **GitHub · cantcalc/null-browser**입니다. 시작 확인, 설정의 수동 확인, 사용자가 누르는 다운로드·진행률·재시작 설치 UI를 유지합니다. 개발 실행에서는 updater를 사용하지 않습니다.

격리된 이전 QA 버전에서 공개 macOS 새 버전 발견·ZIP 다운로드·진행률을 확인했습니다. **자동 재시작 설치는 아직 검증하지 못했으며, 배포 서명/공증 없는 macOS의 자동 설치를 보장하지 않습니다.** 기존 Aero/로컬 NULL 1.0.0은 이전 provider를 포함하므로 이번 설치본으로 한 번 수동 교체해야 새 저장소를 사용합니다.

Release에는 macOS ZIP, `latest-mac.yml`, blockmap 및 검증 파일을 함께 제공합니다. `SHA256SUMS.txt`, `artifact-manifest-darwin.json`, `signing-status-mac.json`, `smoke-darwin.json`으로 파일·소스 commit·검증 상태를 확인할 수 있습니다.

## 기술 스택과 개발

Electron **45.2.1**/Chromium, React **19**, TypeScript, Vite **6**, Tailwind CSS를 사용합니다. 웹페이지는 탭별 네이티브 **WebContentsView**입니다. 확장은 `electron-chrome-extensions`/`electron-chrome-web-store`, 앱 업데이트와 패키징은 `electron-updater`/`electron-builder`를 사용합니다.

웹페이지 Node 통합은 비활성화하고 context isolation과 sandbox를 사용합니다. 포괄적인 보안 감사 완료를 뜻하지 않습니다.

Node.js **22**, npm, Git과 macOS 개발 환경이 필요합니다.

```sh
git clone https://github.com/cantcalc/null-browser.git
cd null-browser
npm ci
npm run dev
```

```sh
npx tsc --noEmit
npm run typecheck:electron
npm run build
npm run test:navigation
npm run test:tabs
npm run test:core
npm run test:runtime
npm run test:settings
npm run test:search-inputs
npm run test:interactions
npm run test:lightweight
npm run test:workspaces
npm run test:extensions
npm run test:ai
npm run test:ai:ui
```

네이티브 검사는 데스크톱 세션이 필요하고 격리된 QA 프로필을 사용합니다. QA의 디버깅 포트를 제품 기본 실행이나 개인 프로필에 추가하지 않습니다.

```sh
npm run dist:mac
npm run verify:release -- darwin
```

로컬 패키징은 `--publish never`입니다. Developer ID가 없으면 ad-hoc 사실을 기록하고, 유효한 배포 서명을 ad-hoc으로 덮지 않습니다.

## GitHub Actions

main/PR에서 전체 Git 기록 secret 검사, TypeScript·빌드·navigation·배포 의존성 감사를 실행합니다. 태그 또는 수동 실행에서 **macOS ARM64만** 패키징·검증합니다. Windows 업데이트 workflow는 비활성화했습니다.

모든 필수 job 통과 후 파일을 초안에 올리고 공개합니다. beta는 Pre-release이며 공개한 동일 Release는 덮어쓰지 않습니다. 안정판은 Developer ID 서명/공증을 별도로 요구합니다.

서명 자격 증명은 GitHub Secrets의 `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`로 관리합니다. Release 업로드는 job 범위 GITHUB_TOKEN을 사용합니다. 소스에 토큰을 넣지 않습니다.

## 알려진 문제와 라이선스

- 복원된 미방문 탭은 선택할 때 로딩하므로 첫 방문에 로딩 시간이 필요합니다.
- 무거운 탭을 많이 사용하면 메모리가 증가합니다. Chrome 대비 경량/속도 우위 인증은 없습니다.
- 모든 확장·Google/OAuth·DRM·장시간 사용·하드웨어를 전수 검사하지 않았습니다.
- 개발/빌드 도구 moderate 보안 권고가 남습니다. 배포 의존성 검사 결과와 한계는 [점검 기록](docs/SECURITY_REVIEW.md)을 확인하세요.

프로젝트 소스는 [MIT](LICENSE)입니다. 사용자 제공 로고/아이콘은 코드 MIT와 구분하는 브랜딩 리소스입니다. 의존성은 각자의 라이선스를 따릅니다. [제3자 고지](THIRD_PARTY_NOTICES.txt), [의존성 목록](docs/DEPENDENCIES.json), [보완 출처](docs/licenses)를 제공하고 설치본에는 Electron/Chromium 고지도 포함합니다.
