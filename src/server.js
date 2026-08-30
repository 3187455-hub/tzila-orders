const express = require('express');
const path = require('path');
const session = require('express-session');
const config = require('./config');

const ivrRegister = require('./ivr/register');
const ivrStatus = require('./ivr/status');
const ivrDonate = require('./ivr/donate');
const ivrHangup = require('./ivr/hangup');
const adminRoutes = require('./admin/routes');
const { ensureSeeded } = require('./db/seed');

ensureSeeded();

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'admin', 'views'));

app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
  })
);

// אימות בסיסי לוודא שהבקשה ל-webhook הגיעה מימות המשיח (מילת סוד
// שמוגדרת גם בהגדרות ה-api_add בשלוחה בימות המשיח)
function verifyYemot(req, res, next) {
  if (!config.yemot.sharedSecret) return next(); // לא הוגדר - מדלג (מומלץ להגדיר בפרודקשן)
  if (req.query.secret === config.yemot.sharedSecret) return next();
  return res.status(403).send('forbidden');
}

app.get('/ivr/register', verifyYemot, ivrRegister.handle);
app.get('/ivr/status', verifyYemot, ivrStatus.handle);
app.get('/ivr/donate', verifyYemot, ivrDonate.handle);
app.get('/ivr/hangup', verifyYemot, ivrHangup.handle);

app.use('/admin', adminRoutes);

app.get('/', (req, res) => res.redirect('/admin'));

// רשת ביטחון: שגיאה לא צפויה בפאנל הניהול תציג הודעה ברורה במקום להתרסק
app.use((err, req, res, next) => {
  console.error('Unhandled error', err);
  if (req.path.startsWith('/ivr/')) return res.status(500).send('hangup=yes');
  res.status(500).send('אירעה שגיאה בלתי צפויה: ' + err.message);
});

app.listen(config.port, () => {
  console.log(`השרת פועל על פורט ${config.port}`);
});
