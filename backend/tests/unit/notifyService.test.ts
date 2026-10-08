import { describe, expect, it } from 'vitest';
import { bodyFor, chooseAssignmentSend } from '../../src/services/notifyService';
import { detailsParam, formatDeadlineIST } from '../../src/services/whatsappService';

// 20 Sept 2026, 17:00 IST = 11:30 UTC
const DEADLINE = new Date('2026-09-20T11:30:00.000Z');

describe('which send an assignment uses', () => {
  it.each([
    // window open: free-form, image rides as media with the text as caption
    [{ sessionOpen: true,  kind: 'new',        hasImage: false, richApproved: false }, 'free_text'],
    [{ sessionOpen: true,  kind: 'new',        hasImage: true,  richApproved: false }, 'media_with_caption'],
    [{ sessionOpen: true,  kind: 'reassigned', hasImage: true,  richApproved: true  }, 'media_with_caption'],
    // window shut, templates not yet approved: exactly what shipped before
    [{ sessionOpen: false, kind: 'new',        hasImage: false, richApproved: false }, 'template_legacy_assignment'],
    [{ sessionOpen: false, kind: 'new',        hasImage: true,  richApproved: false }, 'template_legacy_assignment'],
    [{ sessionOpen: false, kind: 'reassigned', hasImage: false, richApproved: false }, 'template_legacy_reassigned'],
    // window shut, approved: the rich ones, image header when there is an image
    [{ sessionOpen: false, kind: 'new',        hasImage: false, richApproved: true  }, 'template_full'],
    [{ sessionOpen: false, kind: 'new',        hasImage: true,  richApproved: true  }, 'template_image'],
    [{ sessionOpen: false, kind: 'reassigned', hasImage: true,  richApproved: true  }, 'template_reassigned_full'],
  ] as const)('%j → %s', (o, expected) => {
    expect(chooseAssignmentSend(o)).toBe(expected);
  });
});

describe('the free-form assignment text', () => {
  const base = {
    assignee: { id: 'U2', name: 'Anshul', phone: '91', preferredLanguage: 'en' },
    actor: { id: 'U1', name: 'Aditya' }, channel: 'web' as never,
  };

  it('says what the work is, when it is due, and the details', () => {
    const text = bodyFor({ ...base, kind: 'new', task: {
      id: 'TSK-12', title: 'Godown stock check', deadline: DEADLINE, description: 'Count rolls in rack B',
    } });
    expect(text).toBe([
      '📋 New task assigned: TSK-12', '', '*Godown stock check*',
      'Deadline: 20 Sept, 5:00 pm', 'Details: Count rolls in rack B', '',
      "Reply here when you've started or finished it.",
    ].join('\n'));
  });

  it('leaves out lines it has nothing for, and names who moved a reassigned task', () => {
    const text = bodyFor({ ...base, kind: 'reassigned', task: { id: 'TSK-3', title: 'Vendor visit' } });
    expect(text).toBe([
      '📋 Aditya has assigned ticket TSK-3 to you.', '', '*Vendor visit*', '',
      "Reply here when you've started or finished it.",
    ].join('\n'));
  });
});

describe('template slot values', () => {
  it('formats the deadline in Indian time', () => {
    expect(formatDeadlineIST(DEADLINE)).toBe('20 Sept, 5:00 pm');
  });

  it('never sends an empty details slot — Meta rejects the whole message', () => {
    expect(detailsParam('')).toBe('none');
    expect(detailsParam(null, 'hi')).toBe('कोई नहीं');
    expect(detailsParam('  Count\n rolls  ')).toBe('Count rolls');
  });
});

import { endOfTodayIST } from '../../src/services/deadlineParser';

describe('the default deadline for a WhatsApp command with no date', () => {
  it('is 23:59 of the same calendar day in Indian time', () => {
    // 8 Oct 2026, 19:30 IST (14:00 UTC): still "today" in India → 23:59 IST = 18:29 UTC
    expect(endOfTodayIST(new Date('2026-10-08T14:00:00.000Z')).toISOString()).toBe('2026-10-08T18:29:00.000Z');
    // 8 Oct 2026, 23:30 IST (18:00 UTC): still 8 Oct in India
    expect(endOfTodayIST(new Date('2026-10-08T18:00:00.000Z')).toISOString()).toBe('2026-10-08T18:29:00.000Z');
    // 00:30 IST on 9 Oct (19:00 UTC on 8 Oct): already 9 Oct in India
    expect(endOfTodayIST(new Date('2026-10-08T19:00:00.000Z')).toISOString()).toBe('2026-10-09T18:29:00.000Z');
  });
  it('is never earlier than now, so a task is never born overdue', () => {
    const now = new Date();
    expect(endOfTodayIST(now).getTime()).toBeGreaterThan(now.getTime());
  });
});
