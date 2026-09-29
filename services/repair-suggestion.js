import { findSimilarPaletteColors } from "./palette-diagnostics.js";
import { paletteIdOf } from "./palette-identity.js";

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const cellKey = ({ x, y }) => `${x},${y}`;
const ISSUE_PRIORITY = Object.freeze({
  "edge-contamination": 30,
  "isolated-pixel": 20,
  "tiny-region": 10,
  "rare-color": 0,
});

export const confidenceLevel = (confidence) => confidence >= .8 ? "high" : confidence >= .55 ? "medium" : "low";

export function stableIssueKey(issue) {
  const cells = [...(issue?.cells || [])].map(cellKey).sort().join(";");
  return `${issue?.type || "unknown"}|${issue?.paletteId || ""}|${cells}`;
}

function confidenceFor(issue, target, reason) {
  const meta = issue.meta || {};
  if (reason === "similar-palette") return .38;
  const ratio = clamp01(meta.dominantNeighborRatio);
  const componentSize = Math.max(1, Number(meta.componentSize) || issue.cells?.length || 1);
  const sizeScore = 1 / componentSize;
  const severityScore = { high: 1, medium: .62, low: .3 }[issue.severity] || .45;
  const distance = Number(meta.colorDistance);
  const distanceScore = Number.isFinite(distance) ? Math.min(1, distance / 24) : .35;
  const samePenalty = Math.min(.2, (Number(meta.sameNeighborCount) || 0) * .05);
  const typeBonus = issue.type === "edge-contamination" ? .05 : 0;
  return clamp01(ratio * .55 + sizeScore * .2 + severityScore * .15 + distanceScore * .1 + typeBonus - samePenalty);
}

function reasonText(issue, reason, targetCode) {
  const meta = issue.meta || {};
  if (reason === "dominant-neighbor") {
    const count = Number(meta.dominantNeighborCount) || 0;
    const total = Math.max(count, Number(meta.neighborCount) || Math.round(count / Math.max(.01, Number(meta.dominantNeighborRatio) || 1)));
    return `周围 ${count} / ${total} 格为 ${targetCode}`;
  }
  return `${targetCode} 是当前色在真实色卡中的相近颜色，仅供人工判断`;
}

export function createRepairSuggestion(issue, palette = []) {
  if (!issue?.cells?.length || !issue.paletteId) return null;
  const paletteById = new Map(palette.map((color) => [paletteIdOf(color), color]));
  let targetPaletteId = issue.meta?.suggestedPaletteId || null;
  let reason = "dominant-neighbor";
  if (!targetPaletteId || !paletteById.has(targetPaletteId) || targetPaletteId === issue.paletteId) {
    const similar = findSimilarPaletteColors(palette, issue.paletteId, { limit: 1, excludeSelf: true })[0];
    targetPaletteId = similar?.paletteId || null;
    reason = "similar-palette";
  }
  if (!targetPaletteId || targetPaletteId === issue.paletteId || !paletteById.has(targetPaletteId)) return null;
  const confidence = confidenceFor(issue, targetPaletteId, reason);
  const target = paletteById.get(targetPaletteId);
  return Object.freeze({
    id: `repair:${stableIssueKey(issue)}:${targetPaletteId}`,
    issueId: issue.id,
    issueKey: stableIssueKey(issue),
    type: "replace-palette",
    issueType: issue.type,
    cells: issue.cells.map(({ x, y }) => ({ x, y })),
    sourcePaletteId: issue.paletteId,
    targetPaletteId,
    confidence,
    confidenceLevel: confidenceLevel(confidence),
    reason,
    reasonText: reasonText(issue, reason, target?.code || targetPaletteId),
    meta: Object.freeze({ ...issue.meta, issueSeverity: issue.severity, targetCode: target?.code || targetPaletteId }),
  });
}

export function deriveRepairSuggestions(issues = [], palette = [], ignoredIssueKeys = new Set()) {
  return issues
    .filter((issue) => !ignoredIssueKeys.has(stableIssueKey(issue)))
    .map((issue) => createRepairSuggestion(issue, palette))
    .filter(Boolean);
}

export function resolveRepairConflicts(suggestions = []) {
  const byCell = new Map();
  for (const suggestion of suggestions) for (const cell of suggestion.cells || []) {
    const key = cellKey(cell);
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key).push({ suggestion, cell });
  }
  const changes = [], conflicts = [];
  for (const [key, entries] of byCell) {
    const targets = new Set(entries.map(({ suggestion }) => suggestion.targetPaletteId));
    if (targets.size > 1) {
      conflicts.push({ key, cell: { ...entries[0].cell }, targetPaletteIds: [...targets].sort(), suggestions: entries.map(({ suggestion }) => suggestion) });
      continue;
    }
    entries.sort((a, b) => (ISSUE_PRIORITY[b.suggestion.issueType] || 0) - (ISSUE_PRIORITY[a.suggestion.issueType] || 0)
      || b.suggestion.confidence - a.suggestion.confidence || a.suggestion.id.localeCompare(b.suggestion.id));
    const chosen = entries[0].suggestion;
    changes.push({ ...entries[0].cell, sourcePaletteId: chosen.sourcePaletteId, targetPaletteId: chosen.targetPaletteId, suggestionId: chosen.id });
  }
  return { changes, conflicts };
}

export function createRepairQueue(suggestions = []) {
  const counts = { high: 0, medium: 0, low: 0 };
  suggestions.forEach((suggestion) => { counts[suggestion.confidenceLevel] += 1; });
  const highPlan = resolveRepairConflicts(suggestions.filter((suggestion) => suggestion.confidenceLevel === "high"));
  return { suggestions, counts, highPlan, conflicts: highPlan.conflicts };
}

export function createRepairPreview(suggestion) {
  return suggestion ? { cells: suggestion.cells.map((cell) => ({ ...cell })), targetPaletteId: suggestion.targetPaletteId, suggestionId: suggestion.id } : null;
}
