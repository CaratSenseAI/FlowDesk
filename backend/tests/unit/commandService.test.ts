import { describe, expect, it } from 'vitest';
import { ParsedCommand, mergeParsed, parseWithRules } from '../../src/services/commandService';

// The rule layer is what runs when no AI key is configured, so everything here
// is the guaranteed floor of the feature rather than a best case.

describe('reassignment', () => {
  it.each([
    ['Assign TSK-1059 to Vikranth',                    'TSK-1059', 'Vikranth'],
    ['Allocate task 1059 to Vedant',                   'TSK-1059', 'Vedant'],
    ['Reassign my ticket TSK-1059 to Vikranth',        'TSK-1059', 'Vikranth'],
    ['allocate task TSK-1059 to Vikranth.',            'TSK-1059', 'Vikranth'],
    ['Please reassign TSK-1059 to Vikranth Sharma',    'TSK-1059', 'Vikranth Sharma'],
    ['delegate TSK-1059 to vedant',                    'TSK-1059', 'vedant'],
    ['Transfer task no 1059 to Vikranth',              'TSK-1059', 'Vikranth'],
    ['hand over TSK-1059 to Vedant',                   'TSK-1059', 'Vedant'],
    ['Tsk1059 - assign to Vikranth',                   'TSK-1059', 'Vikranth'],
  ])('parses %j', (text, taskRef, targetName) => {
    const cmd = parseWithRules(text);
    expect(cmd?.intent).toBe('reassign_ticket');
    expect(cmd?.taskRef).toBe(taskRef);
    expect(cmd?.targetName).toBe(targetName);
    expect(cmd?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('keeps the reason out of the name', () => {
    const cmd = parseWithRules('Delegate TSK-1059 to Vikranth because I have a high workload');
    expect(cmd?.targetName).toBe('Vikranth');
    expect(cmd?.reason).toBe('I have a high workload');
  });

  it('flags a missing ticket number instead of guessing one', () => {
    const cmd = parseWithRules('Delegate this ticket to Vikranth because I have a high workload');
    expect(cmd?.intent).toBe('reassign_ticket');
    expect(cmd?.taskRef).toBeNull();
    expect(cmd?.targetName).toBe('Vikranth');
    // Below the act-immediately bar — the executor has to ask which ticket.
    expect(cmd?.confidence).toBeLessThan(0.9);
  });

  it('flags a missing name the same way', () => {
    const cmd = parseWithRules('reassign TSK-1059');
    expect(cmd?.taskRef).toBe('TSK-1059');
    expect(cmd?.targetName).toBeNull();
    expect(cmd?.confidence).toBeLessThan(0.9);
  });

  it('does not accept a pronoun as an assignee', () => {
    // "assign it to me" names nobody. Treating "me" as a name would send the
    // executor looking for an employee called Me.
    expect(parseWithRules('assign TSK-1059 to me')?.targetName).toBeNull();
  });
});

// The critical safety property: worker traffic must never route into the
// command pipeline. Every string here appears in the existing webhook suite.
describe('worker messages are not commands', () => {
  it.each([
    'task 1060 done',
    'Task 1060 completed and I clicked the picture also',
    'done',
    'ok thanks',
    'TSK-3000 done',
    'in progress',
    '1060 in progress, will complete soon',
    'still stuck on it',
    'task 1061 issue',
    'task 1060 has a problem',
    'Tsk 1060 done',
    'task -1060 done',
    'task number 1060 done',
    'मैंने काम पूरा कर दिया',
    'ho gaya',
    '1058 ho gaya',
  ])('%j parses to null', (text) => {
    expect(parseWithRules(text)).toBeNull();
  });
});

describe('task creation', () => {
  it('pulls the assignee, title and deadline apart', () => {
    const cmd = parseWithRules('Create a task for Vedant to prepare the weekly report by Friday');
    expect(cmd?.intent).toBe('create_task');
    expect(cmd?.targetName).toBe('Vedant');
    expect(cmd?.title).toBe('prepare the weekly report');
    expect(cmd?.deadlineText).toBe('Friday');
  });

  it('reads a priority when one is stated', () => {
    const cmd = parseWithRules('Create a task for Vedant to fix the login page by tomorrow, high priority');
    expect(cmd?.priority).toBe('High');
    expect(cmd?.targetName).toBe('Vedant');
  });
});

describe('comments', () => {
  it('takes the text after "saying"', () => {
    const cmd = parseWithRules('Add a comment to TSK-1059 saying that the client approval is pending');
    expect(cmd?.intent).toBe('add_comment');
    expect(cmd?.taskRef).toBe('TSK-1059');
    expect(cmd?.comment).toBe('that the client approval is pending');
  });
});

describe('priority', () => {
  it('parses "set the priority of TSK-1059 to high"', () => {
    const cmd = parseWithRules('Set the priority of TSK-1059 to high');
    expect(cmd?.intent).toBe('set_priority');
    expect(cmd?.taskRef).toBe('TSK-1059');
    expect(cmd?.priority).toBe('High');
    expect(cmd?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it.each([
    ['make TSK-1059 priority urgent', 'High'],
    ['change priority of task 1059 to low', 'Low'],
    ['set TSK-1059 priority to medium', 'Medium'],
  ])('parses %j', (text, priority) => {
    expect(parseWithRules(text)?.priority).toBe(priority);
  });
});

describe('deadline', () => {
  it('parses "extend the deadline of TSK-1059 to Monday"', () => {
    const cmd = parseWithRules('Extend the deadline of TSK-1059 to Monday');
    expect(cmd?.intent).toBe('set_deadline');
    expect(cmd?.taskRef).toBe('TSK-1059');
    expect(cmd?.deadlineText).toBe('Monday');
  });

  it('parses "move TSK-1059 deadline to next Friday"', () => {
    const cmd = parseWithRules('move TSK-1059 deadline to next Friday');
    expect(cmd?.intent).toBe('set_deadline');
    expect(cmd?.deadlineText).toBe('next Friday');
  });
});

describe('empty input', () => {
  it.each(['', '   ', '\n'])('%j is not a command', (text) => {
    expect(parseWithRules(text)).toBeNull();
  });
});

// The model's output is untrusted input like any other. These pin down exactly
// how much of it is allowed to survive contact with the rule parse.
describe('mergeParsed', () => {
  const cmd = (over: Partial<ParsedCommand>): ParsedCommand => ({
    intent: 'reassign_ticket', taskRef: null, targetName: null, title: null,
    deadlineText: null, priority: null, comment: null, reason: null,
    confidence: 0.6, source: 'rule', ...over,
  });

  it('returns whichever side exists when only one does', () => {
    const rule = cmd({ taskRef: 'TSK-1' });
    expect(mergeParsed(rule, null)).toBe(rule);
    expect(mergeParsed(null, rule)).toBe(rule);
    expect(mergeParsed(null, null)).toBeNull();
  });

  it('lets the model fill a slot the rules left empty', () => {
    const merged = mergeParsed(
      cmd({ taskRef: 'TSK-1059', targetName: null }),
      cmd({ taskRef: 'TSK-1059', targetName: 'Vikranth', source: 'ai', confidence: 0.88 }),
    );
    expect(merged?.targetName).toBe('Vikranth');
    expect(merged?.source).toBe('ai');
  });

  it('never lets the model overwrite a ticket number the rules found', () => {
    // The most damaging single field to get wrong — it aims the whole command
    // at somebody else's work.
    const merged = mergeParsed(
      cmd({ taskRef: 'TSK-1059', targetName: 'Vedant', confidence: 0.95 }),
      cmd({ taskRef: 'TSK-9999', targetName: 'Vedant', source: 'ai', confidence: 0.9 }),
    );
    expect(merged?.taskRef).toBe('TSK-1059');
  });

  it('trusts an explicit verb over an inferred intent', () => {
    const rule = cmd({ intent: 'reassign_ticket', taskRef: 'TSK-1059', targetName: 'Vedant' });
    const ai   = cmd({ intent: 'create_task', source: 'ai', confidence: 0.9 });
    expect(mergeParsed(rule, ai)?.intent).toBe('reassign_ticket');
  });

  it('does not inflate confidence beyond what the model claimed', () => {
    const merged = mergeParsed(
      cmd({ confidence: 0.6 }),
      cmd({ source: 'ai', confidence: 0.7, targetName: 'Vedant' }),
    );
    expect(merged?.confidence).toBe(0.7);
  });
});
