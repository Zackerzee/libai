const emptyState = () => ({ issues: [], index: -1, cellIndex: 0, active: false });

export function normalizeDiagnosticIssue(issue, index = 0) {
  const cells = Array.isArray(issue?.cells)
    ? issue.cells.filter((cell) => Number.isFinite(cell?.x) && Number.isFinite(cell?.y)).map(({ x, y }) => ({ x, y }))
    : [];
  const type = String(issue?.type || "unknown");
  return {
    id: String(issue?.id || `${type}:${issue?.paletteId || index}`),
    type,
    paletteId: issue?.paletteId || null,
    cells,
    severity: issue?.severity || null,
    label: String(issue?.label || issue?.paletteId || type),
    meta: { ...(issue?.meta || {}) },
  };
}

export function createInspectionState(initial = {}) {
  const issues = (initial.issues || []).map(normalizeDiagnosticIssue);
  const index = issues.length ? Math.max(0, Math.min(issues.length - 1, Number(initial.index) || 0)) : -1;
  return { ...emptyState(), ...initial, issues, index, cellIndex: Math.max(0, Number(initial.cellIndex) || 0), active: Boolean(initial.active && issues.length) };
}

export function currentInspectionIssue(state) {
  return state?.index >= 0 ? state.issues?.[state.index] || null : null;
}

export function setInspectionIssues(state, nextIssues) {
  const previous = currentInspectionIssue(state);
  const issues = (nextIssues || []).map(normalizeDiagnosticIssue);
  if (!issues.length) return emptyState();
  const same = previous ? issues.findIndex((issue) => issue.id === previous.id) : -1;
  const index = same >= 0 ? same : Math.max(0, Math.min(issues.length - 1, state?.index >= 0 ? state.index : 0));
  const issue = issues[index];
  return { issues, index, cellIndex: Math.min(state?.cellIndex || 0, Math.max(0, issue.cells.length - 1)), active: Boolean(state?.active) };
}

export function startInspection(state, index = state?.index) {
  if (!state?.issues?.length) return emptyState();
  return { ...state, active: true, index: Math.max(0, Math.min(state.issues.length - 1, index >= 0 ? index : 0)), cellIndex: 0 };
}

export const stopInspection = (state) => ({ ...createInspectionState(state), active: false });

function moveIssue(state, delta) {
  if (!state?.issues?.length) return emptyState();
  const base = state.index >= 0 ? state.index : 0;
  return { ...state, active: true, index: Math.max(0, Math.min(state.issues.length - 1, base + delta)), cellIndex: 0 };
}

export const nextInspectionIssue = (state) => moveIssue(state, 1);
export const previousInspectionIssue = (state) => moveIssue(state, -1);

export function moveInspectionCell(state, delta) {
  const issue = currentInspectionIssue(state);
  if (!issue?.cells?.length) return { ...state, cellIndex: 0 };
  const length = issue.cells.length;
  return { ...state, cellIndex: ((state.cellIndex || 0) + delta + length) % length };
}

export const nextInspectionCell = (state) => moveInspectionCell(state, 1);
export const previousInspectionCell = (state) => moveInspectionCell(state, -1);

