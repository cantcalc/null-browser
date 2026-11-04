import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { X, Settings2, Plus, ArrowUp, Square, Camera, ArrowUpRight, Check, LoaderCircle, ChevronDown, Globe } from 'lucide-react';
import { AI_PROVIDER_NAMES, modelKey, type AIImagePreview, type AIMessage } from '../../../shared/ai';
import type { Tab } from '../../types/browser';
import { ToggleSwitch } from '../ToggleSwitch';
import { useAI } from './useAI';
import './ai.css';

function CodeBlock({ children }: React.PropsWithChildren) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  return <div className="null-ai-code"><button type="button" onClick={() => { void navigator.clipboard.writeText(ref.current?.textContent || '').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? '복사됨' : '코드 복사'}</button><pre ref={ref}>{children}</pre></div>;
}
const Message = React.memo(({ message }: { message: AIMessage }) => <article className="null-ai-message" data-role={message.role}>
  {message.role === 'assistant' && <div className="null-ai-message-label">NULL</div>}
  <ReactMarkdown skipHtml components={{ pre: CodeBlock, a: ({ href, children }) => /^https?:\/\//i.test(href || '') ? <a href={href} target="_blank" rel="noreferrer noopener">{children}</a> : <span>{children}</span>, img: ({ alt }) => <span>{alt || '[이미지]'}</span> }}>{message.text}</ReactMarkdown>
</article>);

export default function AISidebar({ workspaceId, tabs, activeTabId, open, onClose, onSettings, onShowTab, selection }: {
  workspaceId: string; tabs: Tab[]; activeTabId: string | null; open: boolean; onClose: () => void; onSettings: () => void;
  onShowTab: (id: string) => void; selection?: { token: string; prompt: string; revision: number } | null;
}) {
  const { state, command, error, loading } = useAI(workspaceId, open, true);
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [contextOpen, setContextOpen] = useState(false);
  const [image, setImage] = useState<AIImagePreview>();
  const [imageConfirmed, setImageConfirmed] = useState(false);
  const [selectionToken, setSelectionToken] = useState<string>();
  const [busy, setBusy] = useState(false);
  const scroll = useRef<HTMLDivElement>(null), field = useRef<HTMLTextAreaElement>(null);
  const resize = useRef<{ x: number; width: number } | undefined>(undefined);
  const lastRevealed = useRef('');
  const models = state.models.filter(m => m.free && m.tools);
  const chosen = models.find(m => modelKey(m) === state.settings.selectedModel);
  const running = state.tasks.filter(t => !['done', 'cancelled', 'error'].includes(t.state));
  const latest = state.tasks.at(-1);
  const currentTab = tabs.find(t => t.id === activeTabId);
  const ready = state.settings.enabled && state.settings.dataConsent && Boolean(chosen);
  useLayoutEffect(() => { window.dispatchEvent(new Event('resize')); }, [state.settings.position, state.settings.width, open]);
  useLayoutEffect(() => { if(field.current) { field.current.style.height='auto'; field.current.style.height=`${Math.min(140,field.current.scrollHeight)}px`; } }, [text]);
  useEffect(() => { if (selection) { setText(selection.prompt); setSelectionToken(selection.token); field.current?.focus(); } }, [selection?.revision]);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [state.messages, state.tasks]);
  useEffect(() => { setSelected(ids => ids.filter(id => tabs.some(tab => tab.id === id))); }, [tabs]);
  useEffect(() => { if(latest?.state==='done'&&lastRevealed.current!==latest.id){lastRevealed.current=latest.id;if(latest.result&&latest.tabId===activeTabId&&latest.result.tabId!==activeTabId)onShowTab(latest.result.tabId);} },[latest?.id,latest?.state,activeTabId,onShowTab]);
  const send = async () => {
    if (busy || running.length || !text.trim() || !ready || (image && !imageConfirmed)) return;
    setBusy(true);
    try {
      const result = await command({ op: 'send', text, agent: true, tabIds: selected, imageToken: image?.token, selectionToken });
      if (result.ok) { setText(''); setImage(undefined); setImageConfirmed(false); setSelectionToken(undefined); setContextOpen(false); }
    } finally { setBusy(false); }
  };
  const setupNeeded = !loading && !ready;
  return <aside className="null-ai-sidebar" data-ai-sidebar data-open={open} aria-label="NULL 에이전트" style={{ display: open ? 'flex' : 'none', order: state.settings.position === 'left' ? -1 : 2, width: state.settings.width }}>
    <div className="null-ai-resize" role="separator" aria-label="AI 사이드바 크기 조절" aria-orientation="vertical" aria-valuenow={state.settings.width} aria-valuemin={280} aria-valuemax={640} tabIndex={0} data-position={state.settings.position}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); resize.current = { x: e.clientX, width: state.settings.width }; }}
      onPointerMove={e => { const r = resize.current; if (r) e.currentTarget.parentElement!.style.width = `${Math.max(280, Math.min(640, r.width + (e.clientX-r.x)*(state.settings.position==='right'?-1:1)))}px`; }}
      onPointerUp={e => { if (resize.current) { resize.current=undefined; void command({op:'settings',updates:{width:parseFloat(e.currentTarget.parentElement!.style.width)}}); } }}
      onPointerCancel={() => { resize.current=undefined; }}
      onKeyDown={e => { if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();void command({op:'settings',updates:{width:state.settings.width+(e.key==='ArrowRight'?20:-20)}});} }} />
    <header className="null-ai-header"><strong>NULL <span>에이전트</span></strong><div className="null-ai-header-actions">
      <button className="null-icon-button" title="새 작업" aria-label="AI 새 대화" onClick={() => { void command({op:'clear'});setImage(undefined);setSelectionToken(undefined); }}><Plus size={17}/></button>
      <button className="null-icon-button" title="연결 설정" aria-label="AI 설정" onClick={onSettings}><Settings2 size={15}/></button>
      <button className="null-icon-button" aria-label="AI 사이드바 닫기" onClick={onClose}><X size={17}/></button>
    </div></header>
    <div className="null-ai-messages" ref={scroll} aria-live="polite" aria-relevant="additions text">
      {!state.messages.length && <div className="null-ai-empty"><div className="null-ai-empty-mark"><Globe size={23} strokeWidth={1.4}/></div><strong>어떤 작업을 할까요?</strong><p>사이트를 열고, 찾고, 직접 처리합니다.</p>{setupNeeded && <button className="null-ai-connect" onClick={onSettings}>{state.connections.some(c=>c.connected)?'에이전트 설정':'API 연결'}</button>}{loading && <span>연결 확인 중…</span>}</div>}
      {state.messages.map(message => <Message key={message.id} message={message}/>)}
      {latest && <section className="null-ai-task" data-ai-task={latest.state}>
        <div className="null-ai-task-status">{latest.state==='done'?<Check size={14}/>:['error','cancelled'].includes(latest.state)?<Square size={11}/>:<LoaderCircle size={14} className="null-ai-working"/>}<span>{latest.state==='running'?(latest.steps.at(-1)||'작업 중'):({done:'페이지 확인 완료',approval:'확인이 필요합니다',login:'직접 로그인해 주세요',paused:'확인 후 이어서 진행합니다',cancelled:'중지됨',error:'완료하지 못했습니다'})[latest.state]}</span></div>
        {latest.result && <button type="button" className="null-ai-result" aria-label="확인한 작업 페이지 열기" onClick={()=>onShowTab(latest.result!.tabId)}><Globe size={14}/><span><strong>{latest.result.title||new URL(latest.result.url).hostname}</strong><small>{new URL(latest.result.url).hostname}</small></span><ArrowUpRight size={15}/></button>}
        {latest.approval && <div className="null-ai-approval"><strong>{latest.approval.action}</strong><p>{latest.approval.target}</p><p>{latest.approval.detail}</p><div className="null-ai-actions"><button type="button" onClick={()=>void command({op:'resolve',taskId:latest.id,approvalId:latest.approval!.id,allow:true})}>승인</button><button type="button" onClick={()=>void command({op:'resolve',taskId:latest.id,approvalId:latest.approval!.id,allow:false})}>거부</button></div></div>}
        {['login','paused'].includes(latest.state) && <div className="null-ai-actions"><button type="button" onClick={()=>latest.tabId&&onShowTab(latest.tabId)}>작업 페이지 보기</button><button type="button" onClick={()=>void command({op:'resume',taskId:latest.id})}>이어서 진행</button></div>}
        {latest.error && <p className="null-ai-error" role="alert">{latest.error}</p>}
        {latest.steps.length>1 && <details className="null-ai-task-details"><summary>작업 내역</summary><ol>{latest.steps.map((step,i)=><li key={i}>{step}</li>)}</ol></details>}
      </section>}
      {state.notice && <p className="null-ai-note" role="status">{state.notice}</p>}
    </div>
    <div className="null-ai-composer">
      {contextOpen && <div className="null-ai-context" aria-label="작업 참조 설정"><div className="null-ai-reference"><span>현재 페이지 참조</span><ToggleSwitch aria-label="AI 페이지 참조" checked={state.settings.referencePage} onCheckedChange={referencePage=>void command({op:'settings',updates:{referencePage}})}/></div><details className="null-ai-tab-picker"><summary>다른 탭 추가</summary>{tabs.filter(t=>/^https?:/.test(t.url)).map(tab=><label key={tab.id}><input type="checkbox" checked={selected.includes(tab.id)} disabled={!selected.includes(tab.id)&&selected.length>=3} onChange={e=>setSelected(ids=>e.target.checked?[...ids,tab.id]:ids.filter(id=>id!==tab.id))}/>{tab.title}</label>)}</details>{chosen?.image&&<button type="button" className="null-ai-context-action" aria-label="현재 페이지 캡처 첨부" disabled={!activeTabId||!state.settings.dataConsent} onClick={async()=>{if(activeTabId){const result=await command({op:'image',tabId:activeTabId});if(result.image){setImage(result.image);setImageConfirmed(false);}}}}><Camera size={15}/>화면 첨부</button>}</div>}
      {selectionToken && <div className="null-ai-attachment">선택한 텍스트<button aria-label="선택 텍스트 제외" onClick={()=>setSelectionToken(undefined)}><X size={12}/></button></div>}
      {image && <div className="null-ai-image-preview"><img src={image.dataURL} alt="전송 전 확인할 현재 페이지 캡처"/><div className="null-ai-reference"><span>캡처 확인 후 전송</span><ToggleSwitch aria-label="캡처 이미지 전송 확인" checked={imageConfirmed} onCheckedChange={setImageConfirmed}/><button aria-label="캡처 제외" onClick={()=>{setImage(undefined);setImageConfirmed(false);}}><X size={13}/></button></div></div>}
      {state.settings.referencePage && /^https?:/.test(currentTab?.url||'') && <button className="null-ai-context-chip" title="작업에 참조할 페이지" onClick={()=>setContextOpen(v=>!v)}><Globe size={12}/><span>{selected.length?`${selected.length}개 탭`:currentTab?.title}</span></button>}
      <div className="null-ai-input-shell"><textarea ref={field} aria-label="AI 메시지" placeholder="작업을 알려주세요" value={text} onChange={e=>setText(e.target.value)} maxLength={8000} rows={2} disabled={!ready} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/>
        <div className="null-ai-compose-actions"><button type="button" className="null-icon-button" title="참조 추가" aria-label="작업 참조 추가" aria-expanded={contextOpen} onClick={()=>setContextOpen(v=>!v)}><Plus size={17}/></button>
          {models.length?<label className="null-ai-model-picker"><select aria-label="AI 모델" title="에이전트 모델" value={chosen?state.settings.selectedModel:''} onChange={e=>void command({op:'settings',updates:{selectedModel:e.target.value}})}><option value="">모델 선택</option>{models.map(m=><option key={modelKey(m)} value={modelKey(m)}>{AI_PROVIDER_NAMES[m.provider]} · {m.name}</option>)}</select><ChevronDown size={11}/></label>:<button className="null-ai-model-connect" onClick={onSettings}>{loading?'연결 확인 중':'API 연결'}</button>}
          <span/>{running.length?<button type="button" className="null-ai-send" aria-label="진행 중인 AI 작업 모두 중지" onClick={()=>{for(const task of running)void command({op:'stop',taskId:task.id});}}><Square size={12} fill="currentColor"/></button>:<button type="button" className="null-ai-send" aria-label="AI 메시지 전송" disabled={busy||!text.trim()||!ready||Boolean(image&&!imageConfirmed)} onClick={()=>void send()}><ArrowUp size={18}/></button>}
        </div>
      </div>
      {error&&<p className="null-ai-error" role="alert">{error}</p>}
      {setupNeeded&&state.messages.length>0&&<button className="null-ai-setup-link" onClick={onSettings}>API·페이지 전송 설정 확인</button>}
    </div>
  </aside>;
}
