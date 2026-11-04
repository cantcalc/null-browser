import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_AI_SETTINGS, type AICommand, type AIResult, type AIState } from '../../../shared/ai';

export const EMPTY_AI_STATE: AIState = { settings: DEFAULT_AI_SETTINGS, connections: [], models: [], messages: [], tasks: [], private: false };
export function useAI(workspaceId: string, active = true, refreshSaved = false) {
  const [state, setState] = useState<AIState>(EMPTY_AI_STATE);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const command = useCallback(async (request: AICommand): Promise<AIResult> => {
    setError('');
    try {
      const result = await window.electronAPI?.aiCommand(request, workspaceId);
      if (!result) throw Error('NULL 앱에서 사용할 수 있습니다.');
      if (result.state) setState(result.state);
      if (!result.ok) setError(result.error || '요청을 처리하지 못했습니다.');
      return result;
    } catch { const message = 'AI 서비스에 연결하지 못했습니다.'; setError(message); return { ok: false, error: message }; }
  }, [workspaceId]);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    setLoading(true);
    void window.electronAPI?.aiCommand({ op: 'state' }, workspaceId).then(async result => {
      if (!alive) return;
      if (result.state) setState(result.state);
      if (!result.ok) setError(result.error || 'AI 설정을 읽지 못했습니다.');
      if (refreshSaved && result.state?.settings.enabled) {
        const provider = result.state.settings.selectedModel.split(':')[0];
        const saved = result.state.connections.find(c => c.connected && c.status === 'saved' && c.provider === provider) || result.state.connections.find(c => c.connected && c.status === 'saved');
        if (saved) {
          const refreshed = await window.electronAPI?.aiCommand({ op:'refresh', provider:saved.provider },workspaceId);
          if (alive && refreshed?.state) setState(refreshed.state);
          if (alive && refreshed && !refreshed.ok) setError(refreshed.error || '연결을 다시 확인해 주세요.');
        }
      }
    }).catch(() => { if (alive) setError('AI 설정을 읽지 못했습니다.'); }).finally(() => { if (alive) setLoading(false); });
    const unsubscribe = window.electronAPI?.onAIState(payload => { if (alive && payload.workspaceId === workspaceId) setState(payload.state); });
    const delta = window.electronAPI?.onAIDelta(payload => {
      if (alive && payload.workspaceId === workspaceId) setState(current => ({ ...current, messages: current.messages.map(message => message.id === payload.messageId ? { ...message, text: message.text + payload.text } : message) }));
    });
    return () => { alive = false; unsubscribe?.(); delta?.(); };
  }, [workspaceId, active, refreshSaved]);
  return { state, command, error, setError, loading };
}
