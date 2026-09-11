# Aero Browser — Basic Browser Completeness Report

검토일: 2026-09-10  
프로젝트: `/Users/jeong-yeongjun/.gemini/antigravity/scratch/custom-browser`  
범위: MASTER PHASE 요구사항과 현재 소스·실행 결과 대조

## Implemented

- WebContentsView 기반 탭 구조와 기존 Workspace/Split 구조를 유지했다.
- 주소창과 New Tab이 같은 URL 파서·추천 엔진을 사용한다.
- 열린 탭·북마크·방문 기록·검색 기록을 메모리에서 통합 추천하며, 입력마다 디스크를 읽지 않는다.
- 검색 실행 시에만 별도 Search History를 저장하고, 검색 기록 저장 ON/OFF를 추가했다.
- 방문 기록과 검색 기록을 각각 조회·검색·개별 삭제·전체 삭제할 수 있다.
- 방문 기록은 오늘/어제/이전 날짜 그룹으로 표시하고 URL 복사·새 탭 열기 동작을 제공한다.
- 북마크 라이브러리에 열기·새 탭·URL 복사·이름/URL 수정·삭제를 연결했다.
- 북마크 바를 설정과 `⌘⇧B`로 표시/숨길 수 있고, 일반 클릭·중간 클릭 새 탭을 지원한다.
- 다운로드에 원본 URL/호스트·상태·진행률을 표시하고, URL 복사·열기·Finder 표시·취소·목록에서 제거를 제공한다. 목록에서 제거해도 파일은 삭제하지 않는다.
- 방문 기록·검색 기록·다운로드 기록 삭제 범위에 지난 1시간/24시간/7일/전체를 추가했다. 북마크·메모·설정·워크스페이스는 삭제 대상이 아니다.
- `⌘O` 파일 선택기, `⌘P` 네이티브 인쇄, PDF 저장 대화상자, HTTP/HTTPS 페이지 소스 보기와 복사 유틸리티를 연결했다.
- 외부 앱 프로토콜(mailto/tel/vscode/zoommtg)은 확인 후 실행하도록 바꿨다.
- 탭 사이 빈 영역에서도 가로 휠 이벤트가 탭 스트립으로 전달되도록 보완했다.
- 테스트 실행 방법이 명확하도록 `npm run test:tabs`를 추가했다.

## Existing Features Reused

- `electron/TabManager.ts`: 탭 생성·전환·닫기·bounds·분할·새로고침·DevTools·Find·Zoom·번역·오류·crash lifecycle.
- `electron/DataManager.ts`: atomic JSON 저장, userData 권한 제한, 설정·북마크·기록·닫은 탭·세션·권한 저장.
- `electron/DownloadManager.ts`: Electron `will-download`, 진행/완료/취소/중단 상태, native open/Finder 흐름.
- `electron/PermissionManager.ts`: site origin별 Allow/Block/Ask 및 private session 분리.
- `BrowserErrorView`, `FindBar`, Site Info, session restore, private partition, native application menu.

## History / Search History

`DataManager`에 다음 제한과 저장 규칙을 적용했다.

- `MAX_HISTORY_ENTRIES = 2000`
- `MAX_SEARCH_HISTORY_ENTRIES = 1000`
- `MAX_RECENTLY_CLOSED = 50`
- 같은 URL/검색어는 30초 이내 navigation 중복만 갱신한다. 나중에 다시 방문한 기록은 보존한다.
- private window에서는 방문 기록·검색 기록·닫은 탭·세션 저장을 하지 않는다.
- 검색 기록 OFF는 persistence layer에서 실제로 저장을 차단하며 기존 기록은 자동 삭제하지 않는다.

경로:

- `/Users/jeong-yeongjun/.gemini/antigravity/scratch/custom-browser/electron/DataManager.ts`
- `/Users/jeong-yeongjun/.gemini/antigravity/scratch/custom-browser/src/utils/suggestionEngine.ts`
- `/Users/jeong-yeongjun/.gemini/antigravity/scratch/custom-browser/src/components/LibraryModal.tsx`

## Bookmarks

북마크는 기존 Netscape HTML import/export 데이터와 동일한 저장소를 사용한다. 수정은 HTTP/HTTPS URL만 허용하며, 검색·일반 열기·새 탭 열기·URL 복사·삭제가 실제 IPC에 연결되어 있다. 폴더와 drag reorder는 아직 추가하지 않았으므로 Bookmark Bar는 평면 목록 기준이다.

## Downloads

다운로드 메타데이터에 `sourceUrl`과 `sourceHostname`을 추가했다. 다운로드 상태가 완료·취소·중단인지 구분하며, 진행 중 항목은 목록에서 제거하지 못하게 했다. `Remove from List`는 persisted metadata와 live list만 지우고 저장 파일은 건드리지 않는다. 시간 범위 삭제도 live/persisted 항목에 동일하게 적용한다.

## Privacy / Permissions

- History/Search History/Download History, Cookies/Site Data, Cache를 독립적으로 선택할 수 있다.
- Cookie/Cache의 시간 범위는 Electron API 특성상 전체 session 데이터 삭제로만 처리된다. UI에서 해당 항목에 시간 범위가 정확히 적용된다고 주장하지 않는다.
- Site Info에서 HTTPS 상태, origin, zoom, mute, notification/location/camera·microphone 권한을 확인·변경한다.
- 일반 창은 persistent session, private 창은 임시 partition을 사용한다.
- 외부 프로토콜은 명시적 사용자 확인 후 OS로 전달한다.

## Print / PDF / Files

- Print: `WebContents.print()` 네이티브 인쇄 대화상자.
- PDF: `WebContents.printToPDF()`와 native save dialog. 저장 파일은 0600 모드로 생성 요청한다.
- Open File: native picker에서 HTML/text/image/PDF를 선택하고 `file://` 탭으로 연다. renderer에 unrestricted filesystem API를 노출하지 않는다.
- View Source: HTTP/HTTPS 페이지에서 `document.documentElement.outerHTML`을 최대 2MB까지 앱 내부 `pre` 뷰어로 표시한다. `data:` URL이나 별도 unrestricted BrowserWindow로 우회하지 않는다.
- Copy utilities: URL, title, title+URL, Markdown, hostname, origin, download URL.

## Browser Menus / Shortcuts

Native File menu에 Open File/Print/Save as PDF를 추가했고, Bookmarks menu에 Bookmark This Page/Bookmark Bar/Bookmark Library를 추가했다. 앱 shortcut과 menu action은 preload allowlist를 통해 React/App handler에 연결된다.

## Reliability

- 로드 실패와 renderer crash는 기존 Aero error/recovery UI를 유지한다.
- popup은 새 BrowserWindow를 무제한 생성하지 않고 관리 탭 흐름으로 흡수한다.
- session restore와 closed-tab stack은 기존 구현을 사용한다.
- 현재 확인한 것은 API·lifecycle·UI smoke 수준이다. 다중 실제 사이트 장시간 메모리 벤치마크, DMG 설치·재실행, YouTube fullscreen/PiP는 별도 QA가 필요하다.

## Security

실제로 적용된 보호:

- WebContentsView에 `contextIsolation`, `sandbox`, `nodeIntegration: false`.
- IPC는 preload의 필요한 메서드만 노출.
- `javascript:`, 임의 Electron protocol, 허용 목록 외 외부 프로토콜 navigation 차단.
- private 데이터는 persistent history/search/closed/session에 기록하지 않음.
- 외부 번역 endpoint에는 사용자가 번역한 텍스트가 전송될 수 있으며, 번역은 완전한 로컬/오프라인 기능이 아니다.
- 광고 차단은 EasyList/Google Safe Browsing이 아니다. 현재는 내장 host/path 휴리스틱 범위다.

## Runtime Tests

다음 명령을 최종 실행했고 모두 성공했다.

| 명령 | 결과 |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm run typecheck:electron` | PASS |
| `npm run build` | PASS |
| `npm run test:navigation` | PASS |
| `npm run test:tabs` | PASS — 실제 WebContentsView 20개 생성 후 19개 닫기와 전체 정리 |

개발 서버 `http://localhost:5173/`에서 확인한 항목:

- `work` 기본 워크스페이스 노출
- 주소창·New Tab 검색 입력 구조
- Command Palette의 파일/인쇄/PDF/페이지 소스/복사 명령
- Library의 북마크·방문 기록·검색 기록·다운로드 4개 탭
- 현재 서버는 계속 실행 중이며, 명령은 `npm run dev`이다.

## Browser Completeness Matrix

| 기능 | 상태 | 근거/제한 |
|---|---|---|
| Navigation / Tabs | DONE | WebContentsView와 parser/IPC 연결 |
| History | DONE | bounded persistent store + Library 관리 |
| Search History | DONE | 별도 저장·설정·추천·삭제 |
| Bookmarks | DONE | 수정·검색·복사·열기·import/export |
| Bookmark Bar | PARTIAL | 평면 목록, 폴더/drag reorder 없음 |
| Downloads | DONE | real will-download + metadata/actions |
| Print / PDF / Open File | DONE | Electron native APIs + dialogs |
| View Source / Copy utilities | DONE | HTTP/HTTPS source viewer + copy actions |
| Find / Zoom / Per-site Zoom | DONE | 기존 구현 재사용 및 검증 필요 항목 유지 |
| Cookies / Site Data | PARTIAL | 개별 origin 삭제와 전체 삭제, time range 제한 |
| Site Permissions | PARTIAL | Site Info 중심. 전역 permission 관리 화면은 없음 |
| Popups | PARTIAL | managed tab으로 흡수; 사이트별 popup allowlist 없음 |
| External Protocols | DONE | allowlist + confirmation |
| Fullscreen / PiP | PARTIAL | Electron/Chromium 경로를 방해하지 않지만 site matrix 미검증 |
| Media tab state | DONE | audio/mute event와 context/Site Info 연결 |
| HTTPS / Certificate UX | PARTIAL | HTTPS/origin 표시; 상세 certificate viewer 없음 |
| Error / Offline page | DONE | did-fail-load + Aero recovery UI |
| Tab crash recovery | DONE | render-process-gone + reload/close UI |
| Session restore / startup pages | PARTIAL | 구현됨; crash-recovery 전용 복구 UX는 미검증 |
| Private browsing | DONE | temporary partition + persistence guards |
| Multi-window / default browser | PARTIAL | 코드 연결; 설치 후 OS별 QA 필요 |
| Native menus / shortcuts | DONE | menu IPC + standard shortcuts |
| Tab search / duplicate awareness | DONE | Command Palette titles and duplicate markers |
| Import / Export | DONE | Netscape bookmark HTML + settings JSON |
| Languages / spell check | PARTIAL | Chromium spellcheck 기반; 선호 언어 관리 UI 없음 |
| Safe Browsing / malicious site warning | MISSING | Chromium 사용만으로 Chrome Safe Browsing을 주장하지 않음 |
| Updates | PARTIAL | diagnostics/version은 있음; signed updater 없음 |
| Profiles | MISSING | Workspace와 Profile은 별도 개념이며 profile store 없음 |
| Passwords / Autofill | DEFERRED FOR SECURITY | 민감 데이터 저장 구조를 만들지 않음 |
| Extensions | DEFERRED | Chrome extension ecosystem 제외 |
| Cloud sync | DEFERRED | 계정/backend 제외 |
| AI | NOT NEEDED FOR AERO | 사용자 요청대로 추가하지 않음 |
| DMG / EXE distribution | PARTIAL | macOS 설정 존재; 설치/Windows EXE 릴리스 QA 미완료 |

## Remaining Basic Features

현재 실제로 남은 항목은 다음과 같다.

1. Bookmark Bar folder와 drag reorder.
2. 전역 Site Permissions 목록/검색/reset 화면.
3. Cookie/third-party cookie 정책과 site별 예외 UI.
4. certificate 상세 정보와 fullscreen/PiP/실제 OAuth popup 회귀 테스트.
5. 선호 언어 순서 관리 UI와 update checker의 서명된 배포 경로.
6. Safe Browsing은 공식 공급자/정책 없이 가짜 hostname blacklist로 구현하지 않고 MISSING으로 유지.
7. Profiles, passwords, autofill, extensions, cloud sync는 별도 보안/계정 설계 후 진행.
8. DMG 설치 후 첫 실행 온보딩·재실행, Windows EXE, 장시간 성능 QA.

## Conclusion

이번 단계에서 이전에 “있다”고만 설명되던 기록·검색·북마크·다운로드·파일·인쇄 경로를 실제 저장소/IPC/native API/UI로 연결했다. 위 표의 PARTIAL/MISSING/DEFERRED 항목은 구현되지 않은 범위를 감추지 않은 현재 상태이며, 완성으로 오인하면 안 된다.
