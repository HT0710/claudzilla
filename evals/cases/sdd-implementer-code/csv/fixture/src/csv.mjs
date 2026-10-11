// Joins fields into one CSV line, quoting fields that contain `,`, `"` or a newline.
export function formatCsvLine(fields) {
  return fields.map((f) => (/[",\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f)).join(",");
}
