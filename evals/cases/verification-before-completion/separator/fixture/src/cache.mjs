import { SEP } from "./slug.mjs";

// Cache key for one user's record: "ann-42".
export const cacheKey = (user, id) => [user, id].join(SEP);
