// Token bucket: bursts up to `capacity`, refills `perSec` tokens a second.
export class TokenBucket {
  constructor(capacity, perSec, now = Date.now) {
    Object.assign(this, { capacity, perSec, now, tokens: capacity, at: now() });
  }

  #refill() {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.at) / 1000) * this.perSec);
    this.at = t;
  }

  // True when a token was available (and spent).
  take() {
    this.#refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  // Milliseconds until the next token.
  wait() {
    this.#refill();
    return this.tokens >= 1 ? 0 : Math.ceil(((1 - this.tokens) / this.perSec) * 1000);
  }
}
