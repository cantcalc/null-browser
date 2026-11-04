import React, { useState, useEffect } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { AI_PROVIDERS, AI_PROVIDER_NAMES, modelKey, type AIProvider, type AISettings as Settings } from '../../../shared/ai';
import { useAI } from './useAI';
import { ToggleSwitch } from '../ToggleSwitch';
import './ai.css';

const KEY_URLS = {gemini:'https://aistudio.google.com/api-keys',groq:'https://console.groq.com/keys',openrouter:'https://openrouter.ai/settings/keys'};
export default function AISettings({ workspaceId }: { workspaceId: string }) {
  const { state, command, error, loading } = useAI(workspaceId);
  const [provider,setProvider]=useState<AIProvider>('gemini');
  const [key,setKey]=useState('');
  const [freeAccount,setFreeAccount]=useState(false);
  const [busy,setBusy]=useState(false);
  const [priority,setPriority]=useState('');
  const connection=state.connections.find(c=>c.provider===provider);
  const models=state.models.filter(m=>m.free&&m.tools);
  useEffect(()=>{const saved=state.settings.selectedModel.split(':')[0] as AIProvider;if(AI_PROVIDERS.includes(saved))setProvider(saved);},[state.settings.selectedModel]);
  useEffect(()=>{setKey('');setFreeAccount(connection?.freeAccount===true);},[provider,connection?.freeAccount]);
  const update=(updates:Partial<Settings>)=>void command({op:'settings',updates});
  const row=(label:string,description:string,checked:boolean,set:(value:boolean)=>void)=><div className="null-ai-setting-row"><div><strong>{label}</strong><p>{description}</p></div><ToggleSwitch aria-label={label} checked={checked} onCheckedChange={set} disabled={loading||busy}/></div>;
  return <section className="null-ai-settings null-settings-section" data-settings-section="ai">
    <div className="null-ai-settings-intro"><h3>브라우저 에이전트</h3><p>내 API를 연결하고 웹에서 할 일을 맡기세요.</p></div>
    <form className="null-ai-connection" onSubmit={async event=>{
      event.preventDefault();if(busy)return;setBusy(true);
      const credential=key;setKey('');
      try{
        const result=await command(credential?{op:'connect',provider,key:credential,freeAccount}:{op:'refresh',provider});
        if(result.ok&&credential)await command({op:'settings',updates:{enabled:true}});
      }finally{setBusy(false);}
    }}>
      <div className="null-ai-connection-heading"><select aria-label="연결할 AI 제공자" value={provider} onChange={e=>setProvider(e.target.value as AIProvider)} disabled={busy}>{AI_PROVIDERS.map(p=><option key={p} value={p}>{AI_PROVIDER_NAMES[p]}</option>)}</select><span className="null-ai-connection-status">{connection?.status==='ready'?<><Check size={13}/>연결됨</>:connection?.connected?'저장된 연결':'연결 필요'}</span></div>
      <input aria-label={`${AI_PROVIDER_NAMES[provider]} API 키`} type="password" autoComplete="off" spellCheck={false} value={key} onChange={e=>setKey(e.target.value)} placeholder={connection?.connected?'새 키를 입력하면 변경됩니다':'API 키'} maxLength={512}/>
      {provider!=='openrouter'&&(!connection?.connected||Boolean(key))&&row(`${AI_PROVIDER_NAMES[provider]} 무료 요금제 확인`,'제공자 콘솔에서 무료 요금제인지 확인했습니다.',freeAccount,setFreeAccount)}
      <div className="null-ai-actions"><a href={KEY_URLS[provider]} target="_blank" rel="noreferrer">API 키 발급</a><span/><button type="submit" className="null-ai-connect" disabled={busy||(!key&&!connection?.connected)||(Boolean(key)&&provider!=='openrouter'&&!freeAccount)}>{busy?'확인 중…':key?'연결하기':'연결 확인'}</button>{connection?.connected&&<button type="button" disabled={busy} onClick={()=>void command({op:'disconnect',provider})}>연결 해제</button>}</div>
      {connection?.message&&<p className="null-ai-note">{connection.message}</p>}
    </form>
    <label className="null-ai-field">에이전트 모델<select aria-label="기본 AI 모델" value={state.settings.selectedModel} onChange={e=>update({selectedModel:e.target.value})}><option value="">연결 후 선택</option>{models.map(m=><option key={modelKey(m)} value={modelKey(m)}>{AI_PROVIDER_NAMES[m.provider]} · {m.name}</option>)}</select></label>
    {row('에이전트 사용','요청할 때만 실행합니다.',state.settings.enabled,enabled=>update({enabled}))}
    {row('페이지 데이터 전송 동의','선택한 페이지·텍스트·확인한 캡처를 연결한 AI 제공자에게 전송합니다.',state.settings.dataConsent,dataConsent=>update({dataConsent}))}
    <details className="null-ai-advanced"><summary>추가 설정<ChevronDown size={13}/></summary>
      <label className="null-ai-field">사이드바 위치<select aria-label="AI 사이드바 위치" value={state.settings.position} onChange={e=>update({position:e.target.value as 'left'|'right'})}><option value="right">오른쪽</option><option value="left">왼쪽</option></select></label>
      {row('새 탭에서 작업','작업 탭을 화면에 열어 진행합니다. 끄면 현재 탭에서 작업합니다.',state.settings.dedicatedTab,dedicatedTab=>update({dedicatedTab}))}
      {row('현재 페이지 참조','작업을 시작할 때 현재 페이지도 함께 참고합니다.',state.settings.referencePage,referencePage=>update({referencePage}))}
      {row('다른 제공자로 전환 허용','한도 초과 시 우선순위의 다른 제공자에게 대화·페이지 정보도 전송될 수 있습니다.',state.settings.fallbackConsent,fallbackConsent=>update({fallbackConsent}))}
      {state.settings.fallbackConsent&&row('무료 한도 초과 시 자동 전환','요청·토큰 한도가 명확한 경우에만 전환합니다.',state.settings.autoFallback,autoFallback=>update({autoFallback}))}
      {state.settings.fallbackConsent&&<><div className="null-ai-actions"><select aria-label="전환 우선순위에 추가할 모델" value={priority} onChange={e=>setPriority(e.target.value)}><option value="">대체 모델 선택</option>{models.filter(m=>!state.settings.priority.includes(modelKey(m))).map(m=><option key={modelKey(m)} value={modelKey(m)}>{AI_PROVIDER_NAMES[m.provider]} · {m.name}</option>)}</select><button type="button" disabled={!priority} onClick={()=>{update({priority:[...state.settings.priority,priority]});setPriority('');}}>추가</button></div><ol className="null-ai-priority">{state.settings.priority.map((id,i)=><li key={id}><span>{i+1}. {state.models.find(m=>modelKey(m)===id)?.name||id}</span><button type="button" aria-label={`${id} 순위 올리기`} disabled={!i} onClick={()=>{const p=[...state.settings.priority];[p[i-1],p[i]]=[p[i],p[i-1]];update({priority:p});}}>↑</button><button type="button" aria-label={`${id} 순위 내리기`} disabled={i===state.settings.priority.length-1} onClick={()=>{const p=[...state.settings.priority];[p[i],p[i+1]]=[p[i+1],p[i]];update({priority:p});}}>↓</button><button type="button" onClick={()=>update({priority:state.settings.priority.filter(v=>v!==id)})}>제거</button></li>)}</ol></>}
      <button type="button" className="null-quiet-button" onClick={()=>void command({op:'clear'})}>현재 작업·대화 지우기</button>
    </details>
    <p className="null-ai-settings-footer">API 키는 기기에 암호화해 저장하고 대화는 앱 종료 시 삭제합니다. 제공자의 데이터 보관 정책은 별개입니다. 무료 모델만 표시하지만 계정 비용을 보장하지 않습니다. 중요한 클릭·입력은 승인받고, 로그인·비밀번호·결제 정보·파일 업로드는 직접 처리합니다. 설정은 즉시 저장됩니다.</p>
    {error&&<p className="null-ai-error" role="alert">{error}</p>}
  </section>;
}
