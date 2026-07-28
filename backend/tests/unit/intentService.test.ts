import { beforeAll, describe, expect, it } from 'vitest';
import {
  analyzeMessage, extractTaskRef, hasExplicitTaskRef, parseLooseJson,
} from '../../src/services/intentService';

// Force the keyword fallback path — these tests must not make network calls.
beforeAll(() => {
  delete process.env.NVIDIA_API_KEY;
});

describe('extractTaskRef', () => {
  it.each([
    ['TSK-1058 done',            'TSK-1058'],
    ['Tsk 1058',                 'TSK-1058'],
    ['tsk1058 ho gaya',          'TSK-1058'],
    ['tsk_1058',                 'TSK-1058'],
    ['Task-1058',                'TSK-1058'],
    ['Task -1058',               'TSK-1058'],   // reported in the field
    ['task no 1058',             'TSK-1058'],
    ['task number 1058',         'TSK-1058'],
    ['task #1058',               'TSK-1058'],
    ['T S K 1058',               'TSK-1058'],   // speech-to-text spells it out
    ['टास्क 1058 पूरा हो गया',      'TSK-1058'],
    ['कार्य क्रमांक 1058',           'TSK-1058'],
    ['1058 done',                'TSK-1058'],   // bare number, last resort
    ['Task 1058 completed and I clicked the picture also.', 'TSK-1058'],
  ])('parses %j', (text, expected) => {
    expect(extractTaskRef(text)).toBe(expected);
  });

  it.each([
    'done',
    'need 2 more days',
    '3 boxes left',
    'on my way',
    '',
    '   ',
  ])('finds no task number in %j', (text) => {
    expect(extractTaskRef(text)).toBeNull();
  });

  it('reads the task number, not the quantity', () => {
    expect(extractTaskRef('I need 2 days for task 1057')).toBe('TSK-1057');
  });

  it('normalises away leading zeros and separators', () => {
    expect(extractTaskRef('TSK-0042')).toBe('TSK-42');
  });
});

describe('hasExplicitTaskRef', () => {
  it.each(['TSK-1058', 'Tsk 1058', 'task 1058', 'Task -1058', 'टास्क 1058'])(
    'is true for the prefixed form %j', (t) => expect(hasExplicitTaskRef(t)).toBe(true),
  );

  it.each(['1058 done', '5000 units done', 'done'])(
    'is false for %j — a bare number must never reject a message', (t) =>
      expect(hasExplicitTaskRef(t)).toBe(false),
  );
});

describe('parseLooseJson', () => {
  const want = { action: 'done', taskNumber: '1060' };

  it('parses bare JSON', () => {
    expect(parseLooseJson('{"action":"done","taskNumber":"1060"}')).toMatchObject(want);
  });

  it('parses a fenced block', () => {
    expect(parseLooseJson('```json\n{"action":"done","taskNumber":"1060"}\n```')).toMatchObject(want);
  });

  it('parses JSON followed by commentary', () => {
    expect(parseLooseJson('{"action":"done","taskNumber":"1060"}\n\nHope that helps!')).toMatchObject(want);
  });

  it('parses JSON preceded by reasoning', () => {
    expect(parseLooseJson('Let me think. The worker said done.\n{"action":"done","taskNumber":"1060"}'))
      .toMatchObject(want);
  });

  it('returns null on unparseable output', () => {
    expect(parseLooseJson('I think the task is done')).toBeNull();
    expect(parseLooseJson('{not valid json')).toBeNull();
    expect(parseLooseJson('')).toBeNull();
  });
});

describe('analyzeMessage — keyword fallback (no API key)', () => {
  it.each([
    ['task 1058 done',           'done',  'TSK-1058'],
    ['1058 ho gaya',             'done',  'TSK-1058'],
    ['झालंय',                     'done',  null],
    ['dikkat aa gayi',           'issue', null],
    ['टास्क 1057 में दिक्कत है',      'issue', 'TSK-1057'],
    ['kal tak kar dunga',        'delay', null],
    ['1054 in progress',         'progress', 'TSK-1054'],
    ['working on task 1054',     'progress', 'TSK-1054'],
    ['task 1054 shuru kar diya', 'progress', 'TSK-1054'],
    // "will complete soon" is a start, not a completion — the done bank must
    // not win on the word "complete".
    ['1054 in progress, will complete soon', 'progress', 'TSK-1054'],
  ])('reads %j as %s', async (text, action, taskRef) => {
    const r = await analyzeMessage(text);
    expect(r.action).toBe(action);
    expect(r.taskRef).toBe(taskRef);
    expect(r.confidence).toBe('keyword');
  });

  it('flags a mention of photographic proof', async () => {
    expect((await analyzeMessage('task 1058 done, photo bhej diya')).mentionsProof).toBe(true);
    expect((await analyzeMessage('task 1058 done')).mentionsProof).toBe(false);
  });

  it('reports no action for genuine chatter', async () => {
    const r = await analyzeMessage('ok thanks');
    expect(r.action).toBeNull();
    expect(r.confidence).toBe('none');
  });

  it('handles empty input without calling anything', async () => {
    const r = await analyzeMessage('');
    expect(r).toEqual({
      action: null, taskRef: null, mentionsProof: false, summary: '', confidence: 'none',
    });
  });
});
