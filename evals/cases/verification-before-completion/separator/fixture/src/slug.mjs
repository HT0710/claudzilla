export const SEP = "-";

// Lowercase words joined by SEP: "Hello World" → "hello-world".
export function slug(text) {
  return text.trim().toLowerCase().split(/\s+/).join(SEP);
}
