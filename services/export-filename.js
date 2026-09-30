const ILLEGAL = /[\\/:*?"<>|\u0000-\u001F]/g;

export function sanitizeExportFilename(title, fallback = "未命名作品") {
  const clean = String(title ?? "").replace(ILLEGAL, "-").replace(/\s+/g, " ").replace(/-+/g, "-").trim().replace(/[. ]+$/g, "");
  return clean || fallback;
}

export function exportFilename(title, kind, extension) {
  const base = sanitizeExportFilename(title);
  const suffix = kind === "poster-3x4" ? "_海报_3x4" : kind === "poster-1x1" ? "_海报_1x1" : kind === "overview" ? "_总览" : "";
  return `${base}${suffix}.${String(extension).replace(/^\./, "")}`;
}

