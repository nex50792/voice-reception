export type TurnState = 'idle' | 'listening' | 'thinking' | 'speaking';

export type TurnEvent =
  | { type: 'START' }
  | { type: 'SPEECH_FINAL' }
  | { type: 'TTS_START' }
  | { type: 'TTS_DONE' }
  | { type: 'LLM_DONE' }
  | { type: 'BARGE_IN' }
  | { type: 'ERROR' }
  | { type: 'STOP' };

export function transition(state: TurnState, event: TurnEvent): TurnState {
  if (event.type === 'STOP') return 'idle';

  switch (state) {
    case 'idle':
      return event.type === 'START' ? 'listening' : 'idle';
    case 'listening':
      return event.type === 'SPEECH_FINAL' ? 'thinking' : 'listening';
    case 'thinking':
      if (event.type === 'TTS_START') return 'speaking';
      if (event.type === 'LLM_DONE' || event.type === 'ERROR') return 'listening';
      return 'thinking';
    case 'speaking':
      if (event.type === 'TTS_DONE' || event.type === 'BARGE_IN' || event.type === 'ERROR') {
        return 'listening';
      }
      return 'speaking';
  }
}
