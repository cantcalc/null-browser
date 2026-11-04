import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { X, Settings2, Plus, ArrowUp, Square, Camera, PanelLeftClose } from 'lucide-react';
import { AI_PROVIDER_NAMES, modelKey, type AIImagePreview, type AIProvider, type AIMessage } from '../../../shared/ai';
import type { Tab } from '../../types/browser';
import { ToggleSwitch } from '../ToggleSwitch';
import { useAI } from './useAI';
import './ai.css';

function CodeBlock({ children }: React.PropsWithChildren) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  return <div className="null-ai-code"><button type="button" onClick={() => { void navigator.clipboard.writeText(ref.current?.textContent || '').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? '복사됨' : '코드 복사'}</button><pre ref={ref}>{children}</pre></div>;
}
const AIMessageView = React.memo(({ message }: { message: AIMessage }) => <article className="null-ai-message" data-role={message.role}><div className="null-ai-message-label">{message.role === 'user' ? '나' : 'NULL'}{message.model && <span>{message.model}</span>}</div><ReactMarkdown skipHtml components={{ pre: CodeBlock, a: ({ href, children }) => /^https?:\/\//i.test(href || '') ? <a href={href} target="_blank" rel="noreferrer noopener">{children}</a> : <span>{children}</span>, img: ({ alt }) => <span>{alt || '[외부 이미지 생략]'}</span> }}>{message.text}</ReactMarkdown>{message.references?.length ? <details><summary>참조한 페이지 {message.references.length}개</summary>{message.references.map((ref, i) => <a key={i} href={ref.url} target="_blank" rel="noreferrer">{ref.title || ref.url}</a>)}</details> : null}</article>);

export default function AISidebar({ workspaceId, tabs, activeTabId, open, onClose, onSettings, onShowTab, selection }: {
  workspaceId: string; tabs: Tab[]; activeTabId: string | null; open: boolean; onClose: () => void; onSettings: () => void;
  onShowTab: (id: string) => void; selection?: { token: string; prompt: string; revision: number } | null;
}) {
  const { state, command, error, setError } = useAI(workspaceId, open);
  const [text, setText] = useState(''); const [agent, setAgent] = useState(false);
  const [selected, setSelected] = useState<string[]>([]); const [image, setImage] = useState<AIImagePreview>();
  const [imageConfirmed, setImageConfirmed] = useState(false); const [selectionToken, setSelectionToken] = useState<string>();
  const [busy, setBusy] = useState(false); const [provider, setProvider] = useState<AIProvider>('gemini');
  const scroll = useRef<HTMLDivElement>(null), field = useRef<HTMLTextAreaElement>(null), resize = useRef<{ x: number; width: number; pointerId: number } | undefined>(undefined);
  const models = state.models.filter(m => m.free && m.provider === provider);
  const chosen = state.models.find(m => modelKey(m) === state.settings.selectedModel);
  const running = state.tasks.filter(t => !['done', 'cancelled', 'error'].includes(t.state));
  useEffect(() => { const saved = state.settings.selectedModel.split(':')[0] as AIProvider; if (Object.hasOwn(AI_PROVIDER_NAMES, saved)) setProvider(saved); }, [state.settings.selectedModel, chosen?.provider]);
  useLayoutEffect(() => { window.dispatchEvent(new Event('resize')); }, [state.settings.position, state.settings.width, open]);
  useEffect(() => { if (selection) { setText(selection.prompt); setSelectionToken(selection.token); setAgent(false); field.current?.focus(); } }, [selection?.revision]);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [state.messages, state.tasks]);
  useEffect(() => { setSelected(ids => ids.filter(id => tabs.some(tab => tab.id === id))); }, [tabs]);
  const switchProvider = (next: AIProvider) => {
    setProvider(next); const first = state.models.find(m => m.free && m.provider === next);
    if (first) void command({ op: 'settings', updates: { selectedModel: modelKey(first) } });
  };
  const send = async () => {
    if (busy || !text.trim() || (image && !imageConfirmed)) return;
    setBusy(true);
    try {
      const result = await command({ op: 'send', text, agent, tabIds: selected, imageToken: image?.token, selectionToken });
      if (result.ok) { setText(''); setImage(undefined); setImageConfirmed(false); setSelectionToken(undefined); }
    } finally { setBusy(false); }
  };
  return <aside className="null-ai-sidebar" data-ai-sidebar data-open={open} aria-label="NULL AI" style={{ display: open ? 'flex' : 'none', order: state.settings.position === 'left' ? -1 : 2, width: state.settings.width }}>
    <div className="null-ai-resize" role="separator" aria-label="AI 사이드바 크기 조절" aria-orientation="vertical" aria-valuenow={state.settings.width} aria-valuemin={280} aria-valuemax={640} tabIndex={0} data-position={state.settings.position}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); resize.current = { x: e.clientX, width: state.settings.width, pointerId: e.pointerId }; }}
      onPointerMove={e => { const r = resize.current; if (r) { const sign = state.settings.position === 'right' ? -1 : 1; e.currentTarget.parentElement!.style.width = `${Math.max(280, Math.min(640, r.width + (e.clientX - r.x) * sign))}px`; } }}
      onPointerUp={e => { if (resize.current) { const width = parseFloat(e.currentTarget.parentElement!.style.width); resize.current = undefined; void command({ op: 'settings', updates: { width } }); } }}
      onPointerCancel={() => { resize.current = undefined; }}
      onKeyDown={e => { if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); void command({ op: 'settings', updates: { width: state.settings.width + (e.key === 'ArrowRight' ? 20 : -20) } }); } }} />
    <header className="null-ai-header"><strong>NULL AI</strong><span>로컬 대화는 종료 시 삭제</span><button className="null-icon-button" title="새 대화" aria-label="AI 새 대화" onClick={() => { void command({ op: 'clear' }); setImage(undefined); setSelectionToken(undefined); }}><Plus size={16} /></button><button className="null-icon-button" title="AI 설정" aria-label="AI 설정" onClick={onSettings}><Settings2 size={15} /></button><button className="null-icon-button" aria-label="AI 사이드바 닫기" onClick={onClose}><X size={16} /></button></header>
    <div className="null-ai-model-select"><select aria-label="AI 제공자" value={provider} onChange={e => switchProvider(e.target.value as AIProvider)}>{(Object.keys(AI_PROVIDER_NAMES) as AIProvider[]).map(id => <option value={id} key={id}>{AI_PROVIDER_NAMES[id]}</option>)}</select><select aria-label="AI 모델" value={chosen?.provider === provider ? state.settings.selectedModel : ''} onChange={e => void command({ op: 'settings', updates: { selectedModel: e.target.value } })}><option value="">모델 선택</option>{models.map(m => <option key={modelKey(m)} value={modelKey(m)}>{m.name}</option>)}</select></div>
    <div className="null-ai-meta"><span>{state.connections.find(c => c.provider === provider)?.status === 'ready' ? '연결됨 · 무료 모델' : '연결 테스트 필요'}</span><button type="button" onClick={() => { if (state.connections.some(c => c.provider === provider && c.connected)) void command({ op: 'refresh', provider }); else onSettings(); }}>모델 갱신</button><span>{chosen?.image ? '이미지' : '텍스트'}{chosen?.tools ? ' · 에이전트' : ''}</span></div>
    <div className="null-ai-messages" ref={scroll} aria-live="polite" aria-relevant="additions text">
      {!state.settings.enabled && <div className="null-ai-empty"><PanelLeftClose size={26} /><strong>내 API로 사용하는 AI</strong><p>AI 설정에서 기능을 켜고 Gemini, Groq 또는 OpenRouter 키를 연결하세요.</p><button className="null-quiet-button" onClick={onSettings}>연결 설정</button></div>}
      {state.settings.enabled && !state.messages.length && <div className="null-ai-empty"><strong>무엇을 도와드릴까요?</strong><p>현재 페이지에 대해 묻거나 에이전트에게 탐색을 요청하세요.</p><button className="null-quiet-button" onClick={onSettings}>API 연결 · 모델 갱신</button></div>}
      {state.notice && <p className="null-ai-notice" role="status">{state.notice}</p>}
      {state.messages.map(message => <AIMessageView key={message.id} message={message} />)}
      {state.tasks.map(task => <section className="null-ai-task" key={task.id} data-ai-task={task.state}><header><strong>{task.kind === 'agent' ? '에이전트' : '응답'} · {({ running: '진행 중', approval: '승인 대기', login: '로그인 대기', paused: '일시정지', done: '완료', cancelled: '중지됨', error: '오류' })[task.state]}</strong>{!['done', 'cancelled', 'error'].includes(task.state) && <button type="button" onClick={() => void command({ op: 'stop', taskId: task.id })}>중지</button>}</header><p>{task.title}</p>{task.tabId && <button type="button" className="null-quiet-button" onClick={() => onShowTab(task.tabId!)}>작업 탭 보기</button>}{(state.settings.showProgress || ['paused', 'login'].includes(task.state)) && <ol>{task.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>}{task.approval && <div className="null-ai-approval"><strong>{task.approval.action}</strong><p>{task.approval.target}</p><p>{task.approval.detail}</p><div className="null-ai-actions"><button type="button" onClick={() => void command({ op: 'resolve', taskId: task.id, approvalId: task.approval!.id, allow: true })}>이 작업 승인</button><button type="button" onClick={() => void command({ op: 'resolve', taskId: task.id, approvalId: task.approval!.id, allow: false })}>거부</button></div></div>}{['login', 'paused'].includes(task.state) && <button type="button" onClick={() => void command({ op: 'resume', taskId: task.id })}>직접 확인했습니다 · 재개</button>}{task.error && <p role="alert">{task.error}</p>}</section>)}
    </div>
    <div className="null-ai-composer">
      {!state.settings.dataConsent && state.settings.enabled && <p className="null-ai-note">페이지 참조를 사용하려면 <button type="button" onClick={onSettings}>데이터 전송 동의</button>가 필요합니다.</p>}
      <div className="null-ai-reference"><span>{state.settings.referencePage ? selected.length ? `선택한 ${selected.length}개 탭 참조` : `현재 탭 참조${tabs.find(t => t.id === activeTabId)?.title ? ': ' + tabs.find(t => t.id === activeTabId)!.title.slice(0, 28) : ''}` : '페이지 참조 꺼짐'}</span><ToggleSwitch aria-label="AI 페이지 참조" checked={state.settings.referencePage} onCheckedChange={referencePage => void command({ op: 'settings', updates: { referencePage } })} /></div>
      {state.settings.referencePage && <details className="null-ai-tab-picker"><summary>분석할 다른 탭 선택 · 최대 3개</summary>{tabs.filter(t => /^https?:/.test(t.url)).map(tab => <label key={tab.id}><input type="checkbox" checked={selected.includes(tab.id)} disabled={!selected.includes(tab.id) && selected.length >= 3} onChange={e => setSelected(ids => e.target.checked ? [...ids, tab.id] : ids.filter(id => id !== tab.id))} />{tab.title}</label>)}<button type="button" onClick={() => setSelected([])}>현재 탭만</button></details>}
      {selectionToken && <div className="null-ai-notice">선택한 텍스트를 함께 전송합니다.<button type="button" onClick={() => setSelectionToken(undefined)}>제외</button></div>}
      {image && <div className="null-ai-image-preview"><img src={image.dataURL} alt="전송 전 확인할 현재 페이지 캡처" /><div className="null-ai-reference"><span>마스킹된 화면도 개인정보가 남을 수 있습니다. 이 이미지를 전송합니다.</span><ToggleSwitch aria-label="캡처 이미지 전송 확인" checked={imageConfirmed} onCheckedChange={setImageConfirmed} /></div><button type="button" onClick={() => { setImage(undefined); setImageConfirmed(false); }}>이미지 제외</button></div>}
      <textarea ref={field} aria-label="AI 메시지" value={text} onChange={e => setText(e.target.value)} maxLength={8000} rows={3} disabled={!state.settings.enabled} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
      {error && <p className="null-ai-error" role="alert">{error}</p>}
      <div className="null-ai-compose-actions"><label><input type="checkbox" checked={agent} disabled={!chosen?.tools} onChange={e => setAgent(e.target.checked)} />에이전트</label><button type="button" className="null-icon-button" aria-label="현재 페이지 캡처 첨부" disabled={!chosen?.image || !activeTabId || !state.settings.dataConsent} onClick={async () => { if (activeTabId) { const result = await command({ op: 'image', tabId: activeTabId }); if (result.image) { setImage(result.image); setImageConfirmed(false); } } }}><Camera size={16} /></button><span />{running.length > 0 && <button type="button" className="null-icon-button" aria-label="진행 중인 AI 작업 모두 중지" onClick={() => { for (const task of running) void command({ op: 'stop', taskId: task.id }); }}><Square size={14} /></button>}<button type="button" className="null-ai-send" aria-label="AI 메시지 전송" disabled={busy || !text.trim() || !chosen || chosen.provider !== provider || !state.settings.enabled || Boolean(image && !imageConfirmed)} onClick={() => void send()}><ArrowUp size={18} /></button></div>
    </div>
  </aside>;
}
