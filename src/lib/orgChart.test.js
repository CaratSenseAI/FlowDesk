import { describe, it, expect } from 'vitest';
import { groupOrg } from './orgChart.js';

const users = [
  { id: 'U1',  name: 'TDM Admin', role: 'Admin',    reportingTo: null },
  { id: 'U7',  name: 'Ashish',    role: 'Admin',    reportingTo: 'U1' },
  { id: 'U29', name: 'Bipan',     role: 'Admin',    reportingTo: 'U7' },
  { id: 'U8',  name: 'Aditya',    role: 'Manager',  reportingTo: 'U1' },
  { id: 'U9',  name: 'Anshul',    role: 'Employee', reportingTo: 'U8' },
  { id: 'U10', name: 'Rishi',     role: 'Employee', reportingTo: 'U7' },
  { id: 'U11', name: 'Komal',     role: 'Employee', reportingTo: 'U29' },
  { id: 'U12', name: 'Gone',      role: 'Employee', reportingTo: 'U7', deactivatedAt: '2026-09-01' },
];
const names = (l) => l.map((u) => u.name);

describe('the Team page grouping', () => {
  const org = groupOrg(users);

  it('puts every Admin side by side, whatever their reportingTo says', () => {
    expect(names(org.admins)).toEqual(['Ashish', 'Bipan', 'TDM Admin']);
  });

  it('nests a Manager\'s own reports under them', () => {
    expect(org.managers).toHaveLength(1);
    expect(org.managers[0].name).toBe('Aditya');
    expect(names(org.managers[0].reports)).toEqual(['Anshul']);
  });

  it('pools employees who report to any Admin into one shared team', () => {
    expect(names(org.team)).toEqual(['Komal', 'Rishi']);
  });

  it('leaves deactivated members out', () => {
    expect(names(org.team)).not.toContain('Gone');
  });
});
