# NULL Browser

워크스페이스별 로그인 환경과 단정한 인터페이스를 제공하는 Electron/Chromium 기반 데스크톱 브라우저입니다. 가벼운 사용 흐름을 목표로 개발 중이며, 현재 배포는 **1.0.1-beta.1 테스트 버전(Pre-release)**입니다.

[다운로드 · GitHub Releases](https://github.com/cantcalc/null-browser/releases) · [문제 제보](https://github.com/cantcalc/null-browser/issues)

> 안정판이 아닙니다. 모든 Chrome 확장 호환, Chrome 대비 성능 우위, 장시간 무충돌을 보장하지 않습니다. macOS 배포 서명·공증과 Windows 서명 여부는 아래 설명과 각 Release의 검증 파일을 확인하세요.

## 주요 기능

- 주소 입력·검색, 뒤로/앞으로, 새로고침, 탭 고정·복제·음소거·닫은 탭 복구.
- 분할 보기, 페이지 내 찾기, 확대/축소, PDF 저장, 개발자 도구.
- 북마크·방문 기록·검색 기록·다운로드와 메모 관리.
- 워크스페이스별 쿠키·로그인·사이트 저장소 분리.
- 다크/화이트 테마, 탭 인터페이스 5종과 검색 홈 5종의 독립 선택.
- 별도 비영구 세션을 사용하는 시크릿 창.
- Chrome 웹 스토어 설치 연결과 일부 Chrome 확장 API 보완.

내장 AI, 커맨드 팔레트, 브라우저 내장 번역·광고차단, 검색 추천은 제공하지 않습니다. 번역/광고차단 확장의 동작과 내장 기능은 별개입니다.

## 다운로드 및 설치

| 환경 | 파일 | 상태 |
| --- | --- | --- |
| macOS Apple Silicon | ARM64 DMG / ZIP | 로컬·CI 실행 검사 대상. Developer ID/공증 없는 빌드는 Gatekeeper가 차단할 수 있음 |
| Windows x64 | NSIS Setup EXE | CI에서 무인 설치·실행·재실행·제거 검사. 일반 PC의 모든 대화형 설치 환경을 보장하지 않음 |

[Releases](https://github.com/cantcalc/null-browser/releases)에서 운영체제에 맞는 설치 파일을 받으세요. Linux, macOS Intel, Windows ARM64 설치 파일은 현재 제공하지 않습니다.

### macOS

1. 실행 중인 기존 Aero/Vyro/NULL을 종료합니다.
2. DMG를 열어 **NULL.app**을 **Applications**로 복사합니다. ZIP을 선택했다면 압축을 풀어 앱을 복사합니다.
3. Applications에서 NULL을 실행합니다.

현재 인증서가 없는 빌드는 로컬 ad-hoc 서명이며 Apple Developer ID 서명/공증이 아닙니다. 인터넷에서 받은 앱은 macOS가 실행을 막을 수 있습니다. 보안 검증을 우회한 앱이라고 안내하거나 공증 완료로 표시하지 않습니다. 실행 허용 여부는 배포자의 신뢰성과 서명 상태를 확인한 뒤 판단하세요.

### Windows

1. `NULL-Setup-버전-x64.exe`를 실행합니다.
2. 설치 경로를 선택하고 설치합니다.
3. 시작 메뉴나 바탕화면에서 NULL을 실행합니다.
4. 삭제는 Windows 앱 설정 또는 제공된 제거 프로그램에서 진행합니다.

서명 인증서가 없는 빌드는 Authenticode 미서명이며 SmartScreen 경고가 나타날 수 있습니다. 기존 Aero와의 데이터 호환을 위해 앱 식별자를 유지하므로 별개의 완전히 독립된 제품으로 동시에 설치·실행하는 용도는 검증하지 않았습니다.

### 무결성과 기존 데이터

Release의 `SHA256SUMS.txt` 및 `artifact-manifest-*.json`으로 실제 파일 해시·버전·소스 커밋을 확인할 수 있습니다. 플랫폼별 `smoke-*.json`, `signing-status-*.json`은 해당 빌드의 검사 결과입니다.

기존 프로필 경로, 워크스페이스 partition, 번들 ID와 암호화 저장소 식별자를 보존합니다. 이는 제품 이름 변경 누락이 아니라 데이터 호환용입니다. 중요한 데이터는 설치 전에 백업하세요. `aero://`, `vyro://`, `browser://` 내부 주소는 `null://` 주소의 호환 별칭으로 처리합니다.

## UI와 테마

일반 테마는 **다크 / 화이트**입니다. 사이트 색상이 브라우저 상단 색상을 변경하지 않습니다. 별도 강조 색상 설정은 없습니다.

설정 → **모양 및 새 탭**에서 각각 선택하고 **설정 저장**을 누릅니다.

| 구분 | 선택지 |
| --- | --- |
| 탭 인터페이스 | Core / Air / Studio / Focus / Outline |
| 검색 홈 | Center / Compact / Elevated / Horizontal / Grounded |

검색 홈은 로고와 검색창의 위치·크기·간격·형태가 다른 프리셋 방식입니다. 임의 좌표 편집이나 드래그 배치 기능은 없습니다. 로고와 검색창만 표시하고, 긴 placeholder·추천·방문 기록 드롭다운은 사용하지 않습니다. 설정 변경 취소와 재실행 복원을 지원합니다.

## 워크스페이스별 로그인 환경

워크스페이스 생성·이름 변경·삭제·전환을 지원합니다.

- **분리:** 쿠키, 로그인 세션, localStorage, IndexedDB, CacheStorage 등 사이트 데이터.
- **공유:** 북마크, 방문/검색 기록, 설정, 일반 창 다운로드 목록, 설치된 확장 목록.
- 확장은 각 워크스페이스 세션 안에서 실행되고 해당 세션의 저장소를 사용합니다.
- 새 워크스페이스로 기존 쿠키를 복사하지 않으므로 계정마다 별도로 로그인해야 합니다.

분리는 별도 IP나 OS 사용자 수준의 보안 격리를 뜻하지 않습니다. 저장소 및 테스트 HTTP 요청 격리는 검사했지만 실제 Google 다중 계정/OAuth의 모든 조합을 검증한 것은 아닙니다.

## 시크릿 모드

툴바의 선글라스 버튼 또는 **Cmd+Shift+N**(Windows: **Ctrl+Shift+N**)으로 엽니다.

검정/보라색 chrome과 보라색 홈 로고를 사용하며, 일반 창의 선택한 검색 홈 배치를 유지합니다. 워크스페이스·브라우저 설정 UI는 표시하지 않습니다. 비영구 세션을 사용하고 일반 방문/검색 기록과 분리하며, 일반 확장 브리지는 연결하지 않습니다. 시크릿은 익명화나 모든 추적 방지를 보장하지 않습니다.

## Chrome 확장 프로그램

퍼즐 버튼 또는 설정 → 확장 프로그램에서 Chrome 웹 스토어를 엽니다. 확장 페이지의 추가 버튼과 권한 확인을 통해 설치할 수 있습니다. URL 직접 입력·수동 압축 해제가 기본 경로는 아닙니다.

누적 QA에서는 Dark Reader와 uBlock Origin Lite의 실제 공개 스토어 설치·페이지 적용·팝업 조작·재시작·제거를 확인했습니다. 별도 테스트 프로필에서 TWP Translate Web Pages의 번역/원문 복원과 Volume Master의 실제 오디오 증폭도 확인했습니다.

**지원 범위의 제한:**

- Electron/호환 라이브러리는 Chrome 확장 API 전체 구현이 아닙니다.
- `permissions.remove`의 실제 세부 권한 회수에는 제한이 있습니다. 모든 권한 관리가 Chrome과 같다고 가정하지 마세요.
- 확장 자동 업데이트는 꺼져 있습니다. 권한 변경 승인 경로가 완성되기 전에는 자동 갱신하지 않습니다.
- 일부 userScripts/tabCapture/native companion 기능, 모든 광고 및 YouTube 광고 차단은 보장하지 않습니다.
- 설치 후 이미 열린 페이지는 새로고침이 필요할 수 있으며 일부 worker/메시지 경고가 남을 수 있습니다.
- Google의 공식 지원 브라우저 판정과 실제 설치 브리지는 별개입니다. 공식 Chrome 호환 인증 제품이 아닙니다.

## 자동 업데이트

업데이트 제공자는 **GitHub · cantcalc/null-browser**입니다. 앱 시작 확인, 설정의 수동 확인, 사용자가 누르는 다운로드·진행률·재시작 설치 UI를 제공합니다. 개발 실행에서는 updater를 사용하지 않습니다.

beta 설치본은 Pre-release 업데이트를 확인합니다. 기존 Aero/이전 로컬 NULL 1.0.0은 이전 저장소 설정을 포함하므로 새 설치본으로 한 번 수동 교체해야 합니다. 기존 저장소와 배포 파일은 변경하지 않습니다.

macOS에는 ZIP과 업데이트 메타데이터를 함께 배포합니다. 다만 **서명/공증 조건을 충족하지 않은 macOS 빌드의 자동 설치는 보장하지 않습니다.** 메타데이터 연결, 새 버전 탐지, 다운로드, 실제 재시작 설치는 각각 별도 검증 항목입니다. Release의 검사 결과를 확인하세요.

## 기술 스택

- Electron **45.2.1**, 포함된 Chromium 엔진.
- React **19**, TypeScript, Vite **6**, Tailwind CSS.
- 웹페이지는 탭별 **WebContentsView**로 표시합니다. 웹페이지를 일반 iframe으로 대체한 구조가 아닙니다.
- `electron-chrome-extensions`, `electron-chrome-web-store`로 확장 설치와 API를 연결합니다.
- `electron-updater`, `electron-builder`, Windows NSIS 패키징을 사용합니다.
- 웹페이지의 Node 통합은 비활성화하고 context isolation과 sandbox를 사용합니다. 보안 감사 완료를 뜻하지 않습니다.

## 개발 환경

Node.js **22**, npm, Git이 필요합니다. macOS 패키징은 macOS, Windows 설치/실행 검사는 Windows 환경을 사용하세요.

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
```

네이티브 runtime 검사는 데스크톱 세션이 필요합니다. Linux의 GUI 없는 터미널에서는 동일 조건으로 실행되지 않을 수 있습니다.

```sh
npm run test:settings
npm run test:search-inputs
npm run test:interactions
npm run test:lightweight
npm run test:workspaces
npm run test:extensions
```

검사는 격리된 임시 프로필을 사용합니다. QA의 CDP/inspector 포트를 제품의 기본 실행에 추가하지 않습니다. 실제 사용 프로필로 임의 진단 서버를 열지 마세요.

### 로컬 패키징

```sh
npm run dist:mac
npm run verify:release -- darwin

# Windows x64
npm run dist:win
npm run verify:release -- win32
```

로컬 명령은 항상 `--publish never`이며 GitHub에 자동 공개하지 않습니다. macOS는 Developer ID가 없으면 ad-hoc 서명 사실을 기록하고, 인증서가 있으면 기존 배포 서명을 ad-hoc으로 덮지 않습니다.

### GitHub Actions 배포

main/PR에서는 TypeScript·빌드·입력 파서·배포 의존성 감사와 Git 기록 secret 검사를 실행합니다. 버전과 일치하는 `v*` 태그에서는 macOS arm64 / Windows x64 설치본을 빌드하고 무결성·runtime smoke를 검사합니다. Windows는 무인 설치와 제거도 실행합니다.

모든 필수 CI 검사가 성공해야 초안 Release에 파일을 올린 뒤 공개합니다. beta 태그는 Pre-release로 공개하며, 이미 공개한 동일 태그는 덮어쓰지 않습니다. 안정판 태그는 macOS Developer ID/공증과 Windows 유효 서명을 별도로 요구합니다. 수동 Release 작성과 이 자동 경로를 같은 태그에 중복 사용하지 마세요.

서명 자격 증명은 저장소의 GitHub Secrets로만 설정합니다:

- macOS: `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- Windows: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`.
- Release 업로드: 작업에 한정된 `GITHUB_TOKEN` 사용. 개인 토큰을 소스에 넣지 않습니다.

## 알려진 문제와 검증 범위

- 복원된 미방문 탭은 선택할 때 로딩합니다. 시작 부하는 줄지만 첫 방문에는 로딩 시간이 필요합니다.
- 이미 사용한 무거운 탭을 많이 열면 메모리는 증가합니다. Chrome보다 가볍다는 비교 인증은 없습니다.
- 실제 Google/OAuth, DRM/영상 장시간 재생, 모든 물리 트랙패드·마우스·다중 모니터·프린터·확장은 전수 검증하지 않았습니다.
- 개발/빌드 도구의 moderate 보안 권고가 남아 있습니다. 배포 의존성 검사 결과와 한계는 [점검 기록](docs/SECURITY_REVIEW.md)을 확인하세요.
- 테스트 통과를 장시간 crash-free 또는 정식 보안 인증으로 표현하지 않습니다.

## 라이선스와 제3자 고지

프로젝트 고유 소스의 별도 사용 라이선스는 아직 지정하지 않았으며 패키지에는 `UNLICENSED`로 표시합니다. 의존성은 각자의 라이선스를 따릅니다. 사용자 제공 로고는 의존성 라이선스에 포함하지 않습니다.

[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt), [의존성 목록](docs/DEPENDENCIES.json), [보완 고지 출처](docs/licenses)를 확인하세요. 설치본에는 Electron/Chromium의 라이선스 원문도 동봉합니다. 라이선스 점검 기록이 별도 법률 검토를 의미하지는 않습니다.
