// Apps Script をウェブアプリとしてデプロイしたURL（https://script.google.com/macros/s/.../exec）。
// フォームの送信先（POST）と、受講者記事のRSS取得（GET ?feed=zenn）の両方に使う
const ENDPOINT='https://script.google.com/macros/s/AKfycby_fce2Ifn4CFkmFK7caq3FvXr_Jz-CQBrWnC4CbggsBiZOWaPSL5VBx9FV5H0JOqBXjA/exec';

(function(){
  const tabs=[...document.querySelectorAll('.tab')];
  function show(t){
    tabs.forEach(x=>{const on=x===t;x.setAttribute('aria-selected',on);x.tabIndex=on?0:-1;document.getElementById(x.getAttribute('aria-controls')).hidden=!on;});
  }
  tabs.forEach((t,i)=>{
    t.addEventListener('click',()=>show(t));
    t.addEventListener('keydown',e=>{
      if(e.key==='ArrowRight'||e.key==='ArrowLeft'){const n=tabs[(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];show(n);n.focus();}
    });
  });
  show(tabs.find(t=>t.getAttribute('aria-selected')==='true'));
})();

/* 資料請求・無料相談モーダル → Google Apps Script 経由でスプレッドシートに転記 */
(function(){

  const dlg=document.getElementById('contact');
  if(!dlg||typeof dlg.showModal!=='function')return; // 未対応ブラウザは #cta へのリンクのまま
  const form=dlg.querySelector('#contact-form');
  const title=dlg.querySelector('#contact-title');
  const err=dlg.querySelector('.cform-error');
  const done=dlg.querySelector('.cdone');
  const submit=form.querySelector('[type=submit]');
  const TITLES={doc:'資料をダウンロード',consult:'無料で相談する'};
  const DONE={doc:'下のボタンから、資料（PDF・14ページ）をダウンロードできます。',consult:'担当者から、日程調整のご連絡を差し上げます。'};

  function setType(type){
    form.elements.type.value=type;
    title.textContent=TITLES[type];
    form.querySelectorAll('[data-for]').forEach(el=>{
      const on=el.dataset.for===type;
      el.hidden=!on;
      el.querySelectorAll('input,select,textarea').forEach(i=>i.disabled=!on); // 非表示の必須項目は検証・送信しない
    });
  }
  function reset(){
    form.reset();form.hidden=false;done.hidden=true;err.hidden=true;
    submit.disabled=false;submit.textContent='送信する';
  }
  function open(type){
    reset();setType(type);dlg.showModal();
    form.elements.company.focus();
  }

  document.addEventListener('click',e=>{
    const a=e.target.closest('[data-cta]');
    if(!a)return;
    e.preventDefault();open(a.dataset.cta);
  });
  form.addEventListener('change',e=>{if(e.target.name==='type')setType(e.target.value);});
  dlg.querySelector('.modal-close').addEventListener('click',()=>dlg.close());
  dlg.querySelector('.modal-close-done').addEventListener('click',()=>dlg.close());
  dlg.addEventListener('click',e=>{if(e.target===dlg)dlg.close();}); // 背景クリックで閉じる

  function showDone(type){
    form.hidden=true;done.hidden=false;
    done.querySelector('p').textContent=DONE[type];
    done.querySelector('.cdl').hidden=type!=='doc'; // 資料請求のときだけダウンロードボタンを出す
    done.focus();
  }
  function fail(msg){
    err.textContent=msg;err.hidden=false;
    submit.disabled=false;submit.textContent='送信する';
  }

  form.addEventListener('submit',async e=>{
    e.preventDefault();
    err.hidden=true;
    if(!form.reportValidity())return;
    const type=form.elements.type.value;
    const data=new URLSearchParams(new FormData(form));
    data.set('page',location.href);
    if(form.elements.website.value){showDone(type);return;} // スパム対策（人には見えない欄）
    if(!ENDPOINT){fail('送信先が設定されていません（js/main.js の ENDPOINT）。');return;}
    submit.disabled=true;submit.textContent='送信中…';
    try{
      const res=await fetch(ENDPOINT,{method:'POST',body:data});
      const json=await res.json();
      if(!json.ok)throw new Error(json.error||'error');
      showDone(type);
    }catch(_){
      fail('送信できませんでした。時間をおいて再度お試しいただくか、お電話（03-6281-5088／東京支店）でお問い合わせください。');
    }
  });
})();

/* 画面に入ったら動かす（構成図・ロードマップ・320時間のカウント）。
   視差効果を減らす設定や IntersectionObserver 非対応では何もしない＝完成形のまま表示 */
(function(){
  if(!('IntersectionObserver' in window)||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  document.documentElement.classList.add('js-anim');

  function countUp(el){
    const to=+el.dataset.count,start=performance.now(),dur=1400;
    (function tick(now){
      const t=Math.min(1,(now-start)/dur);
      el.textContent=Math.round(to*(1-Math.pow(1-t,3))).toLocaleString('ja-JP');
      if(t<1)requestAnimationFrame(tick);
    })(start);
  }

  const io=new IntersectionObserver(entries=>{
    entries.forEach(e=>{
      const el=e.target;
      if(el.matches('.arch')){el.classList.toggle('is-in',e.isIntersecting);return;} // 構成図は画面外で止め、戻ったら再開
      if(!e.isIntersecting)return;
      if(el.dataset.count)countUp(el);else el.classList.add('is-in'); // ほかは一度動いたら完成形のまま
      io.unobserve(el);
    });
  },{threshold:.3});
  document.querySelectorAll('[data-anim],[data-count]').forEach(el=>{
    if(el.dataset.count)el.textContent='0';
    io.observe(el);
  });
})();

/* 受講者の記事：Apps Script 経由で Zenn のRSSを読み、新しい順に差し替える。
   取得できないときは index.html に書いてある記事のまま */
(function(){
  const list=document.querySelector('.articles[data-feed]');
  if(!list||!ENDPOINT||!window.fetch)return;
  const tpl=list.querySelector('li');
  fetch(ENDPOINT+'?feed=zenn').then(r=>r.json()).then(json=>{
    const items=(json&&json.ok&&Array.isArray(json.items)?json.items:[])
      .filter(a=>/^https:\/\/zenn\.dev\//.test(a.url)&&a.title);
    if(!items.length)return;
    list.replaceChildren(...items.map(a=>{
      const li=tpl.cloneNode(true);
      const d=new Date(a.date);
      const ymd=isNaN(d)?'':[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')];
      li.querySelector('a').href=a.url;
      const img=li.querySelector('img');
      if(/^https:\/\//.test(a.image))img.src=a.image;else img.remove();
      const t=li.querySelector('time');
      t.textContent=ymd?ymd.join('.'):'';t.dateTime=ymd?ymd.join('-'):'';
      li.querySelector('b').textContent=a.title;
      li.querySelector('.art-by span').textContent=a.author||'';
      return li;
    }));
  }).catch(()=>{});
})();
