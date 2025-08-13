// ========= Палітра (ARGB hex -> RGB) =========
const WPLACE_PALETTE_HEX = [
  "FF000000","FF3C3C3C","FF787878","FFD2D2D2","FFFFFFFF","FF5B031A","FFE2242E","FFF58032","FFEFAA1F","FFF5DD42",
  "FFFEFABD","FF3EB867","FF4FE57A","FF96FE5F","FF2C816D","FF3EADA5","FF50E0BD","FF7CF6F1","FF31509D","FF5293E3",
  "FF6D52F5","FF9DB1FA","FF741299","FFA43BB9","FFDCA0F9","FFC20F7B","FFE12782","FFEB8EAA","FF654635","FF91682D","FFF2B27A"
];
const hexToRGB = (hex)=>[parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16),parseInt(hex.slice(6,8),16)];
const PAL_RGB = WPLACE_PALETTE_HEX.map(hexToRGB);

// ========= sRGB ↔ Lab =========
const srgbToLinear = c => { c/=255; return c<=0.04045? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
const linearToSrgb = c => 255*(c<=0.0031308? 12.92*c : 1.055*Math.pow(c,1/2.4)-0.055);
const rgbToXyz = ([r,g,b])=>{ r=srgbToLinear(r); g=srgbToLinear(g); b=srgbToLinear(b); return [ r*0.4124+g*0.3576+b*0.1805, r*0.2126+g*0.7152+b*0.0722, r*0.0193+g*0.1192+b*0.9505 ]; };
const xyzToLab = ([x,y,z])=>{ const Xn=0.95047,Yn=1,Zn=1.08883; x/=Xn;y/=Yn;z/=Zn; const f=t=> t>0.008856? Math.cbrt(t) : 7.787*t+16/116; const fx=f(x),fy=f(y),fz=f(z); return [116*fy-16, 500*(fx-fy), 200*(fy-fz)]; };
const rgbToLab = rgb => xyzToLab(rgbToXyz(rgb));
const deltaE2 = (a,b)=>{ const dL=a[0]-b[0], da=a[1]-b[1], db=a[2]-b[2]; return dL*dL+da*da+db*db; };
const PAL_LAB = PAL_RGB.map(rgbToLab);

function nearestPaletteColor(color, metric){
  let best=0, bestD=Infinity;
  if(metric==="RGB"){
    for(let i=0;i<PAL_RGB.length;i++){
      const p=PAL_RGB[i]; const dr=color[0]-p[0], dg=color[1]-p[1], db=color[2]-p[2];
      const d=dr*dr+dg*dg+db*db; if(d<bestD){bestD=d;best=i}
    }
    return PAL_RGB[best];
  } else {
    const cL = rgbToLab(color);
    for(let i=0;i<PAL_LAB.length;i++){
      const d = deltaE2(cL, PAL_LAB[i]); if(d<bestD){bestD=d;best=i}
    }
    return PAL_RGB[best];
  }
}

// ========= Ordered 8×8 Bayer =========
const BAYER_8 = [
  [0,48,12,60,3,51,15,63],
  [32,16,44,28,35,19,47,31],
  [8,56,4,52,11,59,7,55],
  [40,24,36,20,43,27,39,23],
  [2,50,14,62,1,49,13,61],
  [34,18,46,30,33,17,45,29],
  [10,58,6,54,9,57,5,53],
  [42,26,38,22,41,25,37,21],
].map(r=>r.map(v=>v/64));
const clamp255 = v => v<0?0:(v>255?255:v);

// ========= Обробка зображення =========
function processImage({img, width, dither, metric, orderedStrength}){
  const srcW = img.width, srcH = img.height;
  const dstW = width, dstH = Math.round((srcH/srcW)*dstW);

  const resize = document.createElement('canvas');
  resize.width = dstW; resize.height = dstH;
  const rctx = resize.getContext('2d',{willReadFrequently:true});
  rctx.imageSmoothingEnabled = true;
  rctx.drawImage(img,0,0,dstW,dstH);

  const imgData = rctx.getImageData(0,0,dstW,dstH);
  const data = imgData.data;

  if(dither==="None"){
    for(let i=0;i<data.length;i+=4){
      const [nr,ng,nb] = nearestPaletteColor([data[i],data[i+1],data[i+2]], metric);
      data[i]=nr; data[i+1]=ng; data[i+2]=nb; data[i+3]=255; // без альфи
    }
    rctx.putImageData(imgData,0,0); return resize;
  }

  if(dither==="Ordered (8x8)"){
    // Розширена сила до 3.0
    const jit = orderedStrength*64;
    for(let y=0;y<dstH;y++) for(let x=0;x<dstW;x++){
      const i=(y*dstW+x)*4, t=BAYER_8[y%8][x%8]-0.5;
      const rr=clamp255(data[i]+t*jit), gg=clamp255(data[i+1]+t*jit), bb=clamp255(data[i+2]+t*jit);
      const [nr,ng,nb]=nearestPaletteColor([rr,gg,bb], metric);
      data[i]=nr; data[i+1]=ng; data[i+2]=nb; data[i+3]=255;
    }
    rctx.putImageData(imgData,0,0); return resize;
  }

  // Error diffusion — працюємо з буфером, але запис у дані одразу квантований
  const buf = new Float32Array(dstW*dstH*3);
  for(let i=0,j=0;i<data.length;i+=4,j+=3){ buf[j]=data[i]; buf[j+1]=data[i+1]; buf[j+2]=data[i+2]; }
  const idx=(x,y)=> (y*dstW+x)*3;

  for(let y=0;y<dstH;y++){
    for(let x=0;x<dstW;x++){
      const k=idx(x,y);
      const r=buf[k], g=buf[k+1], b=buf[k+2];
      const [nr,ng,nb]=nearestPaletteColor([clamp255(r),clamp255(g),clamp255(b)], metric);

      // ВАЖЛИВО: одразу пишемо квантований колір у результат (лише з палітри) і альфа=255
      const di=(y*dstW+x)*4; data[di]=nr; data[di+1]=ng; data[di+2]=nb; data[di+3]=255;

      // Помилка
      const er=r-nr, eg=g-ng, eb=b-nb;

      if(dither==="Floyd–Steinberg"){
        const n1=7/16, n2=3/16, n3=5/16, n4=1/16;
        if(x+1<dstW){ const t=idx(x+1,y); buf[t]+=er*n1; buf[t+1]+=eg*n1; buf[t+2]+=eb*n1; }
        if(y+1<dstH){
          if(x-1>=0){ const t=idx(x-1,y+1); buf[t]+=er*n2; buf[t+1]+=eg*n2; buf[t+2]+=eb*n2; }
          { const t=idx(x,y+1); buf[t]+=er*n3; buf[t+1]+=eg*n3; buf[t+2]+=eb*n3; }
          if(x+1<dstW){ const t=idx(x+1,y+1); buf[t]+=er*n4; buf[t+1]+=eg*n4; buf[t+2]+=eb*n4; }
        }
      } else if(dither==="Atkinson"){
        const n=1/8; const add=(xx,yy)=>{ if(xx>=0&&xx<dstW&&yy>=0&&yy<dstH){ const t=idx(xx,yy); buf[t]+=er*n; buf[t+1]+=eg*n; buf[t+2]+=eb*n; } };
        add(x+1,y); add(x+2,y); add(x-1,y+1); add(x,y+1); add(x+1,y+1); add(x,y+2);
      }
    }
  }

  // НІЧОГО не перезаписуємо назад з buf у data — це виправляє баг із «поза палітрою» у Флойді.
  rctx.putImageData(imgData,0,0); return resize;
}

// ========= UI =========
const el = id=>document.getElementById(id);
const srcC = el('src'); const outC = el('out');
const fileI = el('file'); const urlI = el('url'); const drop = el('drop');
const metricSel = el('metric'); const ditherSel = el('dither');
const orderedWrap = el('orderedWrap'); const orderedR = el('ordered'); const orderedVal = el('orderedVal');
const wRange = el('outW'); const wVal = el('wVal');
const scaleR = el('scale'); const scaleVal = el('scaleVal');
const convertBtn = el('convert'); const saveBtn = el('save');
const themeToggle = el('themeToggle');

let imgEl = null; let pixelScale = +scaleR.value;

// Theme logic
(function initTheme(){
  const saved = localStorage.getItem('wplace_theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  themeToggle.checked = theme === 'dark';
  themeToggle.addEventListener('change', ()=>{
    const t = themeToggle.checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('wplace_theme', t);
  });
})();

function drawSourcePreview(){
  if(!imgEl) return; const ratio = imgEl.height/imgEl.width; const w = Math.min(256, imgEl.width); const h = Math.round(w*ratio);
  srcC.width=w; srcC.height=h; const ctx=srcC.getContext('2d'); ctx.imageSmoothingEnabled=true; ctx.clearRect(0,0,w,h); ctx.drawImage(imgEl,0,0,w,h);
}

function renderScaled(canvas){
  const vw = canvas.width*pixelScale, vh = canvas.height*pixelScale;
  outC.width=vw; outC.height=vh;
  const vctx=outC.getContext('2d');
  vctx.imageSmoothingEnabled=false;
  vctx.clearRect(0,0,vw,vh);
  vctx.drawImage(canvas,0,0,vw,vh);
  outC._resultCanvas = canvas;
}

async function doConvert(){
  if(!imgEl){ alert('Спочатку завантажте зображення'); return; }
  convertBtn.disabled = true; const prevText = convertBtn.textContent; convertBtn.textContent = 'Обробка…';
  try{
    const canvas = processImage({
      img: imgEl,
      width: +wRange.value,
      dither: ditherSel.value,
      metric: metricSel.value,
      orderedStrength: +orderedR.value,
    });
    renderScaled(canvas);
  } finally { convertBtn.disabled = false; convertBtn.textContent = prevText; }
}

function downloadPNG(){
  const result = outC._resultCanvas; if(!result){ alert('Немає результату для збереження'); return; }
  // Переконатися, що альфа відсутня: пройдемося і встановимо 255
  const ctx = result.getContext('2d');
  const imgData = ctx.getImageData(0,0,result.width,result.height);
  const d = imgData.data;
  for(let i=0;i<d.length;i+=4){ d[i+3]=255; }
  ctx.putImageData(imgData,0,0);

  result.toBlob(blob=>{
    const url = URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=`wplace_${wRange.value}w_${ditherSel.value.replace(/[^a-z0-9]+/gi,'_')}.png`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

function setImageURL(u){
  if(!u) return; const img = new Image(); img.crossOrigin='anonymous';
  img.onload=()=>{ imgEl=img; drawSourcePreview(); };
  img.onerror=()=>alert('Не вдалося завантажити зображення');
  img.src=u;
}

// Events
drop.addEventListener('click', ()=>fileI.click());
drop.addEventListener('dragover', e=>{ e.preventDefault(); });
drop.addEventListener('drop', e=>{ e.preventDefault(); const f=e.dataTransfer.files?.[0]; if(f){ const url=URL.createObjectURL(f); setImageURL(url); }});
fileI.addEventListener('change', e=>{ const f=e.target.files?.[0]; if(f){ const url=URL.createObjectURL(f); setImageURL(url); }});
urlI.addEventListener('change', e=> setImageURL(e.target.value.trim()));

ditherSel.addEventListener('change', ()=>{ orderedWrap.classList.toggle('hidden', ditherSel.value!=="Ordered (8x8)"); });
orderedR.addEventListener('input', ()=> orderedVal.textContent = (+orderedR.value).toFixed(2));
wRange.addEventListener('input', ()=> wVal.textContent = wRange.value);
scaleR.addEventListener('input', ()=>{ pixelScale = +scaleR.value; scaleVal.textContent = pixelScale; if(outC._resultCanvas) renderScaled(outC._resultCanvas); });
convertBtn.addEventListener('click', doConvert);
saveBtn.addEventListener('click', downloadPNG);

// Build palette UI
(function buildPalette(){
  const pal = document.getElementById('palette');
  document.getElementById('pcount').textContent = PAL_RGB.length;
  WPLACE_PALETTE_HEX.forEach((hex,i)=>{
    const wrap=document.createElement('div'); wrap.className='swatch';
    const box=document.createElement('div'); const rgb=PAL_RGB[i]; box.style.background=`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`; box.title = '#'+hex.slice(2);
    const cap=document.createElement('div'); cap.textContent = '#'+hex.slice(2);
    wrap.appendChild(box); wrap.appendChild(cap); pal.appendChild(wrap);
  });
})();
