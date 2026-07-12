const BOUNDARY = /[。．！？!?\n]/;

export function createSentenceChunker() {
  let buffer = '';

  return {
    feed(delta: string): string[] {
      buffer += delta;
      const sentences: string[] = [];
      let index = buffer.search(BOUNDARY);
      while (index >= 0) {
        const sentence = buffer.slice(0, index + 1).trim();
        if (sentence.length > 0) {
          sentences.push(sentence);
        }
        buffer = buffer.slice(index + 1);
        index = buffer.search(BOUNDARY);
      }
      return sentences;
    },

    flush(): string | null {
      const rest = buffer.trim();
      buffer = '';
      return rest.length > 0 ? rest : null;
    },
  };
}
