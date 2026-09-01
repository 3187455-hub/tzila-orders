const express = require('express');
const path = require('path');
const session = require('express-session');
const config = require('./config');

const ivrRegister = require('./ivr/register');
const ivrStatus = require('./ivr/status');
const ivrDonate = require('./ivr/donate');
const ivrMessage = require('./ivr/message');
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
  console.warn(`IVR request rejected (bad/missing secret): ${req.path} ${JSON.stringify(req.query)}`);
  return res.status(403).send('forbidden');
}

// לוג לכל בקשת IVR - עוזר לאבחן אם ימות המשיח בכלל הגיע לשרת ומה חזר לו
app.use('/ivr', (req, res, next) => {
  const params = { ...req.query };
  delete params.secret;
  console.log(`IVR IN  ${req.path} ${JSON.stringify(params)}`);
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    console.log(`IVR OUT ${req.path} -> ${body}`);
    return originalSend(body);
  };
  next();
});

// שלוחת אבחון זמנית - לבידוד תקלות
app.get('/ivr/diag', (req, res) => {
  console.log('DIAG params:', JSON.stringify(req.query));
  if (req.query.TESTKEY) {
    return res.send(`id_list_message=t-You pressed ${req.query.TESTKEY}`);
  }
  return res.send('read=t-Press one=TESTKEY,no,1,1,15,Digits,yes,no,,');
});

app.get('/ivr/register', verifyYemot, ivrRegister.handle);
app.get('/ivr/status', verifyYemot, ivrStatus.handle);
app.get('/ivr/donate', verifyYemot, ivrDonate.handle);
app.get('/ivr/message', verifyYemot, ivrMessage.handle);
// api_hangup_link לא בהכרח מקבל את אותם פרמטרים סטטיים (api_add) של
// שלוחת ה-API הראשית, ופעולת הניקוי כאן לא רגישה - לכן בלי בדיקת סוד
app.get('/ivr/hangup', ivrHangup.handle);

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
