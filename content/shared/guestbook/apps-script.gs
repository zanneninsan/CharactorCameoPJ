const SHEET_NAME = 'シート1';

const DEFAULT_NAME = '満足教徒';
const DEFAULT_SCOPE = 'global';

const MAX_NAME_LENGTH = 24;
const MAX_MESSAGE_LENGTH = 80;
const MAX_DRAWING_LENGTH = 45000;

const RATE_LIMIT_SECONDS = 60;
const MAX_POSTS_PER_HOUR = 5;

const HEADERS = [
  'createdAt',
  'name',
  'message',
  'drawing',
  'scope',
  'clientToken',
  'pageUrl',
  'drawingMime',
  'drawingLength',
  'clientGuard',
  'status'
];

const NG_WORDS = [
  '死ね',
  '殺す',
  '消えろ',
  '自殺しろ',
  'casino',
  'viagra',
  'porn',
  'loan'
];

function getSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.getSheets()[0];
  ensureHeader_(sheet);
  return sheet;
}

function ensureHeader_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    return;
  }

  const firstCell = String(sheet.getRange(1, 1).getValue() || '');
  if (!firstCell) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    lock.tryLock(5000);

    const params = e.parameter || {};
    const sheet = getSheet_();

    const name = clamp_(params.name || DEFAULT_NAME, MAX_NAME_LENGTH) || DEFAULT_NAME;
    const message = clamp_(params.message || '', MAX_MESSAGE_LENGTH);
    const drawing = normalizeDrawing_(params.drawing || '');
    const scope = clamp_(params.scope || DEFAULT_SCOPE, 80) || DEFAULT_SCOPE;
    const clientToken = clamp_(params.clientToken || 'anonymous', 120) || 'anonymous';
    const pageUrl = clamp_(params.pageUrl || '', 300);
    const clientGuard = clamp_(params.clientGuard || '', 80);
    const drawingMime = drawing ? drawing.slice(5, drawing.indexOf(';')) : '';
    const drawingLength = drawing ? String(drawing.length) : '0';

    if (!message && !drawing) {
      return json_({ ok: false, error: 'message or drawing is required' });
    }

    if (includesNgWord_(`${name} ${message}`)) {
      return json_({ ok: false, error: 'blocked words' });
    }

    if (looksLikeSpam_(message)) {
      return json_({ ok: false, error: 'spam-like message' });
    }

    const rateLimitError = checkRateLimit_(scope, clientToken);
    if (rateLimitError) {
      return json_({ ok: false, error: rateLimitError });
    }

    sheet.appendRow([
      new Date(),
      name,
      message,
      drawing,
      scope,
      clientToken,
      pageUrl,
      drawingMime,
      drawingLength,
      clientGuard,
      'public'
    ]);

    return json_({ ok: true });
  } catch (error) {
    return json_({ ok: false, error: String(error.message || error) });
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {}
  }
}

function doGet(e) {
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1);
  const requestedScope = String((e.parameter && e.parameter.scope) || '').trim();

  const entries = rows
    .filter(row => row[0] && (row[2] || row[3]))
    .filter(row => {
      const rowScope = String(row[4] || requestedScope || DEFAULT_SCOPE);
      return !requestedScope || rowScope === requestedScope;
    })
    .filter(row => {
      const status = String(row[10] || 'public');
      return status === 'public';
    })
    .slice(-50)
    .reverse()
    .map(row => ({
      date: formatDate_(row[0]),
      name: row[1] || DEFAULT_NAME,
      message: row[2] || '',
      drawing: row[3] || ''
    }));

  const payload = { ok: true, entries };
  const callback = e.parameter && e.parameter.callback;

  if (callback && isSafeCallback_(callback)) {
    return ContentService
      .createTextOutput(`${callback}(${JSON.stringify(payload)});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return json_(payload);
}

function normalizeDrawing_(value) {
  const drawing = String(value || '').trim();

  if (!drawing) {
    return '';
  }

  if (drawing.length > MAX_DRAWING_LENGTH) {
    throw new Error('drawing is too large');
  }

  if (!/^data:image\/(?:png|webp|jpeg);base64,[a-z0-9+/=]+$/i.test(drawing)) {
    throw new Error('invalid drawing');
  }

  return drawing;
}

function checkRateLimit_(scope, clientToken) {
  const cache = CacheService.getScriptCache();
  const keyBase = `guestbook:${scope}:${clientToken}`;
  const cooldownKey = `${keyBase}:cooldown`;
  const hourlyKey = `${keyBase}:hourly`;

  if (cache.get(cooldownKey)) {
    return 'rate limited';
  }

  const currentCount = Number(cache.get(hourlyKey) || '0');
  if (currentCount >= MAX_POSTS_PER_HOUR) {
    return 'hourly limit exceeded';
  }

  cache.put(cooldownKey, '1', RATE_LIMIT_SECONDS);
  cache.put(hourlyKey, String(currentCount + 1), 60 * 60);

  return '';
}

function includesNgWord_(value) {
  const normalized = normalizeForFilter_(value);
  return NG_WORDS.some(word => normalized.includes(normalizeForFilter_(word)));
}

function looksLikeSpam_(value) {
  const text = String(value || '');
  const normalized = normalizeForFilter_(text);

  if (/(https?:\/\/|www\.|discord\.gg|bit\.ly|t\.co|\.ru\b|\.cn\b)/i.test(text)) {
    return true;
  }

  if (/(.)\1{8,}/.test(normalized)) {
    return true;
  }

  const symbols = text.match(/[!！?？￥$€£#%*]/g) || [];
  return symbols.length >= 8;
}

function normalizeForFilter_(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　._\-ー〜~・!！?？"'“”‘’、。,.]/g, '');
}

function clamp_(value, maxLength) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function isSafeCallback_(callback) {
  return /^[A-Za-z_$][0-9A-Za-z_$]*(\.[A-Za-z_$][0-9A-Za-z_$]*)?$/.test(String(callback || ''));
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function formatDate_(value) {
  if (!value) return '';
  return Utilities.formatDate(new Date(value), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
}
