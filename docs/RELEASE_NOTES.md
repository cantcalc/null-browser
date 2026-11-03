# NULL Browser 1.0.1-beta.3 — macOS ARM64 Pre-release

현재 배포 범위는 **macOS Apple Silicon만**입니다. 소스는 MIT 라이선스입니다. Windows 배포는 보류했고 이전 Windows 파일은 이 Release에서 내렸습니다.

## 다운로드와 설치

- `NULL-1.0.1-beta.3-arm64.dmg`: 열어서 NULL.app을 Applications로 복사합니다.
- `NULL-1.0.1-beta.3-arm64.zip`: 압축을 풀어 NULL.app을 복사합니다.
- 기존 앱은 종료하고 중요한 데이터를 백업하세요. 기존 프로필·워크스페이스·암호화 저장소 식별자를 유지합니다.
- `SHA256SUMS.txt`, `artifact-manifest-darwin.json`으로 무결성과 빌드 commit을 확인할 수 있습니다.

## 주요 기능

Chromium 기반 탐색/탭/분할 보기, 북마크·기록·다운로드, 워크스페이스별 로그인 저장소 분리,
다크/화이트, 탭 인터페이스 5종과 검색 홈 5종, 시크릿 모드, 일부 Chrome 확장 지원을 제공합니다.

## 실제 확인

Mac CI 빌드·패키지 소스/메타데이터 검사 통과. 공개 DMG/ZIP 재다운로드 및 해시 검증,
DMG 마운트·복사·실행·종료/재실행·설정 복원과 ZIP 압축 해제 검사를 통과했습니다.

## 서명·공증과 자동 업데이트

**안정판이 아닙니다. Apple Developer ID 서명과 공증이 없습니다.** ad-hoc 서명이며 Gatekeeper가 실행을 차단할 수 있습니다.

업데이트 provider는 **cantcalc/null-browser**입니다. 이전 QA 버전에서 새 버전 발견·다운로드·진행률까지 확인했지만,
**자동 재시작 설치는 미검증이며 보장하지 않습니다.** 이전 Aero/로컬 NULL 1.0.0은 이 설치본으로 한 번 수동 교체해야 새 provider를 사용합니다.

## 알려진 제한

모든 Chrome 확장/API, 세부 권한 회수, Google/OAuth 전체, 장시간 무충돌 및 모든 장비를 검증하지 않았습니다.
확장 자동 업데이트는 꺼져 있고, 개발/빌드 도구의 moderate 보안 권고가 남아 있습니다.

[전체 검증 보고서](https://github.com/cantcalc/null-browser/blob/main/docs/RELEASE_VERIFICATION_1.0.1-beta.3.md)
