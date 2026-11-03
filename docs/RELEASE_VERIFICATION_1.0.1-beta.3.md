# NULL Browser 1.0.1-beta.3 배포 검증 보고서

기준일: 2026-11-03 (한국 시간)

## 1. 배포 결과

**GitHub 공개 배포 완료. 안정판이 아닌 Pre-release입니다.**

- 소스: https://github.com/cantcalc/null-browser
- 다운로드: https://github.com/cantcalc/null-browser/releases/tag/v1.0.1-beta.3
- 공개 범위/기본 브랜치: Public / main
- 버전/태그: `1.0.1-beta.3` / `v1.0.1-beta.3`
- 실제 배포 소스 commit: `4b6f2f229b85a112db8605acf1c9035793b092f2`
- 빌드 및 공개 workflow: https://github.com/cantcalc/null-browser/actions/runs/41630154422
- 기존 로컬 Git 커밋 18개의 이력을 보존했습니다. 기존 Aero 저장소에 push·삭제·Release 수정은 하지 않았습니다.
- 원본 배포 태그 이후 main의 변경은 추가 검증 스크립트와 문서입니다. 위 commit으로 생성한 설치 파일을 같은 태그에서 임의 교체하지 않았습니다.

## 2. 실제 공개한 설치 파일

| 환경 | 실제 파일명 | 크기 |
| --- | --- | ---: |
| macOS ARM64 | `NULL-1.0.1-beta.3-arm64.dmg` | 130,800,676 B |
| macOS ARM64 | `NULL-1.0.1-beta.3-arm64.zip` | 125,232,736 B |
| Windows x64 NSIS | `NULL-Setup-1.0.1-beta.3-x64.exe` | 126,188,623 B |

함께 공개한 파일:

- 위 3개 설치 파일의 `.blockmap`.
- `latest-mac.yml`, `latest.yml`.
- `artifact-manifest-darwin.json`, `artifact-manifest-win32.json`.
- `signing-status-mac.json`, `signing-status-win.json`.
- `smoke-darwin.json`, `smoke-win32.json`.
- `SHA256SUMS.txt`.

총 **15개 asset**을 업로드했습니다. DMG/ZIP/EXE는 새 NULL 소스를 각각 macOS/Windows CI에서 빌드한 결과입니다.

## 3. 다운로드·버전·무결성 검사

- 저장소와 Release 페이지를 로그인 없이 요청해 HTTP 200을 확인했습니다.
- 공개 asset 15개를 인증 없이 다시 다운로드했습니다.
- 모든 asset의 크기와 SHA-256을 GitHub가 반환한 digest와 비교해 일치를 확인했습니다.
- 각 플랫폼의 업데이트 YAML에 들어 있는 파일명·크기·SHA-512와 실제 생성 파일의 일치를 검사했습니다.
- macOS와 Windows manifest의 버전·소스 commit이 같습니다.
- ASAR 안의 package 버전, 빌드된 renderer/main/preload 파일을 실제 build 출력과 비교했습니다.
- `app-update.yml`의 provider가 `github / cantcalc / null-browser`인지 검사했습니다.

이 검사는 배포 파일의 일관성과 전달 중 무결성을 확인합니다. Apple 공증이나 Windows 서명 인증을 대신하지 않습니다.

## 4. macOS 배포·실행 결과

- Apple Silicon ARM64 DMG/ZIP 생성 및 CI packaged runtime smoke 통과.
- 공개 다운로드한 DMG의 `hdiutil verify` 통과.
- DMG를 읽기 전용으로 마운트하고 격리된 Applications 테스트 폴더로 복사했습니다.
- 공개 DMG의 앱에서 실제 로컬 페이지 로딩, 정상 종료, 재실행, 설정 복원을 확인했습니다.
- 공개 ZIP도 실제 압축 해제, 앱 버전, 로컬 서명 무결성을 검사했습니다.
- 앱 이름/아이콘을 NULL 및 기존 모노크롬 리본 아이콘으로 유지했습니다.
- 개인 설치 앱과 실제 계정 프로필을 이 검사로 교체하지 않았습니다.

**서명 상태:** ad-hoc 서명. `developerIdSigned=false`, `notarized=false`, `gatekeeperAccepted=false`.

Apple Developer ID/공증 인증 정보가 없어 정식 배포 서명이나 공증은 완료하지 못했습니다. Gatekeeper가 다운로드한 앱 실행을 차단할 수 있습니다. 보안 검증을 끄거나 완료된 것처럼 보고하지 않았습니다.

## 5. Windows 배포·설치 결과

GitHub Actions의 **Windows Server 2025 x64** 환경에서 실행했습니다.

- NSIS EXE 생성 및 업데이트 YAML/파일 해시/ASAR 소스 일치 검사 통과.
- 임시 경로에 실제 무인 설치 통과.
- 설치한 `NULL.exe` 실행, NULL 이름·버전 확인, 실제 네이티브 페이지 로딩 통과.
- 종료/재실행 및 테스트 프로필 설정 복원 통과.
- 제거 프로그램 실행 및 메인 실행 파일 제거 확인.
- 검사 결과 `smoke-win32.json`의 `silentInstallAndUninstall=true`.

**서명 상태:** `authenticodeStatus=NotSigned`. Windows 서명 인증서는 없으며 SmartScreen 경고가 나타날 수 있습니다.

일반 소비자 Windows PC의 모든 GPU/권한/보안 정책, 대화형 설치 화면 및 기존 Aero와의 동시 설치 조합을 전부 검증한 것은 아닙니다.

## 6. 자동 업데이트

provider를 기존 Aero 릴리스 저장소에서 **cantcalc/null-browser**로 변경했습니다.

기존 UI와 시작 확인/수동 확인/사용자 다운로드/진행률/나중에 설치/재시작 설치 경로를 유지합니다. 개발 실행에서는 updater를 비활성화합니다.

### macOS 실제 공개 feed 검사

서로 구별되는 격리된 QA 버전 `1.0.0-beta.0`에서 공개된 `1.0.1-beta.3`을 검사했습니다.

- 새 버전 발견: 확인.
- 올바른 대상 버전: 확인.
- 다운로드 진행률: 확인.
- 공개 ZIP 전체 다운로드 및 `downloaded` 상태: 확인.
- 실제 자동 재시작 설치: **미검증**.

이는 기존 사용자의 Aero 1.0.0 설치본을 직접 업그레이드한 검사가 아닙니다. 배포 서명/공증 없는 macOS의 자동 설치를 보장하지 않습니다.

### Windows 실제 공개 feed 검사

격리된 `1.0.0-beta.0` QA 설치본에서 공개 `1.0.1-beta.3`의 발견·다운로드·진행률 및 `downloaded` 상태는 확인했습니다.

- 설치 후 새 EXE 확인/자동 재실행은 완료하지 못했습니다.
- 추가 CI는 `Timeout: new EXE installed`를 기록하고 최종적으로 단계 시간 제한에 도달했습니다.
- 이 결과를 Windows 업데이트 설치 성공으로 표시하지 않습니다. 신규 설치/실행/제거 성공과 구분합니다.
- 추가 조사에서 테스트가 Windows PE의 숫자 ProductVersion을 전체 prerelease 문자열과 비교하는 문제도 확인했습니다. 측정 코드를 보완했지만, 그 보완 뒤 전체 업그레이드 E2E를 다시 완료한 것은 아닙니다. 제품 설치 자체의 실패라고 단정하지 않습니다.
- 검증 기록: https://github.com/cantcalc/null-browser/actions/runs/41642015949
- 설치 완료 검증이 필요한 사용자는 현재 공개 Setup EXE를 이용한 수동 설치 경로를 사용해야 합니다.

### 기존 앱에서의 전환

이전 Aero 및 로컬 NULL 1.0.0에는 이전 provider가 들어 있습니다. 기존 저장소를 변경하지 않았으므로 **이번 설치본으로 한 번 수동 교체한 뒤부터** 새 저장소의 업데이트 경로를 사용합니다.

프로필 경로, 워크스페이스 partition, 앱 식별자·암호화 저장소는 데이터 호환을 위해 유지했습니다. 실제 개인 Google 계정/OAuth 전체 조합을 검증한 것은 아닙니다.

## 7. GitHub Actions 구성

### `release.yml`

- main/PR: 전체 Git 기록 secret 검사, npm ci, TypeScript 두 종류 검사, build, navigation, 배포 의존성 감사.
- 태그 또는 수동 실행: macOS ARM64 / Windows x64 패키징.
- macOS: native tabs/core/runtime 회귀 및 packaged 실행/재실행 smoke.
- Windows: NSIS 설치/실행/재실행/제거.
- 버전·파일 해시·업데이트 메타데이터·패키지 소스·라이선스 파일 검증.
- 모든 필수 job이 통과해야 초안에 파일을 올린 뒤 공개.
- beta는 Pre-release, 이미 공개한 동일 Release는 덮어쓰지 않음.
- 안정판은 Developer ID/공증 및 유효한 Windows 서명도 요구.
- 로컬 패키징은 `--publish never`.
- 인증 정보는 GitHub Secrets 및 job 범위의 GITHUB_TOKEN을 사용.

### `update-e2e.yml`

공개 feed를 대상으로 격리된 이전 QA 버전의 Windows 설치·업데이트·재실행을 검사하는 별도 수동 workflow입니다. 이전 QA 설치 파일은 공개하지 않습니다.

## 8. 소스·의존성·라이선스 점검

- 원래 Git 기록 18개 및 이후 공개할 commit 전체를 gitleaks로 검사했습니다. 탐지된 secret은 없었습니다.
- 토큰·비밀번호·쿠키·프로필·환경 파일·인증서·빌드 결과·개발 로그는 소스에 올리지 않았습니다.
- 개발 보고서·임시 결과는 현재 소스 트리에서 제외하고 기존 Git 이력은 보존했습니다.
- 최초 npm 감사 critical 2/high 6/moderate 16에서 호환 범위 패치 업데이트로 critical/high를 해소했습니다.
- 배포 의존성 감사 결과는 **0건**, 개발·빌드 도구 moderate 권고 **15건**은 남아 있습니다. 강제 major 다운그레이드는 하지 않았습니다.
- 소스는 사용자가 선택한 **MIT**이며 설치본에도 고지를 포함했습니다.
- 배포 JavaScript 의존성 32개의 고지, Electron 및 실제 플랫폼 Chromium 고지를 설치본에 동봉했습니다.
- npm에 라이선스 파일이 없는 두 패키지는 upstream/manifest/SPDX 출처를 기록해 보완했습니다. 포괄적인 법률 검토 완료를 주장하지 않습니다.
- 사용자 제공 로고/앱 아이콘은 MIT 코드와 구분하는 브랜딩 리소스로 표시했습니다.

## 9. 테스트 결과

- TypeScript / Electron typecheck / build / navigation: 통과.
- 실제 20탭 생성·정리: 통과.
- core/runtime: 기록, 권한, 분할, native view 정리, 실제 로컬 다운로드 등 통과.
- 쿠키 정책 동등성 2,160개 및 실제 송수신: 통과.
- 경량화 회귀 12개: 통과.
- 설정 전체 카테고리·저장/실패/재시도·취소·재시작: 통과.
- 검색 추천 없음/Enter/기록 보존 및 입력·제스처 20개: 통과.
- 워크스페이스 저장소·네트워크 격리, 공유 기록, 다운로드, 재시작: 통과.
- 확장 설치/worker/content/popup/제거·재실행 fixture 검사: 통과. 일부 worker 경고는 남아 있음.
- 디자인 150개 배치 검사 후 시크릿 별도 재검사 통과. OS 포커스 가정을 보완한 테스트 코드와 실제 제품 변경을 구분했습니다.
- 최종 배포 CI: validate, macOS packages, Windows packages, publish 전부 통과.

일부 테스트 종료의 임시 캐시 경고를 사용자 프로필 손상이나 완전 무오류로 해석하지 않았습니다. 모든 사이트/하드웨어/장시간 무충돌 검증은 아닙니다.

## 10. 최종 판단과 남은 제한

**테스트 사용자에게 실제 설치 파일을 공개 배포하는 목표는 달성했습니다. 서명 경고 없는 일반 안정판 배포 완료 상태는 아닙니다.**

- Apple 배포 서명·공증과 Windows 서명이 없음.
- macOS 자동 재시작 설치는 미검증. Windows 추가 업데이트 설치/자동 재실행 E2E도 미완료.
- Chrome 확장 전체 호환 및 세부 권한 회수 제약이 남음. 확장 자동 업데이트는 꺼져 있음.
- 장시간 안정성, 실제 Google/OAuth 전수 검증, 소비자 장비 전체 검증은 아님.
- Chrome보다 가볍거나 빠르다는 비교 인증은 없음.
- 개발·빌드 의존성 moderate 권고가 남음.

설치 전 실행 중인 기존 앱을 종료하고 중요한 데이터를 백업하세요. 기존 Aero 저장소는 그대로 유지했습니다.
