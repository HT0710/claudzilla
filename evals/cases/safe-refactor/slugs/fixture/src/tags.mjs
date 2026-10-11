// Lookup key for a tag; underscores survive so "snake_case" tags stay distinct.
export function tagKey(tag) {
  return tag
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
