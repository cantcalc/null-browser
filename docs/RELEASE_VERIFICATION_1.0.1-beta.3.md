# NULL Browser macOS 공개 배포 보고서

2026-11-03 · 한국 시간 · 현재 범위: **macOS Apple Silicon만**

## 1. 저장소와 실제 배포

- 공개 소스: https://github.com/cantcalc/null-browser
- 공개 다운로드: https://github.com/cantcalc/null-browser/releases/tag/v1.0.1-beta.3
- Public / main / MIT 라이선스.
- 배포 버전과 태그: **1.0.1-beta.3 / v1.0.1-beta.3**.
- 설치 파일 생성 commit: `4b6f2f229b85a112db8605acf1c9035793b092f2`.
- 이후 main 변경은 추가 QA 및 현재 Mac 전용 배포 정리입니다. 공개 Mac 바이너리는 임의 교체하지 않았습니다.
- 기존 로컬 Git 커밋 18개를 보존했으며, 기존 Aero 저장소에 push·삭제·Release 변경을 하지 않았습니다.

## 2. 현재 다운로드 파일

| 파일 | 실제 크기 |
| --- | ---: |
| NULL-1.0.1-beta.3-arm64.dmg | 130,800,676 B |
| NULL-1.0.1-beta.3-arm64.zip | 125,232,736 B |

함께 제공하는 파일은 DMG/ZIP blockmap 2개, latest-mac.yml, artifact-manifest-darwin.json,
signing-status-mac.json, smoke-darwin.json, SHA256SUMS.txt입니다. 현재 Release는 **Mac 관련 asset 9개**로 정리합니다.

## 3. Windows 보류

사용자의 최종 지시에 따라 Windows 작업을 중단했습니다. 앞선 요청에서 공개됐던 Windows EXE·blockmap·Windows 업데이트/검증 파일 6개는 새 NULL Release에서 내렸습니다.

- Windows 관련 코드와 기존 검사 기록은 보존합니다.
- Windows 업데이트 E2E workflow는 비활성화했습니다.
- 앞으로 release workflow의 자동 패키징/배포 대상은 macOS ARM64만입니다.
- 현재 Windows 설치 파일을 제공하거나 추가 검증하지 않습니다.

## 4. 실제 다운로드·무결성 검사

- 저장소와 Release 페이지를 인증 없이 요청해 HTTP 200을 확인했습니다.
- 최초 공개 파일 15개를 인증 없이 다시 다운로드해 크기와 GitHub SHA-256 digest 일치를 확인했습니다.
- Mac 전용 전환 후 Windows 항목을 제거하고 Mac 파일만으로 SHA256SUMS를 다시 생성했습니다.
- macOS YAML의 버전·파일명·크기·SHA-512와 실제 DMG/ZIP이 일치합니다.
- ASAR의 앱 버전 및 renderer/main/preload 파일이 빌드 출력과 일치함을 CI에서 검사했습니다.
- app-update.yml의 공급자는 **github / cantcalc / null-browser**입니다.

## 5. macOS 설치·실행 결과

GitHub Actions macOS ARM64 빌드와 packaged 실행 검사는 통과했습니다.

실제 GitHub에서 받은 DMG로 다음을 별도 수행했습니다.

1. hdiutil verify: 통과.
2. 읽기 전용 마운트: 통과.
3. 격리된 Applications 테스트 폴더로 NULL.app 복사: 통과.
4. 앱 이름/버전 및 실제 native 페이지 로딩: 통과.
5. 정상 종료·재실행·테스트 설정 복원: 통과.

공개 ZIP도 압축 해제, 앱 버전, 로컬 서명 무결성을 확인했습니다. 기존 모노크롬 리본 앱 아이콘을 유지했습니다.

**일반 사용자의 /Applications 앱이나 실제 계정 프로필을 위 QA로 교체하지 않았습니다.**

## 6. 서명과 공증

- 로컬 ad-hoc 서명 및 strict 무결성 검사: 통과.
- Apple Developer ID 서명: **없음**.
- Apple 공증: **미완료**.
- 검사 결과: developerIdSigned=false / notarized=false / gatekeeperAccepted=false.

필요한 Apple 배포 인증 정보가 없어 정식 서명/공증을 수행하지 못했습니다. Gatekeeper가 다운로드 앱 실행을 차단할 수 있습니다. 보안 설정을 우회하거나 공증 완료로 보고하지 않았습니다.

따라서 **테스트 배포이며 안정판/서명 경고 없는 배포 완료 상태는 아닙니다.**

## 7. Mac 자동 업데이트

provider를 기존 Aero 릴리스 저장소에서 **cantcalc/null-browser**로 변경했습니다.

격리된 이전 QA 버전 `1.0.0-beta.0`에서 실제 공개 `1.0.1-beta.3`을 대상으로 확인한 결과:

| 항목 | 결과 |
| --- | --- |
| 새 공개 버전 발견 | 확인 |
| 대상 버전 일치 | 확인 |
| 다운로드 진행률 | 확인 |
| 공개 ZIP 전체 다운로드 / downloaded 상태 | 확인 |
| 실제 자동 재시작 설치 | 미검증 |

개인 사용자의 Aero 1.0.0 설치본을 직접 업그레이드한 검사가 아닙니다. 배포 서명/공증 없는 macOS 자동 설치를 보장하지 않습니다.

이전 Aero/로컬 NULL 1.0.0은 이전 provider를 포함합니다. **이번 Mac 설치본으로 한 번 수동 교체한 뒤부터** 새 저장소를 사용합니다. 기존 프로필 경로·워크스페이스 partition·앱 및 암호화 식별자는 데이터 호환을 위해 유지했습니다.

## 8. 소스·패키지·라이선스 정리

- 원래 Git 기록 18개와 이후 공개 commit을 gitleaks로 검사: 탐지된 secret 없음.
- 프로필·쿠키·토큰·환경 파일·인증서·로그·임시 결과·설치 파일을 소스에서 제외.
- 작업 보고서는 현재 소스 트리에서 제외하고 기존 Git 이력은 보존.
- 최초 npm audit critical 2/high 6/moderate 16에서 호환 범위 패치 적용.
- 배포 의존성 감사: **0건**.
- 개발/빌드 도구의 moderate 권고 **15건**은 남음. 강제 major 다운그레이드는 하지 않음.
- 프로젝트 소스: 사용자가 선택한 MIT. 고지를 설치본에 포함.
- 배포 JavaScript 의존성 32개의 고지 및 실제 Electron/Chromium 고지를 설치본에 포함.
- 누락된 두 npm 패키지 고지는 upstream/manifest/SPDX 출처를 기록해 보완. 포괄적인 법률 검토 완료를 뜻하지 않음.
- 로고/아이콘은 MIT 코드와 구분하는 사용자 제공 브랜딩 리소스.

## 9. GitHub Actions와 테스트

현재 release workflow는 main/PR 검사 및 macOS ARM64 패키징·검증·Release 업로드를 구성합니다. 태그 또는 수동 실행으로 배포하고 로컬 명령은 --publish never입니다.

- 전체 Git 기록 secret 검사, TypeScript, Electron typecheck, build, navigation: 통과.
- 실제 20탭 생성/정리, core/runtime: 통과.
- 쿠키 정책 동등성 2,160개 및 실제 송수신: 통과.
- 경량화 회귀 12개: 통과.
- 설정 저장·실패/재시도·취소·재실행: 통과.
- 검색 입력, 제스처/입력 20개: 통과.
- 워크스페이스 저장소·네트워크 격리 및 재시작: 통과.
- fixture 확장 설치/worker/popup/제거/재실행: 통과. 일부 worker 경고는 남음.
- 디자인 150개 배치 및 시크릿 재검사: 통과. OS 포커스 가정의 테스트 코드 문제와 제품 변경을 구분.
- 실제 공개 Mac DMG/ZIP 검증과 packaged smoke: 통과.

배포 실행 기록: https://github.com/cantcalc/null-browser/actions/runs/41630154422

해당 배포 실행 당시에는 이전 요청의 Windows job도 포함됐으나, 현재 자동 배포 범위에서는 제외했습니다. 인증 정보는 GitHub Secrets와 job 범위의 GITHUB_TOKEN으로 관리하며 소스/로그에 넣지 않습니다.

## 10. 최종 판단

**Mac 테스트 사용자용 공개 다운로드·설치 파일 제공은 완료했습니다. 일반 안정판 배포 준비 완료 판정은 아닙니다.**

남은 항목은 Apple 배포 서명/공증, 자동 재시작 설치 검증, 장시간 안정성 및 전체 확장/하드웨어 검증입니다. Chrome 확장 전체 호환과 세부 권한 회수는 제한되며 확장 자동 업데이트는 꺼져 있습니다. Chrome보다 가볍거나 빠르다는 비교 인증도 없습니다.

설치 전 기존 앱을 종료하고 중요한 데이터를 백업하세요. Windows는 재요청 전까지 보류합니다.
