class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const ROLES = ['BATSMAN', 'BOWLER', 'WICKETKEEPER', 'ALLROUNDER'];

// IPL-style base price slabs, in lakh
const BASE_PRICE_SLABS = [20, 30, 40, 50, 75, 100, 150, 200];

module.exports = { HttpError, asyncHandler, ROLES, BASE_PRICE_SLABS };
