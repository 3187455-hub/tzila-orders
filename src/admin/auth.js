const bcrypt = require('bcryptjs');
const db = require('../db');

function requireLogin(req, res, next) {
  if (req.session && req.session.adminId) return next();
  return res.redirect('/admin/login');
}

function verifyLogin(username, password) {
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!user) return null;
  const ok = bcrypt.compareSync(password, user.password_hash);
  return ok ? user : null;
}

module.exports = { requireLogin, verifyLogin };
