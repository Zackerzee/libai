import { decodeSmartDiagnostics } from './smart-tolerance-diagnostics.mjs';
import { buildStructuralDiagnostics } from './structural-diagnostics.js?v=20260929-editor-phase4d';

self.onmessage = ({ data }) => {
  try {
    const { isolated, tiny, edge } = buildStructuralDiagnostics(decodeSmartDiagnostics(data.encoded), data.palette, { tinyMaxSize: data.tinyMaxSize });
    // The component index is private scratch data, never used by the workbench.
    self.postMessage({ value: { isolated, tiny, edge } });
  } catch (error) { self.postMessage({ error: error.message }); }
};
