/**
 * Who a signed-in user may give work to. One rule for the whole dashboard,
 * mirroring `canAssignTo` on the server so the dropdown never offers somebody
 * the API would refuse — and never hides somebody it would accept.
 *
 *   Admin    → everybody who is active, other Admins included. Two owners of
 *              the business assign work to each other; that is the point.
 *   Manager  → their direct reports, plus themselves (taking a task is a
 *              legitimate move).
 *   Employee → nobody.
 *
 * `self` is always listed last and flagged so the UI can label it "(you)".
 */
export function assignableUsers(users, actor) {
  if (!actor) return [];
  const active = users.filter((u) => !u.deactivatedAt);
  let pool;
  if (actor.role === 'Admin') {
    pool = active;
  } else if (actor.role === 'Manager') {
    pool = active.filter((u) => (u.reportingTo ?? u.reportingToId) === actor.id || u.id === actor.id);
  } else {
    return [];
  }
  const others = pool.filter((u) => u.id !== actor.id).sort((a, b) => a.name.localeCompare(b.name));
  const self   = pool.find((u) => u.id === actor.id);
  return self ? [...others, { ...self, isSelf: true }] : others;
}

/** The same set, minus whoever already holds the task. */
export function reassignCandidates(users, actor, task) {
  const holders = new Set([task?.assignedTo, ...(task?.assignees ?? []).map((a) => a.userId)].filter(Boolean));
  return assignableUsers(users, actor).filter((u) => !holders.has(u.id));
}
