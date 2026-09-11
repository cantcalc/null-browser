import type { BrowserSettings } from '../types/browser';

export type ThemeOption = {
  id: BrowserSettings['theme'];
  label: string;
  desc: string;
  swatch: string;
  border: string;
  defaultAccent?: string;
};

export const THEME_OPTIONS: ThemeOption[] = [
  { id: 'noir', label: 'Noir', desc: '검정 배경 · 흰색 액센트', swatch: '#050505', border: '#3b3b3b', defaultAccent: '#ffffff' },
  { id: 'paper', label: 'Paper', desc: '흰색 배경 · 검정 액센트', swatch: '#ffffff', border: '#cbd5e1', defaultAccent: '#111827' },
  { id: 'graphite', label: 'Graphite', desc: '차분한 슬레이트', swatch: '#13151a', border: '#282c37' },
  { id: 'midnight', label: 'Midnight', desc: '깊은 네이비', swatch: '#070d18', border: '#1a2c4e' },
  { id: 'forest', label: 'Forest', desc: '보태니컬 그린', swatch: '#061510', border: '#173f30' },
  { id: 'aurora', label: 'Aurora', desc: '벨벳 바이올렛', swatch: '#11091c', border: '#321e52' },
  { id: 'sunset', label: 'Sunset', desc: '따뜻한 앰버', swatch: '#181310', border: '#3d3128' },
  { id: 'oled', label: 'OLED Black', desc: '완전한 블랙', swatch: '#000000', border: '#1c1c1c' },
  { id: 'light', label: 'Snow Light', desc: '깨끗한 라이트', swatch: '#f1f3f7', border: '#cbd5e1' },
  { id: 'cobalt', label: 'Cobalt', desc: '차가운 블루 스틸', swatch: '#08111f', border: '#244a78', defaultAccent: '#22d3ee' },
  { id: 'clay', label: 'Clay', desc: '깊은 테라코타', swatch: '#1b1110', border: '#63352e', defaultAccent: '#fb7185' },
  { id: 'mist', label: 'Mist', desc: '부드러운 아이스 블루', swatch: '#eaf2f8', border: '#bfd5e8', defaultAccent: '#2563eb' },
];

export const ACCENT_OPTIONS = [
  { color: '#3b82f6', label: 'Blue' },
  { color: '#10b981', label: 'Emerald' },
  { color: '#8b5cf6', label: 'Purple' },
  { color: '#f59e0b', label: 'Amber' },
  { color: '#f43f5e', label: 'Rose' },
  { color: '#22d3ee', label: 'Cyan' },
  { color: '#fb7185', label: 'Coral' },
  { color: '#ffffff', label: 'White' },
  { color: '#111827', label: 'Ink' },
];

export function getThemeOption(theme: BrowserSettings['theme']): ThemeOption | undefined {
  return THEME_OPTIONS.find((option) => option.id === theme);
}

export function getAccentForeground(color: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return '#ffffff';
  const value = Number.parseInt(match[1], 16);
  const red = (value >> 16) & 0xff;
  const green = (value >> 8) & 0xff;
  const blue = value & 0xff;
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? '#111827' : '#ffffff';
}
