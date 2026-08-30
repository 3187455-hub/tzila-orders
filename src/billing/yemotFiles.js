// עטיפה ל-API הכללי של קבצים בימות המשיח (DownloadFile / UploadTextFile).
// מקור: תיעוד קהילתי בפורום freeivr.co.il - כדאי לאמת מול חשבון אמיתי.
const config = require('../config');

const BASE = 'https://www.call2all.co.il/ym/api';

async function downloadTextFile(filePath) {
  const url = `${BASE}/DownloadFile?token=${encodeURIComponent(config.yemot.apiToken)}&path=ivr2:${filePath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yemot DownloadFile failed: ${res.status}`);
  return res.text();
}

async function downloadBinaryFile(filePath) {
  const url = `${BASE}/DownloadFile?token=${encodeURIComponent(config.yemot.apiToken)}&path=ivr2:${filePath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yemot DownloadFile failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function uploadTextFile(filePath, contents) {
  const url = `${BASE}/UploadTextFile?token=${encodeURIComponent(config.yemot.apiToken)}&what=ivr2:${filePath}&contents=${encodeURIComponent(contents)}`;
  const res = await fetch(url);
  const body = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = { raw: body };
  }
  if (parsed.responseStatus && parsed.responseStatus !== 'OK') {
    throw new Error(`Yemot UploadTextFile failed: ${body}`);
  }
  return parsed;
}

module.exports = { downloadTextFile, downloadBinaryFile, uploadTextFile };
