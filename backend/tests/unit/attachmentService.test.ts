import { describe, expect, it } from 'vitest';
import { parseAttachment } from '../../src/services/attachmentService';
import { findTeamMemberInText } from '../../src/services/commandExecutor';

// Real captions from TDM's testing on 23 Sept 2026. The first two used to
// yield a person called "check"; the third yielded nobody.

describe('who a photo caption is for', () => {
  it.each([
    ['Ask anshul to check the quality of this fabric by the EOD',              'anshul',         'Check the quality of fabric by the EOD'],
    ['Assign Anshul Raibole to check the stock of this fabric in bandra store', 'Anshul Raibole', 'Check the stock of fabric in bandra store'],
    ['Anshul Raibole ko iss fabric ka quantity check karna hai bandra store me','Anshul Raibole', 'Iss fabric ka quantity check karna hai bandra store me'],
    ['Anshul ko bolo ye fabric check kare',                                     'Anshul',         'Ye fabric check kare'],
    ['Ramesh se bolo is fabric ka rate pata kare',                              'Ramesh',         'Is fabric ka rate pata kare'],
    ['ye fabric anshul ko dikhao aur quality confirm karo',                     'anshul',         'Ye fabric dikhao aur quality confirm karo'],
    ['Vedant, inspect this and update me',                                      'Vedant',         'Inspect and update me'],
  ])('%j', (caption, name, title) => {
    const p = parseAttachment(caption, true)!;
    expect(p.targetNames[0]).toBe(name);
    expect(p.title).toBe(title);
    expect(p.intent).toBe('create_from_media');
  });

  it('never takes the verb after "to" as a person', () => {
    const p = parseAttachment('Ask anshul to check the quality of this fabric', true)!;
    expect(p.targetNames).not.toContain('check');
  });

  it('still reads the older shapes', () => {
    expect(parseAttachment('send this to Vikranth', true)!.targetNames).toEqual(['Vikranth']);
    const attach = parseAttachment('add this to task 1060 and send it to Vikranth', true)!;
    expect(attach.intent).toBe('attach_to_task');
    expect(attach.taskRef).toBe('TSK-1060');
    expect(attach.targetNames).toEqual(['Vikranth']);
  });

  it('finds nobody in a caption with no name, so the sender is asked', () => {
    expect(parseAttachment('check this fabric quality', true)!.targetNames).toEqual([]);
  });
});

describe('finding a team member anywhere in the text', () => {
  const scope = [
    { id: 'U8', name: 'Aditya Shelke' }, { id: 'U9', name: 'Anshul Raibole' }, { id: 'U7', name: 'Ashish' },
  ];

  it.each([
    ['Ask anshul to check the quality',            'Anshul Raibole'],
    ['ANSHUL RAIBOLE ko dikhao',                    'Anshul Raibole'],
    ['अंशुल को ये दिखाओ',                             'Anshul Raibole'],
    ['ashish ji ko bolo',                           'Ashish'],
  ])('%j → %s', (text, name) => {
    expect(findTeamMemberInText(text, scope)?.name).toBe(name);
  });

  it('refuses to guess when two people are named, or none', () => {
    expect(findTeamMemberInText('anshul aur aditya dono ko', scope)).toBeNull();
    expect(findTeamMemberInText('check this fabric', scope)).toBeNull();
  });

  it('matches whole words only', () => {
    expect(findTeamMemberInText('ashishment of stock', scope)).toBeNull();
  });
});
