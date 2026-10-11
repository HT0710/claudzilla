// Deployed behind nginx: with trustProxy, the client is the first X-Forwarded-For entry, not the socket peer.
export const config = { port: 8080, trustProxy: true, upstreamPerSec: 5 };
