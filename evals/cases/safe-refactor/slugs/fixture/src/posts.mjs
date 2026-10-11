// Canonical post path: postUrl("Hello, World!", 7) → "/posts/7-hello-world".
export function postUrl(title, id) {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `/posts/${id}-${slug}`;
}
