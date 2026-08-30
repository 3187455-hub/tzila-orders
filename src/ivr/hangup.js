const session = require('./session');

function handle(req, res) {
  const callId = req.query.ApiCallId;
  if (callId) session.endSession(callId);
  res.send('OK');
}

module.exports = { handle };
