// ==========================================================
// ヘッダーのお写真・メッセージ・印字氏名（2026-09-23 saito）
// 画面見本 https://claude.ai/artifact/3H5DLSUba2J4ZtJCL4nMVj （v12）を写したもの。受け取りは CRM の crm/hearing_extras.js
//   ・3項目それぞれ「まだ決まっていない」で保留できる
//   ・同じURLを開き直すと前回の回答を表示（FD.prev）。保留・未回答の項目だけ入力欄を開く。回答済みは「修正する」
//   ・写真の比率は決めない（縦長もある・saito 2026-09-23）。長い辺2,400pxに縮めて送る
//   ・メッセージ＝カードのメッセージと同じ。500字（改行を除く）・1行20字（空白も数える）・絵文字不可
// index.html の init / renderGroups / submitForm / renderConfirm から呼ばれる
// ==========================================================
var HX_LABELS = ['A','B','C','D','E'];
var HX_MAX_SIDE = 2400, HX_MAX_TOTAL = 500, HX_MAX_LINE = 20;
var HX_PUNCT = /[、。，．,.]/g;
var HX_EMOJI_RE = '[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{FE0F}\\u{200D}]';
function hxHasEmoji(t) { return new RegExp(HX_EMOJI_RE, 'u').test(t); }
function hxStripEmoji(t) { return t.replace(new RegExp(HX_EMOJI_RE, 'gu'), ''); }
var HX_TPL_COUNT = 7;   // hearing/tpl/1〜7.jpg（共有ドライブ 01_CS/01_yui/03_LINE@/ヘッダー/テンプレ を縮めたもの）
// 文例（saito 2026-09-22 の原文のまま）
var HX_TEMPLATES = [
  { name: '定番', text: '私達の結婚を祝っていただき\nありがとうございます\nささやかではありますがお礼のお品を\n贈らせていただきます\nこれからも私達二人を\n宜しくお願いいたします' },
  { name: 'サンプル①', text: '本日はお忙しい中\nご出席いただきありがとうございました\nささやかではございますが\n記念品を用意させていただきました\nこれからも変わらぬお付き合いのほど\nどうぞよろしくお願いいたします' },
  { name: 'サンプル②', text: '今日は遠くから来てくれて本当にありがとう\nささやかですが記念品を用意したので\nぜひ受け取ってください\nこれからもずっと仲良くしてね' },
  { name: 'サンプル③', text: '本日はご列席いただきありがとうございます\n引き出物はお荷物にならないよう\nギフトカードタイプにいたしました\nご注文いただいたお品物は\nご自宅にお届けいたします\n今後とも末永く よろしくお願いいたします' },
  { name: 'サンプル④', text: '本日はお忙しい中\n私どものためにご列席賜り\n誠にありがとうございました\n皆様からの暖かいお祝詞をはじめ\n過分なお心配りをいただき \n深く感謝致しております\n\nささやかではございますが\n感謝のしるしとご挨拶を兼ね\n心ばかりの品をお贈りさせていただきます\nお好きな商品をお選びいただきたく\nこのような形式にさせていただきました\nご笑納くだされば幸いです\n\n何分にも未熟な二人ではございますが\n今後ともよろしくご指導下さいますよう\nお願い申し上げます' },
  { name: 'サンプル⑤', text: '私たちの結婚をお祝いいただき\n本当にありがとうございました\nふたりで仲良く歩んでいきたいと思います\nこれからもあたたかく見守ってください\n\n新郎名・新婦名' },
  { name: '自由に書く', text: '' }
];
// 引き菓子・縁起物をつけない贈り分けに添えるのがおすすめの一文
var HX_NO_SWEETS_NOTE = '※ 記念品  引菓子  縁起物の\n3品分を1つにまとめた\nグレードアップ商品でございます\nお好きなものをお一つお選びください';

// mode: 'input'（入力する）| 'done'（前回の回答を表示・送り直さない）
var HX = {
  existingEdited: true,   // 2回目で「修正する」を押すまでは false（今ある項目は前回のまま送る）
  photo:   { mode: 'input', split: false, cur: 'all', slots: {} },   // slots[key] = { source:'upload'|'tpl'|'keep', b64, mime, name, preview, size, tpl, from }
  message: { mode: 'input', split: false, cur: 'all', texts: {}, picked: {} },
  names:   { mode: 'input' }
};
var hx$ = function (id) { return document.getElementById(id); };
var hxLen = function (s) { return Array.from(s).length; };
function hxKeyLabel(k) { return k === 'all' ? '全員' : '贈り分け' + k; }
function hxGroupCount() { return parseInt(hx$('f-groupCount').value) || 1; }
function hxKeys(item) { return HX[item].split ? HX_LABELS.slice(0, hxGroupCount()) : ['all']; }

// ---------- 初期化（init の最後から） ----------
function hxInit() {
  var prev = FD.prev;
  HX.message.texts.all = HX_TEMPLATES[0].text; HX.message.picked.all = 0;
  if (prev) hxPrefillExisting(prev);
  if (prev) {
    HX.existingEdited = false;
    hx$('existing-block').classList.add('hidden');
    hx$('f-notes-card').classList.add('hidden');
    hx$('prev-card').classList.remove('hidden');
    hx$('prev-list').textContent = hxPrevSummary(prev);
    hx$('f-sub').textContent = 'まだ決まっていなかった項目をお答えください';
    var ex = prev.extras || {};
    ['photo', 'message', 'names'].forEach(function (k) {
      var x = ex[k];
      if (x && x.state === 'answered') { hxLoadAnswer(k, x); hxShowDone(k); }
      // 保留・未回答は入力欄を開いたまま（チェックは外した状態から。また保留にもできる）
    });
  }
  hxSetSplitButtons('photo'); hxSetSplitButtons('message');
  hxRenderTabs('photo'); hxShowPhotoSlot();
  hxRenderTabs('message'); hx$('hx-msg').value = HX.message.texts[HX.message.cur] || ''; hxRenderTemplates(); hxCheck();
  hxRenderNames();
  var ta = hx$('hx-msg');
  ta.addEventListener('input', function (e) {
    if (!e.isComposing) hxEnforceLimits();
    HX.message.picked[HX.message.cur] = -1; hxRenderTemplates(); hxCheck();
  });
  ta.addEventListener('compositionend', function () { hxEnforceLimits(); hxCheck(); });
}

// 贈り分けの数が変わったら、タブを作り直す（renderGroups から呼ぶ）
function hxOnGroupsChanged() {
  if (!FD || !hx$('hx-msg')) return;
  ['photo', 'message'].forEach(function (k) {
    var keys = hxKeys(k);
    if (keys.indexOf(HX[k].cur) < 0) HX[k].cur = keys[0];
    if (k === 'photo') keys.forEach(function (g) { if (HX.photo.split && !HX.photo.slots[g] && HX.photo.slots.all) HX.photo.slots[g] = hxCopySlot(HX.photo.slots.all, 'all'); });
    if (k === 'message') keys.forEach(function (g) { if (HX.message.texts[g] === undefined) { HX.message.texts[g] = HX.message.texts.all || ''; HX.message.picked[g] = HX.message.picked.all; } });
    hxRenderTabs(k);
  });
  hxShowPhotoSlot();
  hx$('hx-msg').value = HX.message.texts[HX.message.cur] || '';
  hxRenderTemplates(); hxCheck(); hxRenderNames();
}

// ---------- まだ決まっていない ----------
function hxApplyPending(k) {
  var sec = document.querySelector('[data-item=' + k + ']');
  var on = hx$('pend-' + k).checked;
  sec.querySelector('.hx-body').classList.toggle('hidden', on);
  sec.querySelector('.pending-note').classList.toggle('hidden', !on);
}

// ---------- 全員同じ／贈り分けごと ----------
function hxSetSplit(k, on) {
  var st = HX[k];
  if (st.split === on) return;
  var wasKey = st.cur;
  st.split = on;
  hxSetSplitButtons(k);
  // 分けたときは、入っていたものを全部の贈り分けに入れておく（あとで差し替えられる）
  if (on) HX_LABELS.slice(0, hxGroupCount()).forEach(function (g) {
    if (k === 'photo' && !st.slots[g] && st.slots.all) st.slots[g] = hxCopySlot(st.slots.all, 'all');
    if (k === 'message' && st.texts[g] === undefined) { st.texts[g] = st.texts.all || ''; st.picked[g] = st.picked.all; }
  });
  // 1つにまとめたときは、いま開いていた贈り分けの内容を全員分にする
  if (!on && k === 'photo' && st.slots[wasKey]) st.slots.all = hxCopySlot(st.slots[wasKey], wasKey);
  if (!on && k === 'message' && wasKey !== 'all') { st.texts.all = st.texts[wasKey] || ''; st.picked.all = st.picked[wasKey]; }
  st.cur = on ? 'A' : 'all';
  hxRenderTabs(k);
  if (k === 'photo') hxShowPhotoSlot();
  else { hx$('hx-msg').value = st.texts[st.cur] || ''; hxRenderTemplates(); hxCheck(); }
}
function hxSetSplitButtons(k) {
  var on = HX[k].split;
  document.querySelectorAll('#' + (k === 'photo' ? 'hx-psplit' : 'hx-msplit') + ' .chip').forEach(function (b) {
    b.setAttribute('aria-pressed', String((b.getAttribute('data-split') === '1') === on));
  });
}
function hxCopySlot(s, fromKey) {
  var c = {}; for (var p in s) c[p] = s[p];
  if (c.source === 'keep') c.from = c.from || fromKey;
  return c;
}
function hxRenderTabs(k) {
  var st = HX[k], box = hx$(k === 'photo' ? 'hx-ptabs' : 'hx-mtabs');
  box.classList.toggle('hidden', !st.split); box.innerHTML = '';
  if (!st.split) return;
  hxKeys(k).forEach(function (g) {
    var t = document.createElement('button');
    t.type = 'button'; t.className = 'tab'; t.setAttribute('role', 'tab');
    var done = k === 'photo' ? !!st.slots[g] : !!(st.texts[g] || '').trim();
    t.textContent = '贈り分け' + g + (done ? '・済' : '');
    t.setAttribute('aria-selected', String(st.cur === g));
    t.addEventListener('click', function () {
      st.cur = g; hxRenderTabs(k);
      if (k === 'photo') hxShowPhotoSlot();
      else { hx$('hx-msg').value = st.texts[g] || ''; hxRenderTemplates(); hxCheck(); }
    });
    box.appendChild(t);
  });
}

// ---------- 写真 ----------
// 「送る／テンプレ」を切り替えただけでは選んだものを消さない（戻せば前のものが出る）
function hxSetSource(kind) {
  var st = HX.photo, cur = st.slots[st.cur];
  st.view = st.view || {}; st.stash = st.stash || {};
  st.view[st.cur] = kind;
  if (cur && (cur.source === 'tpl') !== (kind === 'tpl')) {
    var other = st.stash[st.cur];
    st.stash[st.cur] = cur;
    if (other && (other.source === 'tpl') === (kind === 'tpl')) st.slots[st.cur] = other; else delete st.slots[st.cur];
  } else if (!cur && st.stash[st.cur] && (st.stash[st.cur].source === 'tpl') === (kind === 'tpl')) {
    st.slots[st.cur] = st.stash[st.cur]; delete st.stash[st.cur];
  }
  hxShowPhotoSlot(); hxRenderTabs('photo');
}
function hxShowPhotoSlot() {
  var st = HX.photo, slot = st.slots[st.cur];
  var kind = (st.view && st.view[st.cur]) || (slot && slot.source === 'tpl' ? 'tpl' : 'upload');
  hx$('hx-src-upload').setAttribute('aria-pressed', String(kind === 'upload'));
  hx$('hx-src-tpl').setAttribute('aria-pressed', String(kind === 'tpl'));
  hx$('hx-upload-area').classList.toggle('hidden', kind !== 'upload');
  hx$('hx-tpl-area').classList.toggle('hidden', kind !== 'tpl');
  hxRenderTplGrid();
  var up = !!slot && slot.source !== 'tpl';
  hx$('hx-drop').classList.toggle('hidden', up);
  hx$('hx-photo-view').classList.toggle('hidden', !up);
  if (up) {
    if (slot.preview) hx$('hx-photo-img').src = slot.preview; else hx$('hx-photo-img').removeAttribute('src');
    hx$('hx-photo-img').classList.toggle('hidden', !slot.preview);
    hx$('hx-photo-size').textContent = slot.size || '';
  }
}
function hxRenderTplGrid() {
  var st = HX.photo, box = hx$('hx-tpl-grid'); box.innerHTML = '';
  var slot = st.slots[st.cur];
  for (var i = 1; i <= HX_TPL_COUNT; i++) (function (n) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'tpl';
    b.setAttribute('aria-pressed', String(!!slot && slot.source === 'tpl' && slot.tpl === n));
    b.setAttribute('aria-label', 'テンプレ画像' + n);
    var im = document.createElement('img'); im.src = 'tpl/' + n + '.jpg'; im.alt = ''; im.loading = 'lazy'; b.appendChild(im);
    b.addEventListener('click', function () { st.slots[st.cur] = { source: 'tpl', tpl: n }; hxRenderTplGrid(); hxRenderTabs('photo'); });
    box.appendChild(b);
  })(i);
}
function hxMb(n) { return (n / 1048576).toFixed(1) + 'MB'; }
function hxOnPhoto(input) {
  var f = input.files && input.files[0]; if (!f) return;
  var st = HX.photo, key = st.cur;
  var url = URL.createObjectURL(f);
  var img = new Image();
  img.onload = function () {
    // 比率はそのまま（縦長もある）。長い辺だけ2,400pxに。透過PNGは白地に
    var w = img.naturalWidth, h = img.naturalHeight, r = Math.min(1, HX_MAX_SIDE / Math.max(w, h));
    var c = document.createElement('canvas'); c.width = Math.round(w * r); c.height = Math.round(h * r);
    var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    var data = c.toDataURL('image/jpeg', 0.88);
    var b64 = data.split(',')[1], bytes = Math.round(b64.length * 3 / 4);
    st.slots[key] = { source: 'upload', b64: b64, mime: 'image/jpeg', name: (f.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', preview: data,
      size: '元のお写真 ' + w.toLocaleString() + '×' + h.toLocaleString() + 'px・' + hxMb(f.size) + '　→　送る大きさ ' + c.width.toLocaleString() + '×' + c.height.toLocaleString() + 'px・' + hxMb(bytes) };
    URL.revokeObjectURL(url);
    hxRenderTabs('photo'); hxShowPhotoSlot();
  };
  img.onerror = function () {
    // この画面で読めない形式（パソコンで開いたHEICなど）は元のまま送る。15MBを超えるときだけ止める
    URL.revokeObjectURL(url);
    if (f.size > 15 * 1024 * 1024) { alert('このお写真は大きすぎるため送れません（' + hxMb(f.size) + '）。別のお写真をお選びください。'); input.value = ''; return; }
    var rd = new FileReader();
    rd.onload = function () {
      st.slots[key] = { source: 'upload', b64: String(rd.result).split(',')[1], mime: /^image\//.test(f.type) ? f.type : 'image/heic', name: f.name || 'photo', preview: '',
        size: 'この形式はこの画面では表示・縮小できません（' + (f.name || '') + '・' + hxMb(f.size) + '）。元のまま送ります' };
      hxRenderTabs('photo'); hxShowPhotoSlot();
    };
    rd.readAsDataURL(f);
  };
  img.src = url;
}

// ---------- メッセージ ----------
function hxRenderTemplates() {
  var st = HX.message, box = hx$('hx-templates'); box.innerHTML = '';
  HX_TEMPLATES.forEach(function (t, i) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = t.name;
    b.setAttribute('aria-pressed', String(st.picked[st.cur] === i));
    b.addEventListener('click', function () {
      // 別の文例を押したら、編集していた内容は捨てて文例のままに戻す（saito 2026-09-22）
      st.picked[st.cur] = i;
      hx$('hx-msg').value = hxFillNames(t.text);
      hxEnforceLimits(); st.texts[st.cur] = hx$('hx-msg').value;
      hxRenderTemplates(); hxCheck();
    });
    box.appendChild(b);
  });
}
// サンプル⑤の「新郎名・新婦名」は、下で入れたお名前に置き換える（未入力ならそのまま）
function hxFillNames(text) {
  var a = hx$('p1-first').value.trim(), b = hx$('p2-first').value.trim();
  return a && b ? text.replace('新郎名・新婦名', a + '・' + b) : text;
}
// 20文字を超えた分は次の行へ送る（消さない）。500文字（改行を除く）を超えた分は受け付けない。
// 日本語の変換中は触らない。カーソルは「改行を除いて何文字目か」で戻す
function hxEnforceLimits() {
  var ta = hx$('hx-msg');
  var before = ta.value, caret = ta.selectionStart;
  var charsBefore = hxLen(before.slice(0, caret).replace(/\n/g, ''));
  var out = [], total = 0;
  before.split('\n').forEach(function (line) {
    var chars = Array.from(line);
    if (total >= HX_MAX_TOTAL) chars = [];
    else if (total + chars.length > HX_MAX_TOTAL) chars = chars.slice(0, HX_MAX_TOTAL - total);
    total += chars.length;
    do { out.push(chars.splice(0, HX_MAX_LINE).join('')); } while (chars.length);
  });
  var after = out.join('\n');
  if (after === before) return;
  ta.value = after;
  var arr = Array.from(after), pos = 0, seen = 0, col = 0;
  while (pos < arr.length && seen < charsBefore) {
    if (arr[pos] === '\n') col = 0; else { seen++; col++; }
    pos++;
  }
  if (arr[pos] === '\n' && col === HX_MAX_LINE) pos++;
  var cu = arr.slice(0, pos).join('').length;
  if (document.activeElement === ta) ta.setSelectionRange(cu, cu);
}
function hxCheck() {
  var st = HX.message, text = hx$('hx-msg').value;
  st.texts[st.cur] = text;
  var lines = text.split('\n');
  var total = hxLen(text.replace(/\n/g, ''));
  var longLines = [];
  lines.forEach(function (l, i) { var n = hxLen(l); if (n > HX_MAX_LINE) longLines.push({ no: i + 1, n: n }); });
  hx$('hx-meter-lines').textContent = lines.length + '行';
  hx$('hx-meter-total').textContent = total + ' / ' + HX_MAX_TOTAL + '文字（改行は数えません）';
  var out = [];
  if (longLines.length) out.push({ cls: 'ng', text: longLines.map(function (x) { return x.no + '行目が' + x.n + '文字'; }).join('、') + 'です', action: '20文字で改行する', fn: function () { hxEnforceLimits(); hxCheck(); } });
  var p = text.match(HX_PUNCT);
  if (p) out.push({ cls: 'warn', text: '句読点が' + p.length + 'か所あります', action: '空白に置き換える', fn: hxFixPunct });
  if (hxHasEmoji(text)) out.push({ cls: 'ng', text: '絵文字は使えません（環境によって文字化けします）', action: '取り除く', fn: function () { hx$('hx-msg').value = hxStripEmoji(hx$('hx-msg').value); hxCheck(); } });
  if (total >= HX_MAX_TOTAL) out.push({ cls: 'warn', text: '500文字に達しました' });
  if (!out.length && text.trim()) out.push({ cls: 'okay', text: 'このままお使いいただけます' });
  var box = hx$('hx-issues'); box.innerHTML = '';
  out.forEach(function (o) {
    var d = document.createElement('div'); d.className = 'issue ' + o.cls;
    var s = document.createElement('span'); s.textContent = o.text; d.appendChild(s);
    if (o.action) { var b = document.createElement('button'); b.type = 'button'; b.className = 'sbtn'; b.textContent = o.action; b.addEventListener('click', o.fn); d.appendChild(b); }
    box.appendChild(d);
  });
  var pv = hx$('hx-msg-preview'); pv.innerHTML = '';
  var cap = document.createElement('span'); cap.className = 'cap';
  cap.textContent = 'カタログでの見え方（イメージ）' + (st.split ? '：贈り分け' + st.cur : '');
  pv.appendChild(cap);
  lines.forEach(function (l, i) {
    var s = document.createElement('span'); s.textContent = l || '　';
    if (hxLen(l) > HX_MAX_LINE) s.className = 'over';
    pv.appendChild(s);
    if (i < lines.length - 1) pv.appendChild(document.createTextNode('\n'));
  });
  hxRenderSuggest();
  if (st.split) hxRenderTabs('message');
}
function hxFixPunct() {
  hx$('hx-msg').value = hx$('hx-msg').value.split('\n').map(function (l) { return l.replace(/[。．.]\s*$/, '').replace(HX_PUNCT, ' ').replace(/ {2,}/g, ' ').replace(/\s+$/, ''); }).join('\n');
  hxCheck();
}
// 引き菓子・縁起物をどちらもつけない贈り分け（今の入力欄から。2回目で直していなければ前回の回答から）
function hxNoSweetsGroups() {
  var gs = (!HX.existingEdited && FD.prev) ? (FD.prev.groups || []) : null;
  var n = gs ? gs.length : hxGroupCount(), out = [];
  for (var g = 0; g < n; g++) {
    var sw = gs ? gs[g] : readSweets(g);
    var want = sw.sweetWant === '希望' || sw.engiWant === '希望';
    var said = sw.sweetWant === '不要' || sw.engiWant === '不要';
    if (!want && said) out.push(HX_LABELS[g]);
  }
  return out;
}
function hxRenderSuggest() {
  var st = HX.message, box = hx$('hx-suggest');
  var none = hxNoSweetsGroups();
  var show = st.split ? none.indexOf(st.cur) >= 0 : none.length > 0;
  var already = hx$('hx-msg').value.indexOf('グレードアップ商品でございます') >= 0;
  box.classList.toggle('hidden', !show || already);
  if (!show || already) return;
  box.innerHTML = '';
  var p = document.createElement('div');
  p.textContent = '引き菓子・縁起物をつけない場合は、次の一文を添えるのがおすすめです';
  var pre = document.createElement('pre'); pre.textContent = HX_NO_SWEETS_NOTE;
  var b = document.createElement('button'); b.type = 'button'; b.className = 'sbtn solid'; b.textContent = 'この一文を添える';
  b.addEventListener('click', function () {
    hx$('hx-msg').value = hx$('hx-msg').value.replace(/\s+$/, '') + '\n\n' + HX_NO_SWEETS_NOTE;
    hxEnforceLimits(); hxCheck();
  });
  box.appendChild(p); box.appendChild(pre); box.appendChild(b);
}

// ---------- 印字氏名 ----------
function hxPerson(n) {
  return { last: hx$(n + '-last').value.trim(), first: hx$(n + '-first').value.trim(), maiden: hx$(n + '-maiden').value.trim() };
}
function hxPersonText(p) {
  var base = [p.last, p.first].filter(Boolean).join(' ');
  return base ? base + (p.maiden ? '（旧姓：' + p.maiden + '）' : '') : '';
}
// カードの色は選んだデザイン（和風＝赤／洋風＝カーキと薄いグレーの間）
function hxCardDesign() {
  if (FD.originalCard) return FD.originalCard.indexOf('和風') >= 0 ? '和風' : '洋風';
  if (!HX.existingEdited && FD.prev && FD.prev.groups && FD.prev.groups[0]) return FD.prev.groups[0].design || '和風';
  return (document.querySelector('input[name=design]:checked') || {}).value || '和風';
}
function hxRenderNames() {
  var box = hx$('hx-print-preview'); if (!box) return;
  box.innerHTML = '';
  var cap = document.createElement('span'); cap.className = 'cap'; cap.textContent = 'カードに印字したときのイメージ';
  box.appendChild(cap);
  var card = document.createElement('div'); card.className = 'gcard' + (hxCardDesign() === '洋風' ? ' yofu' : '');
  var face = document.createElement('div'); face.className = 'gcard-face';
  var msg = document.createElement('div'); msg.className = 'gcard-msg';
  msg.textContent = '私達の結婚を祝っていただきありがとうございます\nささやかではありますが お礼の品として\nお選びいただいたものをご自宅にお届けいたします\n今後とも末永くよろしくお願いします';
  var names = document.createElement('div'); names.className = 'gcard-names';
  [['p1', '新郎', '太郎'], ['p2', '新婦', '花子']].forEach(function (x) {
    var p = hxPerson(x[0]), any = p.last || p.first;
    // 未入力のあいだは実物のカードと同じ例（新郎 太郎／新婦 花子）を出す
    var ln = any ? p.last : x[1], fn = any ? p.first : x[2];
    var line = document.createElement('div');
    // 姓と名の間は半角スペース（saito 2026-09-23）
    line.appendChild(document.createTextNode([ln, fn].filter(Boolean).join(' ')));
    if (p.maiden) { var m = document.createElement('span'); m.className = 'maiden'; m.textContent = '（旧姓：' + p.maiden + '）'; line.appendChild(m); }
    names.appendChild(line);
  });
  face.appendChild(msg); face.appendChild(names);
  card.appendChild(face); box.appendChild(card);
  var note = document.createElement('span'); note.className = 'gcard-note';
  note.textContent = 'メッセージは見本です。お名前の部分だけ、入力に合わせて変わります（QRコード・URL・有効期限は省いています）';
  box.appendChild(note);
  // サンプル⑤を使っていればお名前を差し込み直す
  var st = HX.message;
  Object.keys(st.texts).forEach(function (k) { if ((st.texts[k] || '').indexOf('新郎名・新婦名') >= 0) st.texts[k] = hxFillNames(st.texts[k]); });
  if (hx$('hx-msg').value !== (st.texts[st.cur] || '')) { hx$('hx-msg').value = st.texts[st.cur] || ''; hxCheck(); }
}

// ---------- 2回目：前回の回答 ----------
function hxPrevSummary(prev) {
  var prodName = function (id) {
    var p = (FD.products || []).find(function (x) { return x['商品ID'] === id; });
    return p ? p['商品名'] : (id || '');
  };
  var delivLabel = function (v) { var d = (typeof SWEET_DELIVERY !== 'undefined' ? SWEET_DELIVERY : []).find(function (x) { return x.value === v; }); return d ? d.label : (v || ''); };
  var L = [];
  if (prev.kikkake && !FD.isPartner) L.push('きっかけ：' + prev.kikkake);
  if (prev.venue && !FD.isPartner) L.push('式場・会場名：' + prev.venue);
  if (prev.venueStaff) L.push('ご担当者様：' + prev.venueStaff);
  var d = prev.delivery || {};
  var dv = [d.date ? d.date.replace(/-/g, '/') : '', d.time, d.place].filter(Boolean).join(' ');
  if (dv) L.push('納品：' + dv);
  (prev.groups || []).forEach(function (g, i) {
    var sw = function (want, id, del) { return want === '希望' ? prodName(id) + '（' + delivLabel(del) + '）' : want === '不要' ? '不要' : ''; };
    var parts = [(g.targets || []).join('、'), prodName(g.rank), g.catalogType, g.qty ? g.qty + '冊' : '',
      g.sweetWant ? '引き菓子 ' + sw(g.sweetWant, g.sweetId, g.sweetDelivery) : '', g.engiWant ? '縁起物 ' + sw(g.engiWant, g.engiId, g.engiDelivery) : '',
      [g.design, g.pattern].filter(Boolean).join('・')].filter(Boolean);
    L.push('贈り分け' + HX_LABELS[i] + '：' + parts.join('　'));
  });
  L.push('ご要望：' + (prev.notes || '（記入なし）'));
  return L.join('\n');
}
// 今ある項目の入力欄に前回の回答を入れておく（「修正する」で開いたとき、その続きから直せるように）。
// ⚠️ 戻しきれなくても害は無い：「修正する」を押さない限り、サーバーは前回の回答をそのまま使う（existingEdited:false）
function hxPrefillExisting(prev) {
  try {
    var q = function (v) { return String(v).replace(/["\\]/g, '\\$&'); };
    var setRadio = function (name, v) { var el = v && document.querySelector('input[name="' + name + '"][value="' + q(v) + '"]'); if (el) el.checked = true; return !!el; };
    var n = Math.max(1, Math.min(5, (prev.groups || []).length || 1));
    hx$('f-groupCount').value = String(n); renderGroups();
    if (prev.kikkake) setRadio('kikkake', prev.kikkake);
    hx$('f-venue').value = prev.venue || ''; hx$('f-staff').value = prev.venueStaff || '';
    var d = prev.delivery || {};
    hx$('f-delivDate').value = d.date || ''; hx$('f-delivTime').value = d.time || ''; hx$('f-delivPlace').value = d.place || '';
    hx$('f-notes').value = prev.notes || '';
    var design = ((prev.groups || [])[0] || {}).design;
    if (!FD.originalCard && design && setRadio('design', design)) renderPatternChoices(design);
    (prev.groups || []).slice(0, 5).forEach(function (g, i) {
      (g.targets || []).forEach(function (t) { setCheck('target_' + i, t); });
      if (setRadio('rank_' + i, g.rank)) onRankChange(i);
      if (setRadio('cattype_' + i, g.catalogType)) onCatTypeChange(i);
      hx$('qty_' + i).value = g.qty || '';
      if (isSweetSet()) setRadio('sw_set_' + i, (g.sweetWant === '希望' || g.engiWant === '希望') ? '希望' : (g.sweetWant || g.engiWant));
      else { setRadio('sw_sweet_' + i, g.sweetWant); setRadio('sw_engi_' + i, g.engiWant); }
      onSweetChange(i);
      if (setRadio('swp_sweet_' + i, g.sweetId)) onSweetChange(i);
      if (setRadio('swp_engi_' + i, g.engiId)) onSweetChange(i);
      setRadio('swt_sweet_' + i, g.sweetDelivery); setRadio('swt_engi_' + i, g.engiDelivery);
      setRadio('pattern_' + i, g.pattern);
    });
    updatePatternAvail();
    function setCheck(name, v) { var el = document.querySelector('input[name="' + name + '"][value="' + q(v) + '"]'); if (el) el.checked = true; }
  } catch (e) { if (window.console) console.warn('[form] 前回の回答を入力欄に戻せませんでした', e); }
}
function openExistingEdit() {
  HX.existingEdited = true;
  hx$('prev-card').classList.add('hidden');
  hx$('existing-block').classList.remove('hidden');
  hx$('f-notes-card').classList.remove('hidden');
  hxOnGroupsChanged();
}
// 前回の回答を入力欄の状態に戻す（「修正する」を押したとき用）
function hxLoadAnswer(k, x) {
  if (k === 'photo') {
    HX.photo.split = !!x.split; HX.photo.cur = x.split ? 'A' : 'all'; HX.photo.slots = {};
    (x.items || []).forEach(function (i) {
      HX.photo.slots[i.key] = i.source === 'tpl' ? { source: 'tpl', tpl: i.tpl }
        : { source: 'keep', from: i.key, preview: '', size: '前回送っていただいたお写真を使います（別のお写真にもできます）' };
    });
  } else if (k === 'message') {
    HX.message.split = !!x.split; HX.message.cur = x.split ? 'A' : 'all'; HX.message.texts = {}; HX.message.picked = {};
    (x.items || []).forEach(function (i) { HX.message.texts[i.key] = i.text; HX.message.picked[i.key] = -1; });
    if (HX.message.texts[HX.message.cur] === undefined) HX.message.texts[HX.message.cur] = '';
  } else {
    ['p1', 'p2'].forEach(function (n) { var p = x[n] || {}; hx$(n + '-last').value = p.last || ''; hx$(n + '-first').value = p.first || ''; hx$(n + '-maiden').value = p.maiden || ''; });
  }
}
function hxShowDone(k) {
  HX[k].mode = 'done';
  var sec = document.querySelector('[data-item=' + k + ']');
  sec.querySelector('.hx-body').classList.add('hidden');
  sec.querySelector('.pend').classList.add('hidden');
  sec.querySelector('.pending-note').classList.add('hidden');
  var x = FD.prev.extras[k];
  var d = document.createElement('div'); d.className = 'done-row';
  d.innerHTML = '<div class="done-head"><span>前回のご回答</span><b>回答済み</b></div>';
  var body = document.createElement('div'); body.className = 'done-body';
  if (k === 'photo') {
    body.textContent = (x.items || []).map(function (i) {
      return hxKeyLabel(i.key) + '：' + (i.source === 'tpl' ? 'テンプレ画像' + i.tpl : '送っていただいたお写真');
    }).join('\n');
  } else if (k === 'message') {
    (x.items || []).forEach(function (i) {
      if (x.split) { var l = document.createElement('span'); l.className = 'sub-label'; l.textContent = hxKeyLabel(i.key); body.appendChild(l); }
      var m = document.createElement('div'); m.className = 'msgtxt'; m.textContent = i.text; body.appendChild(m);
    });
  } else {
    body.textContent = 'お一人目：' + hxPersonText(x.p1 || {}) + '\nお二人目：' + hxPersonText(x.p2 || {});
  }
  d.appendChild(body);
  var fix = document.createElement('button'); fix.type = 'button'; fix.className = 'sbtn'; fix.textContent = '修正する';
  fix.addEventListener('click', function () {
    HX[k].mode = 'input';
    d.remove();
    sec.querySelector('.pend').classList.remove('hidden');
    hxApplyPending(k);
    hxOnGroupsChanged();
  });
  d.appendChild(fix);
  sec.appendChild(d);
}

// ---------- 送る形・足りないもの ----------
function hxState(k) { return HX[k].mode === 'done' ? 'keep' : hx$('pend-' + k).checked ? 'pending' : 'answered'; }
function hxMissing() {
  var miss = [];
  if (hxState('photo') === 'answered') hxKeys('photo').forEach(function (k) {
    if (!HX.photo.slots[k]) miss.push('ヘッダーのお写真' + (k === 'all' ? '' : '（贈り分け' + k + '）') + '　※ 未定なら「まだ決まっていない」に');
  });
  if (hxState('message') === 'answered') hxKeys('message').forEach(function (k) {
    var t = HX.message.texts[k] || '', lbl = 'メッセージ' + (k === 'all' ? '' : '（贈り分け' + k + '）');
    if (!t.trim()) miss.push(lbl + '　※ 未定なら「まだ決まっていない」に');
    else if (t.split('\n').some(function (l) { return hxLen(l) > HX_MAX_LINE; })) miss.push(lbl + '：1行20文字を超えている行があります');
    else if (hxLen(t.replace(/\n/g, '')) > HX_MAX_TOTAL) miss.push(lbl + '：500文字を超えています');
    else if (hxHasEmoji(t)) miss.push(lbl + '：絵文字は使えません');
  });
  if (hxState('names') === 'answered' && (!hx$('p1-first').value.trim() || !hx$('p2-first').value.trim()))
    miss.push('カードに印字するお名前（名）　※ 未定なら「まだ決まっていない」に');
  return miss;
}
function hxPayload() {
  var out = {};
  ['photo', 'message', 'names'].forEach(function (k) {
    var st = hxState(k);
    if (st !== 'answered') { out[k] = { state: st }; return; }
    if (k === 'photo') out.photo = { state: st, split: HX.photo.split, items: hxKeys('photo').map(function (key) {
      var s = HX.photo.slots[key] || {};
      if (s.source === 'tpl') return { key: key, source: 'tpl', tpl: s.tpl };
      if (s.source === 'keep') return { key: key, source: 'keep', from: s.from || key };
      return { key: key, source: 'upload', b64: s.b64, mime: s.mime, name: s.name };
    }) };
    if (k === 'message') out.message = { state: st, split: HX.message.split, items: hxKeys('message').map(function (key) {
      return { key: key, text: (HX.message.texts[key] || '').replace(/\s+$/, '') };
    }) };
    if (k === 'names') out.names = { state: st, p1: hxPerson('p1'), p2: hxPerson('p2') };
  });
  return out;
}
// 確認画面の行（row は renderConfirm の行を作る関数）
function hxConfirmHtml(extras, row) {
  var st = function (x) { return x.state === 'pending' ? 'まだ決まっていない' : '前回のご回答のまま'; };
  var h = '';
  var p = extras.photo;
  h += row('ヘッダーのお写真', p.state === 'answered' ? p.items.map(function (i) {
    return hxKeyLabel(i.key) + '：' + (i.source === 'tpl' ? 'テンプレ画像' + i.tpl : i.source === 'keep' ? '前回のお写真' : (i.name || 'お写真'));
  }).join('\n') : st(p));
  var m = extras.message;
  h += row('メッセージ', m.state === 'answered' ? m.items.map(function (i) { return (m.split ? '【' + hxKeyLabel(i.key) + '】\n' : '') + i.text; }).join('\n\n') : st(m));
  var n = extras.names;
  h += row('印字するお名前', n.state === 'answered' ? 'お一人目：' + hxPersonText(n.p1) + '\nお二人目：' + hxPersonText(n.p2) : st(n));
  return h;
}
