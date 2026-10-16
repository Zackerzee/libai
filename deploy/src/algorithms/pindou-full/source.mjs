import C from "./color.mjs";
export function defaultCanvasFactory(w=1,h=1) {
 if(typeof OffscreenCanvas!=="undefined")return new OffscreenCanvas(w,h);
 if(typeof document!=="undefined"){const c=document.createElement("canvas");c.width=w;c.height=h;return c;}
 throw new Error("Canvas factory required outside browser");
}
export function createPindouSource(source, opts, canvasFactory=defaultCanvasFactory) {
 const createCanvas=()=>canvasFactory(1,1);
 let img=source;
 if(source?.data){if(source.data.length!==source.width*source.height*4)throw new RangeError("Invalid source RGBA");img=canvasFactory(source.width,source.height);const ctx=img.getContext("2d");const d=ctx.createImageData(source.width,source.height);d.data.set(source.data);ctx.putImageData(d,0,0);}
 const iw=img.naturalWidth||img.width, ih=img.naturalHeight||img.height;
 if(!Number.isInteger(iw)||!Number.isInteger(ih)||iw<1||ih<1)throw new RangeError("Invalid source dimensions");
 // Drawable sources lack HTMLImageElement naturalWidth; local wrapper reads dimensions below.
 const state={img,fitCanvas:createCanvas()};
 let rotCache={img:null,canvas:null},cropCache={base:null,canvas:null};
  function rotatedCanvas() {
    if (rotCache.canvas && rotCache.img === state.img
        && rotCache.rotate === opts.rotate
        && rotCache.flipH === opts.flipH && rotCache.flipV === opts.flipV) {
      return rotCache.canvas;
    }
    var img = state.img, iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var swap = (opts.rotate === 90 || opts.rotate === 270);
    var w = swap ? ih : iw, h = swap ? iw : ih;
    var cv = createCanvas();
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    ctx.translate(w / 2, h / 2);
    // 先 scale 后 rotate：翻转作用在「旋转之后」的画面上，
    // 这样转过 90° 再点水平翻转，看到的也是水平翻转。
    ctx.scale(opts.flipH ? -1 : 1, opts.flipV ? -1 : 1);
    ctx.rotate(opts.rotate * Math.PI / 180);
    ctx.drawImage(img, -iw / 2, -ih / 2);
    rotCache = { img: img, rotate: opts.rotate, flipH: opts.flipH, flipV: opts.flipV, canvas: cv };
    return cv;
  }

  function sourceCanvas() {
    var rc = rotatedCanvas();
    if (!opts.crop) return rc;
    var k = [opts.crop.x, opts.crop.y, opts.crop.w, opts.crop.h].join(',');
    if (cropCache.canvas && cropCache.base === rc && cropCache.crop === k) return cropCache.canvas;
    var c = opts.crop;
    var x = Math.round(c.x * rc.width), y = Math.round(c.y * rc.height);
    var w = Math.max(1, Math.round(c.w * rc.width)), h = Math.max(1, Math.round(c.h * rc.height));
    x = Math.max(0, Math.min(rc.width - 1, x));
    y = Math.max(0, Math.min(rc.height - 1, y));
    w = Math.min(w, rc.width - x); h = Math.min(h, rc.height - y);
    var cv = createCanvas();
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(rc, x, y, w, h, 0, 0, w, h);
    cropCache = { base: rc, crop: k, canvas: cv };
    return cv;
  }

  function fitSource(gw, gh) {
    // 尺寸直接问 sourceCanvas() 要，不读 state.srcW/srcH：
    // 那两个值是给「比例锁定」和界面显示用的可变状态，
    // 一旦和真正要绘制的画布不同步，裁剪区域就会算错。
    var src = sourceCanvas();
    var sw = src.width, sh = src.height;

    // 每格用 k×k 个源像素来采样。
    //
    // k 的上限必须按「中间图总像素」来卡，不能按倍数卡死。
    // 之前写成固定 min(k, 12)，格数一少就等于先让浏览器把原图缩成一张小图，
    // 而那是普通低通滤波——纹理在采样算法看到它之前就已经被抹平了。
    // 格子越少糊得越狠：20×5 格时 DPID 的细线保留度只剩 12.6%，
    // 比什么都不做（面积平均 14.3%）还差。
    var MAX_PX = 4e6;                                   // 中间图最多 400 万像素
    var kMax = Math.max(1, Math.floor(Math.sqrt(MAX_PX / Math.max(1, gw * gh))));
    var k = Math.max(1, Math.min(kMax, Math.round(Math.max(sw / gw, sh / gh))));
    var fw = gw * k, fh = gh * k;

    var cv = state.fitCanvas;
    cv.width = fw; cv.height = fh;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, fw, fh);

    var sx = 0, sy = 0, ssw = sw, ssh = sh, dx = 0, dy = 0, dw = fw, dh = fh;

    if (opts.fitMode === 'cover') {
      var s = Math.max(fw / sw, fh / sh);
      ssw = fw / s; ssh = fh / s;
      sx = (sw - ssw) / 2; sy = (sh - ssh) / 2;
    } else if (opts.fitMode === 'contain') {
      var s2 = Math.min(fw / sw, fh / sh);
      dw = sw * s2; dh = sh * s2;
      dx = (fw - dw) / 2; dy = (fh - dh) / 2;
    }

    // 逐级减半以获得干净的缩小结果
    var down = progressiveDownscale(src, sw, sh, sx, sy, ssw, ssh, Math.round(dw), Math.round(dh));

    var blockPx = k;                                  // 一个格子对应的源像素边长
    if (opts.blur > 0) ctx.filter = 'blur(' + (opts.blur * blockPx * 0.22).toFixed(2) + 'px)';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(down.canvas, 0, 0, down.w, down.h, dx, dy, dw, dh);
    ctx.filter = 'none';

    return { w: fw, h: fh, data: ctx.getImageData(0, 0, fw, fh).data };
  }

  var tmpA = createCanvas(), tmpB = createCanvas();
  function progressiveDownscale(img, sw, sh, sx, sy, ssw, ssh, tw, th) {
    // 首帧最多放大到目标的 4 倍，避免超大原图吃掉几百 MB 显存
    var cw = Math.max(1, Math.min(Math.round(ssw), Math.max(tw * 4, tw)));
    var ch = Math.max(1, Math.min(Math.round(ssh), Math.max(th * 4, th)));
    var a = tmpA, b = tmpB;
    a.width = cw; a.height = ch;
    var actx = a.getContext('2d');
    actx.clearRect(0, 0, cw, ch);
    actx.imageSmoothingEnabled = true; actx.imageSmoothingQuality = 'high';
    actx.drawImage(img, sx, sy, ssw, ssh, 0, 0, cw, ch);

    var curW = cw, curH = ch, cur = a, other = b;
    while (curW > tw * 2 && curH > th * 2 && curW > 2 && curH > 2) {
      var nw = Math.max(tw, curW >> 1), nh = Math.max(th, curH >> 1);
      other.width = nw; other.height = nh;
      var octx = other.getContext('2d');
      octx.clearRect(0, 0, nw, nh);
      octx.imageSmoothingEnabled = true; octx.imageSmoothingQuality = 'high';
      octx.drawImage(cur, 0, 0, curW, curH, 0, 0, nw, nh);
      var t = cur; cur = other; other = t;
      curW = nw; curH = nh;
    }
    return { canvas: cur, w: curW, h: curH };
  }

  /** 背景色移除（在适配画布的像素上做） */
  function removeBg(data, hex, tol) {
    var rgb = C.hexToRgb(hex) || [255, 255, 255];
    var lab = C.rgbToLab(rgb[0], rgb[1], rgb[2], [0, 0, 0]);
    var t = tol * tol * 1.6;                 // 容差 → CIE76 平方阈值
    var tmp = [0, 0, 0];
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      C.rgbToLab(data[i], data[i + 1], data[i + 2], tmp);
      if (C.deltaE76sq(tmp[0], tmp[1], tmp[2], lab[0], lab[1], lab[2]) <= t) data[i + 3] = 0;
    }
  }

return {sourceCanvas,fitSource,removeBg,progressiveDownscale};
}
