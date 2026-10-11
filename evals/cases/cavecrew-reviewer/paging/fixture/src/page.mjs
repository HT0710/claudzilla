// Returns page `n` (1-based) of `items`, `size` per page; [] past the end.
export function page(items, n, size) {
  const start = (n - 1) * size;
  return items.slice(start, start + size);
}
