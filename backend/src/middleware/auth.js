const jwt = require('jsonwebtoken');

function readToken(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return { error: 'Authentication required' };
  try {
    return { payload: jwt.verify(token, process.env.JWT_SECRET) };
  } catch {
    return { error: 'Invalid or expired token' };
  }
}

const guard = (role, key) => (req, res, next) => {
  const { payload, error } = readToken(req);
  if (error) return res.status(401).json({ error });
  if (payload.role !== role) return res.status(403).json({ error: 'Not allowed for this account type' });
  req[key] = payload;
  next();
};

module.exports = {
  requireAdmin: guard('admin', 'admin'),
  requireTeam: guard('team', 'team'),
};
