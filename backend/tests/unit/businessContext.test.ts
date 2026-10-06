import { describe, expect, it } from 'vitest';
import { applyAlias, renderContext, speechKeyterms, businessProfile, nameAliases } from '../../src/services/businessContext';
import { normaliseParsed, fallbackTitle, parseWithRules, ParsedCommand } from '../../src/services/commandService';
import { readRepair } from '../../src/services/voiceRepairService';

const roster = ['Ashish', 'Bipan', 'Lalit Dubey', 'Lalit Godown', 'Dhamija', 'Shaina', 'Anshul Raibole'];

describe('spoken names', () => {
  it.each([
    ['Lalit',      'Lalit Godown'],   // the client: a bare Lalit is the godown Lalit
    ['lalit',      'Lalit Godown'],
    ['Dubey',      'Lalit Dubey'],
    ['Dubey ji',   'Lalit Dubey'],
    ['VK Dhamija', 'Dhamija'],
    ['Bipin',      'Bipan'],
    ['Shaina',     'Shaina'],          // no alias: unchanged
    ['Ramesh',     'Ramesh'],          // not on the roster: unchanged
  ])('%j means %s', (said, means) => {
    expect(applyAlias(said, roster)).toBe(means);
  });

  it('never points an alias at somebody outside the roster given', () => {
    expect(applyAlias('Lalit', ['Ashish', 'Lalit Dubey'])).toBe('Lalit');
  });
});

describe('the speech model\'s word list', () => {
  const terms = speechKeyterms(roster);
  it('has every name, first name and spoken form', () => {
    expect(terms).toEqual(expect.arrayContaining(['Anshul Raibole', 'Anshul', 'Lalit Dubey', 'Dubey', 'Bipan', 'FlowDesk', 'godown']));
  });
  it('contains no verbs — "deploy" in the list was heard where "check" was said', () => {
    for (const verb of ['deploy', 'check', 'send', 'bhejna']) expect(terms.map((t) => t.toLowerCase())).not.toContain(verb);
  });
});

describe('the context block', () => {
  const text = renderContext({
    profile: businessProfile(), sender: { name: 'Ashish', role: 'Admin' },
    roster: roster.map((name) => ({ name, role: 'Employee' })), aliases: nameAliases(),
    openTasks: [{ id: 'TSK-2', title: 'store visit', holder: 'Shaina', status: 'Pending' }], contacts: [],
  });
  it('lists the staff, the spoken names, the open work and that no outside contact is saved', () => {
    expect(text).toContain('Shaina [Employee]');
    expect(text).toContain('"lalit" means Lalit Godown');
    expect(text).toContain('TSK-2 | store visit | Shaina | Pending');
    expect(text).toContain('SAVED OUTSIDE CONTACTS (vendors, customers): none saved');
  });
  it('states the rule that staff names are internal work', () => {
    expect(text).toMatch(/A name on the STAFF list is an employee/);
    expect(text).toMatch(/ONLY when the message also names somebody from SAVED OUTSIDE CONTACTS/);
  });
});

const base = (over: Partial<ParsedCommand>): ParsedCommand => ({ ...parseWithRules('assign TSK-1 to X')!, taskRef: null, targetName: null, targetNames: [], ...over });

describe('tidying a parsed command', () => {
  it('lifts the date out of the title — "kal jaana hai" already says when', () => {
    const out = normaliseParsed(base({ intent: 'create_task', targetName: 'Shaina', targetNames: ['Shaina'], title: 'kal jaana hai', deadlineText: null }), 'Shaina ko bolo kal jaana hai');
    expect(out.title).toBe('jaana hai');
    expect(out.deadlineText).toBe('kal');
  });

  it('turns an outreach task with no outside party into a plain task', () => {
    const out = normaliseParsed(base({ intent: 'assign_sample_dispatch', targetName: 'Bipan', targetNames: ['Bipan'], title: null, contactName: null, itemDescription: null }), 'Bipan ko bola 14015 bhejden');
    expect(out.intent).toBe('create_task');
    expect(out.title).toBe('14015 bhejden');
  });

  it('leaves an outreach task alone when a party IS named', () => {
    const out = normaliseParsed(base({ intent: 'assign_sample_dispatch', targetName: 'Sahil', targetNames: ['Sahil'], contactName: 'Urja Vart' }), 'Ask Sahil to send samples to Urja Vart');
    expect(out.intent).toBe('assign_sample_dispatch');
  });

  it('does not touch a title that has no date in it', () => {
    const out = normaliseParsed(base({ intent: 'create_task', title: 'godown check karna', deadlineText: 'kal tak' }), 'x');
    expect(out.title).toBe('godown check karna');
    expect(out.deadlineText).toBe('kal tak');
  });
});

describe('a title from what is left of the sentence', () => {
  it.each([
    ['Bipan ko bola 14015 bhejden',     'Bipan',  '14015 bhejden'],
    ['Shaina ko bolo kal jaana hai',    'Shaina', 'jaana hai'],
    ['tell Rishi to count the rolls',   'Rishi',  'count the rolls'],
  ])('%j → %j', (text, name, title) => {
    expect(fallbackTitle(text, name)).toBe(title);
  });
});

describe('reading the voice-repair answer', () => {
  it('takes the cleaned text, person and confidence', () => {
    expect(readRepair('{"text":"Anshul Raibole ko kal tak godown check karna hai","person":"Anshul Raibole","confidence":0.9,"unsure":null}', 'raw'))
      .toEqual({ text: 'Anshul Raibole ko kal tak godown check karna hai', person: 'Anshul Raibole', confidence: 0.9, unsure: null });
  });
  it('keeps the original when the model returns no usable text, and treats "null" strings as null', () => {
    expect(readRepair('{"text":"","person":"null","confidence":0.1,"unsure":"garbled"}', 'raw transcript'))
      .toEqual({ text: 'raw transcript', person: null, confidence: 0.1, unsure: 'garbled' });
  });
  it('returns null for something that is not JSON', () => {
    expect(readRepair('I think the person is Anshul', 'raw')).toBeNull();
  });
});

import { instructionFrom } from '../../src/services/voiceRepairService';

describe('more tidying', () => {
  it('strips the date from the title even when the model also filled the deadline', () => {
    const out = normaliseParsed(base({ intent: 'create_task', title: 'kal jaana hai', deadlineText: 'kal' }), 'Shaina ko bolo kal jaana hai');
    expect(out.title).toBe('jaana hai');
    expect(out.deadlineText).toBe('kal');
  });
  it('drops a leading "bolo" from the work', () => {
    const out = normaliseParsed(base({ intent: 'create_task', title: 'bolo godown ki safai kare', deadlineText: null }), 'Lalit ko bolo godown ki safai kare');
    expect(out.title).toBe('godown ki safai kare');
  });
});

describe('the instruction built from a repaired voice note', () => {
  it('uses the repaired sentence when it names the person', () => {
    expect(instructionFrom({ text: 'Anshul Raibole, check the godown.', person: 'Anshul Raibole', confidence: 0.9, unsure: null }))
      .toBe('Anshul Raibole, check the godown.');
  });
  it('puts the person back when the sentence lost them', () => {
    const text = instructionFrom({ text: 'Deploy slowly by today', person: 'Anshul Raibole', confidence: 0.95, unsure: null });
    expect(text).toBe('Task for Anshul Raibole: Deploy slowly by today');
    const cmd = parseWithRules(text)!;
    expect(cmd.intent).toBe('create_task');
    expect(cmd.targetName).toBe('Anshul Raibole');
  });
  it('leaves a question as a question', () => {
    expect(instructionFrom({ text: 'kitne tasks pending hain', person: 'Rishi', confidence: 0.9, unsure: null })).toBe('Rishi: kitne tasks pending hain');
  });
});

import { MAX_KEYTERMS } from '../../src/services/businessContext';

describe('key-term limits the speech provider enforces', () => {
  const big = Array.from({ length: 80 }, (_, i) => `Person${i} Surname${i}`);
  it('never exceeds the cap, and keeps full names ahead of everything else', () => {
    const terms = speechKeyterms(big);
    expect(terms).toHaveLength(MAX_KEYTERMS);
    expect(terms.slice(0, 3)).toEqual(['Person0 Surname0', 'Person1 Surname1', 'Person2 Surname2']);
  });
  it('has no duplicates in any letter case', () => {
    const terms = speechKeyterms(['Lalit', 'lalit', 'Lalit Dubey', 'Dubey', 'DUBEY', 'Godown']);
    expect(new Set(terms.map((t) => t.toLowerCase())).size).toBe(terms.length);
  });
});

import { dropThreat } from '../../src/services/commandService';

describe('an order is not a question', () => {
  it.each([
    'Anshul Raibole ko kal tak kaam khatam kar de',
    'Rishi ko godown ka kaam de do',
    'Shaina ko stock ka kaam karna hai',
  ])('%j is never read as a status query', (text) => {
    expect(parseWithRules(text)?.intent).not.toBe('query_person');
    expect(parseWithRules(text)?.intent).not.toBe('query_team');
  });
  it.each([
    ['Anshul ke tasks',          'query_person'],
    ['Anshul ko kya karna hai',  'query_person'],
    ['Ramesh ke pending kaam',   'query_person'],
    ['team status',              'query_team'],
  ])('%j is still a question', (text, intent) => {
    expect(parseWithRules(text)?.intent).toBe(intent);
  });
});

describe('a threat is not part of the work', () => {
  it.each([
    ['kaam khatam kar de, nahi toh dekh lena',          'kaam khatam kar de'],
    ['godown check karo warna salary kategi',           'godown check karo'],
    ['finish the count otherwise you stay late',        'finish the count'],
    ['godown check karna',                              'godown check karna'],
  ])('%j → %j', (said, kept) => {
    expect(dropThreat(said)).toBe(kept);
  });
});
