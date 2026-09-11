# Aero Browser 탭 닫기 버튼 hover 수정 보고서

작성일: 2026-09-10

## 요청 사항

탭의 닫기 버튼 `X`가 보이지 않는 문제를 수정한다. 탭 위에 마우스를 올렸을 때만 `X`가 자연스럽게 나타나야 한다.

## 원인

`HorizontalTabBar`의 닫기 버튼에 Tailwind `opacity-0` 유틸리티가 직접 적용되어 있었다. 이 때문에 CSS의 탭 hover 노출 규칙과 스타일 우선순위가 충돌할 수 있었고, 사용자 화면에서 hover 시에도 `X`가 나타나지 않았다.

## 수정 내용

- `src/components/HorizontalTabBar.tsx`
  - 닫기 버튼에서 직접 지정된 `opacity-0`를 제거했다.
- `src/index.css`
  - `.aero-tab-close`의 기본 상태를 `opacity: 0`으로 지정했다.
  - `.aero-tab:hover .aero-tab-close`에서 `opacity: 1`이 되도록 유지했다.
  - 활성 탭에서는 닫기 버튼을 약하게 표시하고, hover/focus 시 선명하게 표시한다.

## 동작 결과

| 상태 | 닫기 버튼 |
| --- | --- |
| 기본 상태 | 숨김 |
| 탭 hover | 표시 |
| 활성 탭 | 약하게 표시 |
| 닫기 버튼 hover/focus | 선명하게 표시 |

## 검증

- 실제 브라우저 미리보기에서 마우스를 탭 위로 이동해 `X` 표시 확인
- hover 전 computed opacity: `0`
- hover 후 computed opacity: `1`
- 탭 생성·닫기 동작 회귀 확인
- `npx tsc --noEmit` 통과
- `npm run typecheck:electron` 통과
- `npm run build` 통과

## 작업 시간

- 예상 시간: 약 3~5분
- 실제 수정 및 hover 확인: 예상 범위 내 완료

이번 수정은 탭 닫기 버튼의 표시 스타일만 변경했으며, 탭 생명주기·브라우저 동작·단축키·WebContentsView 로직은 변경하지 않았다.
