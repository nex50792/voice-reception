interface Window {
  __synthesisCancelled: number;
  __speakCount: number;
  __finishSpeech: () => void;
  __emitSpeech: (text: string, isFinal?: boolean) => void;
  __latestRecognition: { started: boolean; onresult: ((e: unknown) => void) | null } | null;
}
