const { LruCache } = require('../lib/lruCache');
const { KeyedMutex } = require('../lib/keyedMutex');
const { splitMessage, stripMarkdown } = require('../bot/telegram');
const { truncate, sanitizeForModel } = require('../services/chatHistory');
const { cosineSimilarity } = require('../services/ragService');
const { estimateCost } = require('../services/analytics');

const userTurn = (text) => ({ role: 'user', parts: [{ text }] });
const modelTurn = (text) => ({ role: 'model', parts: [{ text }] });
const toolCall = (name) => ({ role: 'model', parts: [{ functionCall: { name } }] });
const toolResult = (name) => ({ role: 'user', parts: [{ functionResponse: { name } }] });

describe('LruCache', () => {
  it('evicts the least recently used entry past its bound', () => {
    const cache = new LruCache({ max: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('treats a read as a use', () => {
    const cache = new LruCache({ max: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // 'b' is now the least recently used
    cache.set('c', 3);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
  });

  it('expires entries past their TTL', async () => {
    const cache = new LruCache({ max: 10, ttlMs: 20 });
    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');
    await new Promise((r) => setTimeout(r, 40));
    expect(cache.get('k')).toBeUndefined();
  });
});

describe('KeyedMutex', () => {
  it('serialises work sharing a key', async () => {
    const mutex = new KeyedMutex();
    const order = [];

    const task = (id, delay) =>
      mutex.run('session', async () => {
        order.push(`start-${id}`);
        await new Promise((r) => setTimeout(r, delay));
        order.push(`end-${id}`);
      });

    await Promise.all([task('a', 30), task('b', 1)]);
    expect(order).toEqual(['start-a', 'end-a', 'start-b', 'end-b']);
  });

  it('runs different keys concurrently', async () => {
    const mutex = new KeyedMutex();
    const order = [];

    await Promise.all([
      mutex.run('one', async () => {
        await new Promise((r) => setTimeout(r, 30));
        order.push('one');
      }),
      mutex.run('two', async () => {
        order.push('two');
      }),
    ]);

    expect(order).toEqual(['two', 'one']);
  });

  it('does not deadlock after a rejection, and releases the key', async () => {
    const mutex = new KeyedMutex();
    await expect(mutex.run('k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(mutex.run('k', async () => 'recovered')).resolves.toBe('recovered');

    await new Promise((r) => setTimeout(r, 10));
    expect(mutex.pending).toBe(0);
  });
});

describe('Telegram message handling', () => {
  it('leaves a short message alone', () => {
    expect(splitMessage('hello')).toEqual(['hello']);
  });

  it('splits past the 4096-character limit', () => {
    const long = 'word '.repeat(2000); // 10000 chars
    const chunks = splitMessage(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(4096);
  });

  it('prefers paragraph boundaries', () => {
    const text = `${'a'.repeat(60)}\n\n${'b'.repeat(60)}`;
    const chunks = splitMessage(text, 100);
    expect(chunks[0]).toBe('a'.repeat(60));
    expect(chunks[1]).toBe('b'.repeat(60));
  });

  it('strips markdown for the plain-text fallback', () => {
    expect(stripMarkdown('**bold** _italic_ `code`')).toBe('bold italic code');
  });
});

describe('Chat history hygiene', () => {
  it('keeps history within the turn budget', () => {
    const history = Array.from({ length: 100 }, (_, i) =>
      i % 2 === 0 ? userTurn(`u${i}`) : modelTurn(`m${i}`)
    );
    expect(truncate(history).length).toBeLessThanOrEqual(40);
  });

  it('never starts a truncated history on a model turn', () => {
    const history = Array.from({ length: 100 }, (_, i) =>
      i % 2 === 0 ? modelTurn(`m${i}`) : userTurn(`u${i}`)
    );
    const result = truncate(history);
    if (result.length > 0) expect(result[0].role).toBe('user');
  });

  it('drops a leading orphaned tool result', () => {
    const cleaned = sanitizeForModel([toolResult('searchProducts'), userTurn('hi')], 'test');
    expect(cleaned[0]).toEqual(userTurn('hi'));
  });

  it('drops a trailing unanswered tool call', () => {
    const cleaned = sanitizeForModel([userTurn('hi'), toolCall('searchProducts')], 'test');
    expect(cleaned).toEqual([userTurn('hi')]);
  });

  it('leaves a well-formed history untouched', () => {
    const history = [userTurn('hi'), modelTurn('hello')];
    expect(sanitizeForModel(history, 'test')).toEqual(history);
  });

  it('tolerates empty and malformed input', () => {
    expect(sanitizeForModel([], 'test')).toEqual([]);
    expect(sanitizeForModel(null, 'test')).toEqual([]);
    expect(truncate([])).toEqual([]);
  });
});

describe('RAG similarity', () => {
  it('scores identical vectors as 1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('scores orthogonal vectors as 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns 0 for mismatched or empty vectors rather than throwing', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
    expect(cosineSimilarity(null, [1])).toBe(0);
  });
});

describe('Cost estimation', () => {
  it('prices per model rather than with one flat rate', () => {
    const flash15 = estimateCost('gemini-1.5-flash', 1e6, 1e6);
    const flash20 = estimateCost('gemini-2.0-flash', 1e6, 1e6);
    expect(flash15).toBeGreaterThan(0);
    expect(flash15).not.toBeCloseTo(flash20);
  });

  it('falls back to the default rate for an unknown model', () => {
    expect(estimateCost('some-future-model', 1e6, 0)).toBeGreaterThan(0);
  });

  it('is zero for zero tokens', () => {
    expect(estimateCost('gemini-1.5-flash', 0, 0)).toBe(0);
  });
});
