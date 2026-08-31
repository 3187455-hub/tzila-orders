const config = require('../config');
const { chargeCreditCard } = require('../ivr/directives');
const yemotFiles = require('./yemotFiles');

const PROCESSOR = 'nedarim_plus';

function buildChargeDirective(amount) {
  return chargeCreditCard({
    amount,
    terminalNumber: config.nedarimPlus.terminalNumber,
    apiValid: config.nedarimPlus.apiValid,
    createToken: true,
    category: config.nedarimPlus.category,
  });
}

// שורות הקובץ הן "key=value", key = phone-processor-mosad-last4
function parseTokensFile(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const eq = line.indexOf('=');
      if (eq === -1) return null;
      const key = line.slice(0, eq);
      const value = line.slice(eq + 1);
      const [phone, processor, mosad, last4] = key.split('-');
      return { raw: line, key, value, phone, processor, mosad, last4 };
    })
    .filter(Boolean);
}

function serializeTokensFile(lines) {
  return lines.map((l) => `${l.key}=${l.value}`).join('\n');
}

// מוודא שלכל מספרי הטלפון של הלקוח יש שורת טוקן זהה (אם קיים טוקן
// תחת מספר אחד שלו לפחות), כדי שימות המשיח יזהה כרטיס שמור גם אם
// הלקוח מתקשר הפעם ממספר אחר שלו.
async function syncTokenAcrossPhones(customerPhones) {
  if (!config.yemot.apiToken || !config.yemot.tokensFilePath) {
    console.warn('YEMOT_API_TOKEN / YEMOT_TOKENS_FILE_PATH לא מוגדרים - מדלג על סנכרון טוקן.');
    return;
  }
  let text;
  try {
    text = await yemotFiles.downloadTextFile(config.yemot.tokensFilePath);
  } catch (e) {
    if (String(e.message).includes('404')) return; // הקובץ עוד לא נוצר - אין טוקנים קיימים, זה תקין
    throw e;
  }
  const lines = parseTokensFile(text);
  const mosad = config.nedarimPlus.terminalNumber;

  const existing = lines.filter(
    (l) => l.processor === PROCESSOR && l.mosad === mosad && customerPhones.includes(l.phone)
  );
  if (existing.length === 0) return; // אין עדיין טוקן שמור לאף אחד ממספרי הלקוח

  const source = existing[0];
  let changed = false;
  for (const phone of customerPhones) {
    const already = lines.some(
      (l) => l.processor === PROCESSOR && l.mosad === mosad && l.phone === phone && l.last4 === source.last4
    );
    if (!already) {
      lines.push({
        key: `${phone}-${PROCESSOR}-${mosad}-${source.last4}`,
        value: source.value,
      });
      changed = true;
    }
  }

  if (changed) {
    await yemotFiles.uploadTextFile(config.yemot.tokensFilePath, serializeTokensFile(lines));
  }
}

// אוסף את כל הפרמטרים CreditCard_* שימות המשיח מחזיר בתום חיוב, ומנסה
// לזהות מתוכם את 4 הספרות האחרונות של הכרטיס (שם השדה המדויק לא היה
// מתועד - נבדוק כמה אפשרויות נפוצות; אפשר להוסיף עוד אם תגלה את השם הנכון)
function extractCreditCardInfo(params) {
  const raw = {};
  for (const key of Object.keys(params || {})) {
    if (key.startsWith('CreditCard_')) {
      const v = params[key];
      raw[key] = Array.isArray(v) ? v[v.length - 1] : v;
    }
  }
  const last4Candidates = [
    'CreditCard_4Digits', 'CreditCard_Last4', 'CreditCard_LastNum',
    'CreditCard_CardNum', 'CreditCard_Digits', 'CreditCard_Card',
  ];
  let last4 = null;
  for (const c of last4Candidates) {
    const v = raw[c];
    if (v && /\d{4}$/.test(String(v))) {
      last4 = String(v).slice(-4);
      break;
    }
  }
  return { raw, last4 };
}

// ימות המשיח מחזיר רק הצלחה/כישלון בחיוב טלפוני, לא את פרטי הכרטיס -
// שולפים את 4 הספרות האחרונות ישירות מדוח העסקאות של נדרים פלוס
// (מפתח API נפרד, ApiPassword, שונה מ-ApiValid ששימש לחיוב עצמו)
async function lookupLastNumFromHistory({ amount, withinMinutes = 5 }) {
  if (!config.nedarimPlus.apiPassword) return null;
  try {
    const body = new URLSearchParams({
      Action: 'GetHistoryJson',
      MosadId: config.nedarimPlus.terminalNumber,
      ApiPassword: config.nedarimPlus.apiPassword,
      MaxId: '20',
    });
    const res = await fetch('https://matara.pro/nedarimplus/Reports/Manage3.aspx', { method: 'POST', body });
    const rows = await res.json();
    if (!Array.isArray(rows)) return null;

    const now = Date.now();
    const match = rows.find((r) => {
      const amt = parseFloat(r.Amount);
      if (Number.isNaN(amt) || Math.abs(amt - amount) > 0.01) return false;
      const m = /(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/.exec(r.TransactionTime || '');
      if (!m) return true;
      const [, dd, MM, yyyy, HH, mm, ss] = m;
      const t = new Date(`${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}`).getTime();
      return Math.abs(now - t) <= withinMinutes * 60 * 1000;
    });
    return match ? match.LastNum : null;
  } catch (e) {
    console.error('lookupLastNumFromHistory failed', e.message);
    return null;
  }
}

module.exports = {
  buildChargeDirective,
  syncTokenAcrossPhones,
  parseTokensFile,
  serializeTokensFile,
  extractCreditCardInfo,
  lookupLastNumFromHistory,
};
