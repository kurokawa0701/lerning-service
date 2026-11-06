/**
 * LPの資料請求・無料相談フォーム → スプレッドシート転記
 *
 * 使い方は README.md「7. フォーム（スプレッドシート連携）」を参照。
 * 転記先スプレッドシートの「拡張機能 > Apps Script」に、このファイルの中身を貼り付けて使う。
 * このファイルはLPと一緒に公開されても問題ない内容だが、サーバーには置かなくてよい。
 */

const SHEET_NAME = '問い合わせ';
// 新しい申し込みを通知するメールアドレス（複数はカンマ区切り）。不要なら空文字のまま
const NOTIFY_TO = '';

const HEADERS = ['受付日時', '種別', '会社名', 'お名前', 'メールアドレス', '電話番号', '検討人数', 'ご相談内容', '送信元ページ', '対応状況'];
const TYPE_LABEL = { doc: '資料請求', consult: '無料相談' };

// 受講者の記事（ZennのPublication）のRSS。LPの「受講者の記事」欄に新しい順で表示する
const FEED_URL = 'https://zenn.dev/p/ai_training_nbs/feed';
const FEED_LIMIT = 3;
// LPに載せない記事。記事URLに含まれる文字列（URLの末尾など）を書く
const FEED_EXCLUDE = ['covid-simulation'];
const FEED_CACHE_SEC = 3 * 60 * 60; // 3時間キャッシュ（新しい記事は最大3時間後に反映）

function doPost(e) {
  try {
    const p = (e && e.parameter) || {};

    // スパム対策：人には見えない欄に入力があれば、保存せずに成功を返す
    if (p.website) return json_({ ok: true });

    const type = TYPE_LABEL[p.type] ? p.type : '';
    const email = String(p.email || '').trim();
    if (!type) return json_({ ok: false, error: 'type' });
    if (!p.company || !p.name) return json_({ ok: false, error: 'required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json_({ ok: false, error: 'email' });
    if (type === 'consult' && (!p.tel || !p.headcount)) return json_({ ok: false, error: 'required' });

    const row = [
      new Date(),
      TYPE_LABEL[type],
      cell_(p.company, 100),
      cell_(p.name, 50),
      cell_(email, 120),
      cell_(p.tel, 20),
      cell_(p.headcount, 20),
      cell_(p.message, 1000),
      cell_(p.page, 300),
      '未対応',
    ];

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      sheet_().appendRow(row);
    } finally {
      lock.releaseLock();
    }

    if (NOTIFY_TO) {
      MailApp.sendEmail({
        to: NOTIFY_TO,
        subject: '【LP】' + row[1] + '：' + row[2] + ' ' + row[3] + '様',
        body: HEADERS.slice(0, 9).map((h, i) => h + '：' + row[i]).join('\n') +
          '\n\nスプレッドシート：' + SpreadsheetApp.getActiveSpreadsheet().getUrl(),
      });
    }

    return json_({ ok: true });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server' });
  }
}

/** GET ?feed=zenn：ZennのRSSを読み、記事一覧をJSONで返す（ブラウザから直接RSSは読めないため中継する） */
function doGet(e) {
  if (!e || !e.parameter || e.parameter.feed !== 'zenn') return json_({ ok: false, error: 'not_found' });
  const cache = CacheService.getScriptCache();
  const hit = cache.get('zenn');
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  try {
    const out = JSON.stringify({ ok: true, items: zennItems_() });
    cache.put('zenn', out, FEED_CACHE_SEC);
    return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'feed' });
  }
}

function zennItems_() {
  const res = UrlFetchApp.fetch(FEED_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('feed ' + res.getResponseCode());
  const channel = XmlService.parse(res.getContentText()).getRootElement().getChild('channel');
  const dc = XmlService.getNamespace('dc', 'http://purl.org/dc/elements/1.1/');
  return channel.getChildren('item').map(function (it) {
    const enc = it.getChild('enclosure');
    return {
      title: it.getChildText('title') || '',
      url: it.getChildText('link') || '',
      date: new Date(it.getChildText('pubDate')).toISOString(),
      author: it.getChildText('creator', dc) || '',
      image: enc && enc.getAttribute('url') ? enc.getAttribute('url').getValue() : '',
    };
  }).filter(function (a) {
    return /^https:\/\/zenn\.dev\//.test(a.url) && !FEED_EXCLUDE.some(function (x) { return a.url.indexOf(x) >= 0; });
  }).slice(0, FEED_LIMIT);
}

/** 転記先シート。なければ見出し付きで作る */
function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sh;
}

/** 文字数を制限し、=・+・-・@ で始まる値は数式として実行されないよう ' を付ける */
function cell_(v, max) {
  const s = String(v || '').trim().slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 動作確認用：記事一覧を取得してログに出す（初回実行時に外部への接続の許可を求められる） */
function testFeed() {
  console.log(JSON.stringify(zennItems_(), null, 2));
}

/** 動作確認用：Apps Script エディタでこの関数を実行すると、テスト行が1行追加される */
function testAppend() {
  const res = doPost({ parameter: { type: 'consult', company: 'テスト株式会社', name: 'テスト太郎', email: 'test@example.com', tel: '03-0000-0000', headcount: '1名', message: '動作確認', page: 'test' } });
  console.log(res.getContent());
}
