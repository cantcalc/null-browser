# Aero Browser — Basic Completeness Final Gap Report

작성일: 2026-09-10

이번 작업은 WebContentsView, Workspace/Split 구조, UI 리디자인, AI 기능을 변경하지 않고 Basic Browser Completeness의 실제 누락 항목만 보완했다.

## Finished Basic Gaps

### Permissions

- Settings > 개인정보 및 백업에 전역 사이트 권한 목록을 추가했다.
- origin 검색과 권한별 필터를 지원한다.
- Allow / Block / Ask(기본값으로 초기화), 사이트별 전체 초기화를 지원한다.
- Site Info와 Settings가 같은 IPC/저장소를 사용한다.
- 일반 창의 결정은 기존 `DataManager`에 저장된다.
- Private Session의 결정은 `PermissionManager` 메모리에만 유지되며 일반 저장소에 기록하지 않는다.
- 현재 Electron에서 실제로 사용 중인 `notifications`, `geolocation`, `media`를 노출한다. `media`는 Electron permission API 특성상 카메라와 마이크를 하나의 실제 권한으로 표시한다.

### Cookies / Site Data

- Settings에서 `쿠키 허용`과 `서드파티 쿠키 차단`을 선택할 수 있다.
- 선택한 정책은 Electron `webRequest.onBeforeSendHeaders`와 `onHeadersReceived`에 연결되어 Cookie/Set-Cookie 헤더를 실제로 제어한다.
- 정확한 origin 예외에 대해 항상 허용/차단을 설정할 수 있다.
- 서드파티 판정은 현재 최상위 문서와 요청 호스트의 보수적인 도메인 비교를 사용한다. 완전한 Public Suffix List 기반 판정은 아니므로 복잡한 국가별 도메인에서 한계가 있다.
- Site Data 화면은 쿠키 저장소를 값 없이 origin/hostname/개수로 표시하고 개별 삭제한다.
- Site Info의 Clear Site Data와 Settings의 Site Data 삭제는 동일한 `session.clearStorageData({ origin })` backend를 사용한다.
- Electron에서 모든 localStorage/IndexedDB origin을 안정적으로 열거하는 API는 사용하지 않으므로, Site Data 목록은 확인 가능한 쿠키 데이터 기준이다.
- 데이터 목록을 주기적으로 읽거나 진단 로그에 쿠키 값·토큰을 기록하지 않는다.

### Crash Recovery

- persistent store에 clean-exit marker를 추가했다.
- 앱 시작 시 marker를 dirty로 전환하고 `before-quit`에서 clean으로 기록한다.
- 이전 실행이 비정상 종료된 경우에만 compact recovery surface를 표시한다.
- `탭 복원`은 이전 normal session을 복원하고 `새로 시작`은 복구 제안을 닫는다.
- Private Window는 session 저장과 crash recovery에서 제외된다.
- 정상 종료 후에는 recovery surface가 표시되지 않는다.

### Fullscreen / PiP / Popup QA

- HTML Fullscreen API enter/leave 이벤트를 TabManager에서 수신한다.
- HTML fullscreen 중에는 chrome/Aside를 숨기고 요청한 WebContentsView 하나를 전체 bounds로 배치한다.
- 종료 시 기존 split 상태와 chrome 레이아웃을 다시 사용한다.
- PiP 전용 framework는 추가하지 않았다. 기존 Chromium/Electron 경로를 가로막는 변경도 하지 않았다.
- 일반 `target=_blank`는 기존처럼 managed tab으로 흡수한다.
- 크기 지정 또는 named popup 형태의 OAuth-like popup은 opener 호환성을 위해 제한된 native child window를 허용한다.
- tab별 10초 내 3회 초과 popup 요청은 차단한다. 정상 인증 창과 일반 새 탭 동작을 우선 보존한다.
- 별도 인증 fixture와 실제 YouTube PiP를 이 실행에서 자동 재현하지는 못했으므로, 이 두 항목은 코드 회귀 방지 수준으로 기록한다.

### Languages

- Settings > 일반 설정에 선호 언어 목록을 추가했다.
- 한국어/English 추가, 제거, 순서 변경을 지원한다.
- 저장 시 Electron session의 Accept-Language와 spellcheck language에 적용한다.
- 맞춤법 검사 on/off도 실제 session API에 연결한다.
- 현재 UI에서 제공하는 언어는 한국어와 English이며, Electron 설치 환경에서 사용할 수 없는 사전은 자동으로 선택하지 않는다.

### Bookmark Bar

- 기존 Bookmark Bar에 drag reorder를 추가했다.
- 순서 변경은 기존 bookmark id와 저장 구조를 유지하며 IPC를 통해 영구 저장한다.
- 폴더와 대규모 Library 재작성은 범위 밖으로 유지했다.

## Remaining Partial

- Certificate issuer/validity 상세: 현재 프로젝트에서 안정적으로 조회할 수 있는 일반 WebContents certificate getter가 확인되지 않아 fake viewer를 만들지 않았다. Site Info에는 HTTP/HTTPS, hostname, origin과 Chromium validation 문구만 유지한다.
- Site Data: Electron API 한계로 쿠키 외 localStorage/IndexedDB를 전역 열거하지 않는다. origin을 알고 있을 때의 Clear Site Data는 실제 동작한다.
- Fullscreen/PiP: 실제 YouTube 또는 별도 video fixture를 통한 수동 런타임 QA는 별도 배포 환경에서 수행해야 한다. 관련 경로를 막는 코드 변경은 하지 않았다.
- OAuth popup: native child popup으로 opener 호환성을 개선했지만, 각 OAuth 제공자의 postMessage 정책을 모두 보장한다고 주장하지 않는다.
- Cookie third-party 판정: 완전한 PSL 구현이 아니라 보수적 host/site 비교다.

## Safe Browsing

**MISSING**

현재 host 기반 광고/추적 요청 차단은 Safe Browsing이 아니다. Google Safe Browsing과 동일하다고 주장하지 않는다.

## Deferred

- Profiles
- Password Manager
- Payment Autofill
- Cloud Sync
- Account System
- Chrome Web Store / Full Extension Compatibility
- AI 기능
- Signed Auto Update

## Update System

서명된 updater, code signing, notarization, signed update metadata가 준비되지 않았으므로 자동 업데이트를 추가하지 않았다. About에는 기존 Aero/Electron/Chromium 버전 정보만 유지한다.

## Tests

다음 명령을 실제 실행했고 모두 통과했다.

- `npx tsc --noEmit`
- `npm run typecheck:electron`
- `npm run build`
- `npm run test:navigation`
- `npm run test:tabs`

`test:tabs` 결과: 실제 Electron TabManager에서 20개 native tab 생성과 20개 view 소유 확인 후 cleanup 성공.

## Regression Scope Checked

기존 코드 경로와 타입/번들 기준으로 Tabs, WebContentsView, Omnibox, History, Search History, Bookmarks, Bookmark Bar, Downloads, Workspace, Split View, Private Window, Translation, Find, Zoom, Print, PDF, Open File, Command Palette, Site Info, Themes, Connected Chrome의 기존 구조를 유지했다.

이번 변경으로 새로 연결된 IPC는 permission global/reset, site data listing, cookie policy enforcement, crash recovery, bookmark reorder, fullscreen event relay다.
