import type { BrowserSettings } from '../types/browser';

export const INTERFACE_STYLES: { id: BrowserSettings['interfaceStyle']; label: string; description: string }[] = [
  { id: 'core', label: 'Core', description: '작고 담백한 기본형' },
  { id: 'air', label: 'Air', description: '부드러운 곡선과 편안한 여백' },
  { id: 'studio', label: 'Studio', description: '툴바로 이어지는 연결형 탭' },
  { id: 'focus', label: 'Focus', description: '가벼운 선과 넓은 작업 공간' },
  { id: 'outline', label: 'Outline', description: '얇은 윤곽과 단정한 독립형 탭' },
];

export const THEME_OPTIONS: {
  id: BrowserSettings['theme']; label: string; desc: string; swatch: string; border: string;
}[] = [
  { id: 'noir', label: '다크', desc: '차분한 차콜과 부드러운 명암', swatch: '#151515', border: '#3a3a3a' },
  { id: 'paper', label: '화이트', desc: '깨끗한 화이트와 선명한 대비', swatch: '#ffffff', border: '#d6d6d6' },
];

export const HOME_STYLES: { id: BrowserSettings['homeStyle']; label: string; description: string }[] = [
  { id: 'center', label: 'Center', description: '중앙에 균형 있게 놓인 로고와 검색창' },
  { id: 'compact', label: 'Compact', description: '작은 로고와 짧고 단정한 검색창' },
  { id: 'elevated', label: 'Elevated', description: '시선이 머무는 위쪽과 부드러운 검색창' },
  { id: 'horizontal', label: 'Horizontal', description: '로고 옆으로 이어지는 가로형 검색창' },
  { id: 'grounded', label: 'Grounded', description: '아래쪽에 놓인 큰 로고와 넓은 검색창' },
];
