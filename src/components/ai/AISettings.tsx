import React, { useState, useEffect } from 'react';
import { AI_PROVIDERS, AI_PROVIDER_NAMES, modelKey, type AIProvider, type AISettings as AISettingsData } from '../../../shared/ai';
import { useAI } from './useAI';
import { ToggleSwitch } from '../ToggleSwitch';
import './ai.css';

export default function AISettings({ workspaceId }: { workspaceId: string }) {
  const { state, command, error, loading } = useAI(workspaceId);
  const [keys, setKeys] = useState<Partial<Record<AIProvider, string>>>({});
  const [freeAccounts, setFreeAccounts] = useState<Partial<Record<AIProvider, boolean>>>({});
  const [busy, setBusy] = useState<AIProvider | null>(null);
  const [priority, setPriority] = useState('');
  const [widthDraft, setWidthDraft] = useState(state.settings.width);
  useEffect(() => setWidthDraft(state.settings.width), [state.settings.width]);
  const update = (updates: Partial<AISettingsData>) => void command({ op: 'settings', updates });
  const free = state.models.filter(m => m.free);
  const row = (label: string, description: string, checked: boolean, set: (value: boolean) => void) => <div className="null-ai-setting-row"><div><strong>{label}</strong><p>{description}</p></div><ToggleSwitch aria-label={label} checked={checked} onCheckedChange={set} disabled={loading} /></div>;
  return <section className="null-ai-settings null-settings-section" data-settings-section="ai">
    <p className="null-ai-note">현재 워크스페이스의 AI 연결입니다. 키는 OS 암호화 저장소로 보호하며 제공자의 공식 API로 직접 전송합니다. 아래 AI 설정은 즉시 저장됩니다.</p>
    {row('AI 사용', '사용하지 않으면 페이지 분석이나 AI 요청을 실행하지 않습니다.', state.settings.enabled, enabled => update({ enabled }))}
    {row('페이지 데이터 전송 동의', '선택한 페이지의 내용·선택 텍스트·확인한 캡처를 외부 제공자에게 보낼 수 있습니다. 제공자의 보관·학습 정책은 NULL과 다릅니다.', state.settings.dataConsent, dataConsent => update({ dataConsent }))}
    <h3>API 연결</h3>
    <p className="null-ai-note">무료 모델만 선택할 수 있습니다. Gemini·Groq의 계정 결제 상태는 API로 확인할 수 없어 무료 요금제 여부를 직접 확인해야 합니다. 과금이 발생하지 않는다는 보장은 하지 않습니다.</p>
    {AI_PROVIDERS.map(provider => {
      const connection = state.connections.find(c => c.provider === provider);
      return <form key={provider} className="null-ai-connection" onSubmit={async event => {
        event.preventDefault(); if (busy) return;
        const key = keys[provider] || ''; setKeys(value => ({ ...value, [provider]: '' })); setBusy(provider);
        try { await command({ op: 'connect', provider, key, freeAccount: freeAccounts[provider] === true }); } finally { setBusy(null); }
      }}>
        <div className="null-ai-connection-heading"><strong>{AI_PROVIDER_NAMES[provider]}</strong><span>{connection?.message || (connection?.connected ? '저장됨 · 연결 테스트 필요' : '연결되지 않음')}</span></div>
        <label className="null-ai-key-label"><span className="sr-only">{AI_PROVIDER_NAMES[provider]} API 키</span><input aria-label={`${AI_PROVIDER_NAMES[provider]} API 키`} type="password" autoComplete="off" spellCheck={false} value={keys[provider] || ''} onChange={event => setKeys(value => ({ ...value, [provider]: event.target.value }))} placeholder={connection?.connected ? '변경할 API 키' : 'API 키'} maxLength={512} /></label>
        {provider !== 'openrouter' && row(`${AI_PROVIDER_NAMES[provider]} 무료 요금제 확인`, '제공자 콘솔에서 현재 프로젝트·계정의 무료 요금제를 확인했습니다.', freeAccounts[provider] === true, checked => setFreeAccounts(value => ({ ...value, [provider]: checked })))}
        <div className="null-ai-actions"><a href={({gemini: "https://aistudio.google.com/api-keys", groq: "https://console.groq.com/keys", openrouter: "https://openrouter.ai/settings/keys"})[provider]} target="_blank" rel="noreferrer">키 발급 · 계정 확인</a>
          <button className="null-quiet-button" disabled={Boolean(busy) || !keys[provider] || (provider !== 'openrouter' && !freeAccounts[provider])}>{busy === provider ? '확인 중…' : connection?.connected ? '키 변경 및 테스트' : '연결 및 테스트'}</button>
          {connection?.connected && <><button type="button" className="null-quiet-button" disabled={Boolean(busy)} onClick={async () => { setBusy(provider); try { await command({ op: 'refresh', provider }); } finally { setBusy(null); } }}>연결 테스트 · 모델 갱신</button><button type="button" className="null-quiet-button" disabled={Boolean(busy)} onClick={() => void command({ op: 'disconnect', provider })}>연결 삭제</button></>}
        </div>
      </form>;
    })}
    <h3>모델과 자동 전환</h3>
    <label className="null-ai-field">기본 모델<select aria-label="기본 AI 모델" value={state.settings.selectedModel} onChange={event => update({ selectedModel: event.target.value })}><option value="">무료 모델을 갱신해 주세요</option>{free.map(model => <option key={modelKey(model)} value={modelKey(model)}>{AI_PROVIDER_NAMES[model.provider]} / {model.name}</option>)}</select></label>
    {row('제공자 변경 시 데이터 전송 동의', '전환 시 현재 대화와 선택한 페이지 데이터가 우선순위의 다른 제공자에게도 전송됩니다.', state.settings.fallbackConsent, fallbackConsent => update({ fallbackConsent }))}
    {row('무료 한도 초과 시 자동 전환', '명시적인 요청·토큰 한도 초과에만 전환합니다. 인증·네트워크·서버 오류에는 전환하지 않습니다.', state.settings.autoFallback, autoFallback => update({ autoFallback }))}
    <div className="null-ai-actions"><select aria-label="전환 우선순위에 추가할 모델" value={priority} onChange={e => setPriority(e.target.value)}><option value="">모델 선택</option>{free.filter(m => !state.settings.priority.includes(modelKey(m))).map(m => <option key={modelKey(m)} value={modelKey(m)}>{AI_PROVIDER_NAMES[m.provider]} / {m.name}</option>)}</select><button type="button" className="null-quiet-button" disabled={!priority} onClick={() => { update({ priority: [...state.settings.priority, priority] }); setPriority(''); }}>순서 추가</button></div>
    <ol className="null-ai-priority">{state.settings.priority.map((key, index) => <li key={key}><span>{index + 1}. {key}</span><button type="button" aria-label={`${key} 순위 올리기`} disabled={index === 0} onClick={() => { const next = [...state.settings.priority]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; update({ priority: next }); }}>↑</button><button type="button" aria-label={`${key} 순위 내리기`} disabled={index === state.settings.priority.length - 1} onClick={() => { const next = [...state.settings.priority]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; update({ priority: next }); }}>↓</button><button type="button" onClick={() => update({ priority: state.settings.priority.filter(v => v !== key) })}>제거</button></li>)}</ol>
    <details><summary>모델별 지원 상태 ({state.models.length})</summary><div className="null-ai-model-list">{state.models.map(m => <div key={modelKey(m)}><strong>{AI_PROVIDER_NAMES[m.provider]} / {m.name}</strong><span>{m.free ? '무료' : '무료 확인 안 됨 · 사용 불가'} · 텍스트{m.image ? ' · 이미지' : ''}{m.tools ? ' · 도구' : ''}</span>{m.reason && <span>{m.reason}</span>}</div>)}</div></details>
    <h3>인터페이스와 에이전트</h3>
    <label className="null-ai-field">사이드바 위치<select value={state.settings.position} onChange={e => update({ position: e.target.value as 'left' | 'right' })}><option value="right">오른쪽</option><option value="left">왼쪽</option></select></label>
    <label className="null-ai-field">사이드바 너비 · {widthDraft}px<input type="range" min={280} max={640} value={widthDraft} onChange={e => setWidthDraft(Number(e.target.value))} onPointerUp={() => update({ width: widthDraft })} onKeyUp={() => update({ width: widthDraft })} onBlur={() => { if (widthDraft !== state.settings.width) update({ width: widthDraft }); }} /></label>
    {row('현재 페이지 자동 참조', '질문을 보낼 때만 현재 탭을 읽습니다. 다른 탭은 직접 선택해야 합니다.', state.settings.referencePage, referencePage => update({ referencePage }))}
    {row('에이전트 전용 탭 사용', '켜면 현재 페이지를 유지하고 별도 탭에서 작업합니다. 끄면 현재 탭에서 작업합니다.', state.settings.dedicatedTab, dedicatedTab => update({ dedicatedTab }))}
    {row('동시 작업 허용', '최대 2개 작업. 같은 탭의 동시 조작은 허용하지 않습니다. API·메모리 사용이 늘 수 있습니다.', state.settings.concurrentAgents, concurrentAgents => update({ concurrentAgents }))}
    {row('작업 진행 상황 표시', '승인·로그인·오류·중지 버튼은 이 설정과 관계없이 표시합니다.', state.settings.showProgress, showProgress => update({ showProgress }))}
    <p className="null-ai-note">결제·메시지·게시·계정 변경을 포함해 중요하거나 불확실한 클릭·입력은 개별 승인을 받습니다. 비밀번호·결제 입력·파일 업로드는 직접 처리해야 합니다. 승인 없는 일괄 실행 권한은 제공하지 않습니다.</p>
    <h3>개인정보</h3><p className="null-ai-note">대화는 실행 중 메모리에서만 유지하고 종료 시 삭제합니다. 시크릿 창에서는 AI를 사용할 수 없습니다. 워크스페이스마다 API 연결과 대화가 분리됩니다.</p>
    <button type="button" className="null-quiet-button" onClick={() => void command({ op: 'clear' })}>현재 대화·작업 지우기</button>
    {error && <p className="null-ai-error" role="alert">{error}</p>}
  </section>;
}
