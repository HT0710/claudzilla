import { config } from "./config.mjs";
import { TokenBucket } from "./limits.mjs";

const ITEMS = [{ id: 1, name: "kettle" }, { id: 2, name: "teapot" }];
// Outbound pricing calls are capped so the supplier never sees a burst from us.
const upstream = new TokenBucket(config.upstreamPerSec, config.upstreamPerSec);

export const listItems = () => ITEMS;
export const getItem = (id) => ITEMS.find((i) => i.id === id) ?? null;
export const canCallUpstream = () => upstream.take();
