// Returns true while the token is still valid.
function isValid(token, now) {
  return now < token.exp;
}
module.exports = { isValid };
