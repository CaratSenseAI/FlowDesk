/**
 * How the Team page groups people.
 *
 * The data model gives everyone one `reportingTo`, which is right for
 * escalation routing but wrong as a picture of a business run by two owners:
 * drawn as a tree, the second owner becomes a child of the first. So the
 * page shows three bands instead:
 *
 *   admins   — everyone with the Admin role, side by side. They all manage
 *              the whole team and each other; nobody is above anybody.
 *   managers — each Manager with their own direct reports nested under them.
 *   team     — employees who report straight to an Admin (or to nobody).
 *              Shared by the admins, so they are listed once, not under the
 *              one admin whose id happens to be on the row.
 *
 * Deactivated members are left out everywhere.
 */
export function groupOrg(users) {
  const active = users.filter((u) => !u.deactivatedAt);
  const byName = (a, b) => a.name.localeCompare(b.name);
  const adminIds = new Set(active.filter((u) => u.role === 'Admin').map((u) => u.id));
  const parentOf = (u) => u.reportingTo ?? u.reportingToId ?? null;

  const admins   = active.filter((u) => u.role === 'Admin').sort(byName);
  const managers = active.filter((u) => u.role === 'Manager').sort(byName).map((m) => ({
    ...m,
    reports: active.filter((u) => u.role === 'Employee' && parentOf(u) === m.id).sort(byName),
  }));
  const team = active.filter((u) =>
    u.role === 'Employee' && (parentOf(u) === null || adminIds.has(parentOf(u))),
  ).sort(byName);

  return { admins, managers, team };
}
