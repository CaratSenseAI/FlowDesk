import { describe, expect, it } from 'vitest';
import { readListen } from '../../src/services/voiceListenService';
import { instructionFrom } from '../../src/services/voiceRepairService';
import { renderListeningContext } from '../../src/services/businessContext';
import { parseWithRules } from '../../src/services/commandService';

describe('reading what the listening model returned', () => {
  it('takes heard, person, instruction and confidence', () => {
    const out = readListen('{"heard":"Anshul Raibole task is to check the godown","person":"Anshul Raibole","instruction":"Task for Anshul Raibole: check the godown","confidence":0.95,"unsure":null}')!;
    expect(out.heard).toBe('Anshul Raibole task is to check the godown');
    expect(out.understood).toEqual({ text: 'Task for Anshul Raibole: check the godown', person: 'Anshul Raibole', confidence: 0.95, unsure: null });
  });

  it('falls back to what was heard when there is no instruction, and reads "null" strings as null', () => {
    const out = readListen('{"heard":"ho gaya sir","person":"null","instruction":"","confidence":0.8}')!;
    expect(out.understood.text).toBe('ho gaya sir');
    expect(out.understood.person).toBeNull();
  });

  it('is null when nothing was heard or the answer is not JSON', () => {
    expect(readListen('{"heard":"","instruction":""}')).toBeNull();
    expect(readListen('sorry, I could not hear that')).toBeNull();
  });
});

describe('the instruction a listened note becomes', () => {
  it('parses without any model: person, work and deadline', () => {
    const out = readListen('{"heard":"Anshul ko kal tak godown check karna hai","person":"Anshul Raibole","instruction":"Task for Anshul Raibole: godown check karna kal tak","confidence":0.9}')!;
    const cmd = parseWithRules(instructionFrom(out.understood))!;
    expect(cmd.intent).toBe('create_task');
    expect(cmd.targetName).toBe('Anshul Raibole');
    expect(cmd.title).toBe('godown check karna');
    expect(cmd.deadlineText).toBe('kal tak');
  });

  it('never carries a threat into the task', () => {
    const out = readListen('{"heard":"x","person":"Anshul Raibole","instruction":"Task for Anshul Raibole: kaam khatam kar de kal tak, nahi toh dekh lena","confidence":0.9}')!;
    expect(instructionFrom(out.understood)).toBe('Task for Anshul Raibole: kaam khatam kar de kal tak');
  });
});

describe('what the listening model is told', () => {
  const text = renderListeningContext(['Ashish', 'Bipan', 'Lalit Dubey', 'Lalit Godown', 'Dhamija']);
  it('has the staff, the spoken names and the trade words', () => {
    expect(text).toContain('STAFF: Ashish, Bipan, Lalit Dubey, Lalit Godown, Dhamija.');
    expect(text).toContain('"lalit" means Lalit Godown');
    expect(text).toContain('godown');
  });
});
