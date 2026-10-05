import { describe, it, expect } from 'vitest';
import { assignableUsers, reassignCandidates } from './assignees.js';

const users = [
  { id: 'U1', name: 'TDM Admin',  role: 'Admin',    reportingTo: null },
  { id: 'U7', name: 'Ashish',     role: 'Admin',    reportingTo: 'U1' },
  { id: 'U29', name: 'Bipan',     role: 'Admin',    reportingTo: 'U1' },
  { id: 'U8', name: 'Aditya',     role: 'Manager',  reportingTo: 'U1' },
  { id: 'U9', name: 'Anshul',     role: 'Employee', reportingTo: 'U8' },
  { id: 'U10', name: 'Rishi',     role: 'Employee', reportingTo: 'U7' },
  { id: 'U11', name: 'Gone',      role: 'Employee', reportingTo: 'U7', deactivatedAt: '2026-09-01' },
];
const names = (list) => list.map((u) => u.name);

describe('who an Admin can assign to', () => {
  it('includes the other Admins — two owners assign work to each other', () => {
    const list = names(assignableUsers(users, users[1]));
    expect(list).toContain('Bipan');
    expect(list).toContain('TDM Admin');
  });
  it('includes managers and every employee, not only direct reports', () => {
    const list = names(assignableUsers(users, users[2]));
    expect(list).toEqual(expect.arrayContaining(['Aditya', 'Anshul', 'Rishi', 'Ashish']));
  });
  it('leaves out deactivated members, and lists themselves last, flagged', () => {
    const list = assignableUsers(users, users[1]);
    expect(names(list)).not.toContain('Gone');
    expect(list[list.length - 1]).toMatchObject({ name: 'Ashish', isSelf: true });
  });
});

describe('who a Manager can assign to', () => {
  it('is their direct reports plus themselves, nobody else', () => {
    expect(names(assignableUsers(users, users[3]))).toEqual(['Anshul', 'Aditya']);
  });
});

describe('employees', () => {
  it('assign to nobody', () => {
    expect(assignableUsers(users, users[4])).toEqual([]);
  });
});

describe('reassignment', () => {
  it('drops whoever already holds the task', () => {
    const task = { assignedTo: 'U10', assignees: [{ userId: 'U10' }, { userId: 'U9' }] };
    const list = names(reassignCandidates(users, users[1], task));
    expect(list).not.toContain('Rishi');
    expect(list).not.toContain('Anshul');
    expect(list).toContain('Bipan');
  });
});
