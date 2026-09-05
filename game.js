(() => {
  "use strict";

  const canvas = document.querySelector("#view");
  const ctx = canvas.getContext("2d", { alpha: false });
  const W = canvas.width;
  const H = canvas.height;
  const FOV = Math.PI / 3;
  const RAYS = 320;
  const STRIP = W / RAYS;
  const TAU = Math.PI * 2;

  const $ = (selector) => document.querySelector(selector);
  const ui = {
    title: $("#titleScreen"), intro: $("#introScreen"), ending: $("#ending"),
    hud: $("#hud"), gallery: $("#gallery"), help: $("#help"), helpButton: $("#helpButton"),
    location: $("#location"), objective: $("#objective"), inventory: $("#inventory"),
    inventoryName: $("#inventoryName"), inventoryIcon: $("#inventoryIcon"),
    focusLabel: $("#focusLabel"), prompt: $("#interactPrompt"),
    promptText: $("#interactPrompt span"), toast: $("#toast"), subtitle: $("#subtitle"),
    flash: $("#flash"), transition: $("#transition"), develop: $("#photoDevelop"),
    photo: $("#photoCanvas"), photoCaption: $("#photoCaption"), keypad: $("#keypad"),
    keypadDisplay: $("#keypadDisplay"), finalTime: $("#finalTime"), finalShots: $("#finalShots"),
  };

  const map = (rows) => rows.map((row) => [...row].map(Number));
  const WORLDS = {
    reality: {
      name: "UNIT 6B · REALITY",
      caption: "THE ROOM AS FOUND",
      map: map([
        "111111111111", "100000000001", "100000000001", "100020000001",
        "100020000001", "100000000001", "100000000001", "100000003301",
        "100000000001", "100000000001", "100000000001", "111111111111",
      ]),
      spawn: { x: 6, y: 6.2, a: Math.PI },
      palette: { ceiling: "#17191a", floor: "#2b2924", walls: ["#625e52", "#3d3c37", "#4d443a"] },
      ambience: 54,
    },
    drowned: {
      name: "AFTERIMAGE 01 · DROWNED",
      caption: "WHAT THE CRACK REMEMBERS",
      map: map([
        "111111111111", "100000000001", "100000000001", "100022000001",
        "100022000001", "100000000001", "100000000001", "100000220001",
        "100000000001", "100000000001", "100000000001", "111111111111",
      ]),
      spawn: { x: 3, y: 6, a: 0 },
      palette: { ceiling: "#081d22", floor: "#14383a", walls: ["#286064", "#163b42", "#4a756f"] },
      ambience: 43,
    },
    longhall: {
      name: "AFTERIMAGE 02 · LONG HALL",
      caption: "WHAT THE MIRROR CONTINUES",
      map: map([
        "1111111111111111", "1000000000000001", "1022222002222201", "1000000000000001",
        "1000000000000001", "1000000000000001", "1000000000000001", "1022222002222201",
        "1000000000000001", "1111111111111111",
      ]),
      spawn: { x: 2.6, y: 5, a: 0 },
      palette: { ceiling: "#1b0b0d", floor: "#2e1618", walls: ["#704348", "#45252b", "#8c6560"] },
      ambience: 62,
    },
    negative: {
      name: "AFTERIMAGE 03 · NEGATIVE",
      caption: "WHAT THE WINDOW REFUSES",
      map: map([
        "111111111111", "100000000001", "100000000001", "100222220001",
        "100000020001", "100000020001", "100000020001", "100000000001",
        "100022220001", "100000000001", "100000000001", "111111111111",
      ]),
      spawn: { x: 6, y: 9.2, a: -Math.PI / 2 },
      palette: { ceiling: "#d1cec1", floor: "#aaa99f", walls: ["#d9d8d1", "#91928f", "#eeeae0"] },
      ambience: 79,
    },
  };

  const anchors = [
    { id: "crack", world: "reality", type: "crack", x: 1.25, y: 6, scale: 1.05, label: "CRACKED WALL", destination: "drowned" },
    { id: "mirror", world: "reality", type: "mirror", x: 10.68, y: 6.1, scale: 1.2, label: "CLOUDY MIRROR", destination: "longhall" },
    { id: "window", world: "reality", type: "window", x: 6.1, y: 1.25, scale: 1.45, label: "BLACK WINDOW", destination: "negative" },
  ];

  const scenery = {
    reality: [
      { id: "door", type: "door", x: 6, y: 10.68, scale: 1.5, label: "LOCKED EXIT", interactive: true },
      { type: "chair", x: 8.1, y: 8.1, scale: .78 },
      { type: "lamp", x: 3.25, y: 2.8, scale: .9 },
    ],
    drowned: [
      { id: "eye", type: "eye", x: 8.5, y: 5.6, scale: .58, label: "GLASS EYE", interactive: true },
      { type: "chair", x: 7.2, y: 8.7, scale: 1.1 },
      { type: "lamp", x: 5.2, y: 2.3, scale: 1.3 },
    ],
    longhall: [
      { id: "socket", type: "socket", x: 13.55, y: 5, scale: 1.15, label: "EMPTY FACE", interactive: true },
      { type: "lamp", x: 7.9, y: 4.4, scale: 1.45 },
      { type: "chair", x: 10.2, y: 5.8, scale: .75 },
    ],
    negative: [
      { id: "clock", type: "clock", x: 6, y: 1.32, scale: 1.15, label: "SILENT CLOCK", interactive: true },
      { type: "chair", x: 8.7, y: 6.7, scale: .88 },
      { type: "lamp", x: 2.4, y: 7.9, scale: 1.05 },
    ],
  };

  const freshProgress = () => ({
    eyeTaken: false, eyePlaced: false, clueKnown: false, completed: false,
    seen: { drowned: false, longhall: false, negative: false },
    shots: 0, startTime: 0,
  });

  let progress = freshProgress();
  let currentWorld = "reality";
  let player = { ...WORLDS.reality.spawn, bob: 0 };
  let started = false;
  let paused = true;
  let cameraUp = false;
  let transitioning = false;
  let portal = null;
  let returnPoint = null;
  let focus = null;
  let toastTimer = 0;
  let subtitleTimer = 0;
  let developTimer = 0;
  let keypadValue = "";
  let last = performance.now();
  const keys = new Set();
  const zBuffer = new Float32Array(RAYS);

  let audio = null;
  let ambience = null;
  let ambienceGain = null;

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  function shade(hex, amount) {
    const raw = hex.slice(1);
    const n = parseInt(raw, 16);
    const r = clamp((n >> 16) + amount, 0, 255);
    const g = clamp(((n >> 8) & 255) + amount, 0, 255);
    const b = clamp((n & 255) + amount, 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  function tileAt(world, x, y) {
    const m = WORLDS[world].map;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (iy < 0 || iy >= m.length || ix < 0 || ix >= m[0].length) return 1;
    return m[iy][ix];
  }

  function castRay(angle) {
    const m = WORLDS[currentWorld].map;
    const rayX = Math.cos(angle);
    const rayY = Math.sin(angle);
    let mapX = Math.floor(player.x);
    let mapY = Math.floor(player.y);
    const deltaX = Math.abs(1 / (rayX || .00001));
    const deltaY = Math.abs(1 / (rayY || .00001));
    const stepX = rayX < 0 ? -1 : 1;
    const stepY = rayY < 0 ? -1 : 1;
    let sideX = rayX < 0 ? (player.x - mapX) * deltaX : (mapX + 1 - player.x) * deltaX;
    let sideY = rayY < 0 ? (player.y - mapY) * deltaY : (mapY + 1 - player.y) * deltaY;
    let side = 0;
    let tile = 1;
    for (let guard = 0; guard < 64; guard += 1) {
      if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
      else { sideY += deltaY; mapY += stepY; side = 1; }
      if (mapY < 0 || mapY >= m.length || mapX < 0 || mapX >= m[0].length) break;
      tile = m[mapY][mapX];
      if (tile > 0) break;
    }
    const dist = side === 0 ? sideX - deltaX : sideY - deltaY;
    const hitX = player.x + rayX * dist;
    const hitY = player.y + rayY * dist;
    const wallU = side === 0 ? hitY - Math.floor(hitY) : hitX - Math.floor(hitX);
    return { dist: Math.max(.001, dist), side, tile, wallU };
  }

  const sprites = {};

  function spriteCanvas(width = 128, height = 192) {
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    return out;
  }

  function makeSprite(type) {
    const out = spriteCanvas();
    const g = out.getContext("2d");
    g.lineCap = "round";
    g.lineJoin = "round";

    if (type === "crack") {
      g.strokeStyle = "rgba(229,218,188,.9)";
      g.lineWidth = 5;
      g.beginPath(); g.moveTo(62, 12); g.lineTo(59, 45); g.lineTo(73, 69); g.lineTo(58, 96); g.lineTo(64, 128); g.lineTo(49, 177); g.stroke();
      g.strokeStyle = "rgba(55,35,29,.96)"; g.lineWidth = 2;
      [[59,45,31,62],[72,69,101,83],[58,96,25,112],[64,128,95,151],[49,176,34,189],[61,25,84,40]].forEach((p) => { g.beginPath(); g.moveTo(p[0],p[1]); g.lineTo(p[2],p[3]); g.stroke(); });
      g.fillStyle = "#b64b39"; g.beginPath(); g.arc(60,96,4,0,TAU); g.fill();
    } else if (type === "mirror") {
      g.fillStyle = "#3b332d"; g.fillRect(24, 8, 80, 176);
      g.fillStyle = "#bcb7aa"; g.fillRect(31, 15, 66, 162);
      const grad = g.createLinearGradient(31, 15, 97, 177); grad.addColorStop(0,"#d8d9d0"); grad.addColorStop(.45,"#6d7475"); grad.addColorStop(1,"#b0a896");
      g.fillStyle = grad; g.fillRect(36, 20, 56, 152);
      g.strokeStyle = "rgba(245,240,218,.6)"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(42,25); g.lineTo(83,166); g.moveTo(86,24); g.lineTo(49,169); g.stroke();
    } else if (type === "window") {
      g.fillStyle = "#201f1d"; g.fillRect(13, 18, 102, 156);
      g.fillStyle = "#030506"; g.fillRect(21, 26, 86, 140);
      g.strokeStyle = "#676257"; g.lineWidth = 6; g.strokeRect(18,23,92,146);
      g.lineWidth = 3; g.beginPath(); g.moveTo(64,25); g.lineTo(64,167); g.moveTo(20,95); g.lineTo(108,95); g.stroke();
      g.fillStyle = "rgba(209,67,47,.2)"; g.beginPath(); g.arc(64,95,26,0,TAU); g.fill();
    } else if (type === "door") {
      g.fillStyle = "#1f1c19"; g.fillRect(18, 3, 92, 186);
      g.fillStyle = "#55493c"; g.fillRect(25, 9, 78, 178);
      g.strokeStyle = "#2c2722"; g.lineWidth = 4; g.strokeRect(34,22,60,62); g.strokeRect(34,98,60,71);
      g.fillStyle = "#c9a260"; g.beginPath(); g.arc(88,96,5,0,TAU); g.fill();
      g.fillStyle = "#161717"; g.fillRect(43,64,25,33); g.fillStyle = "#b94331"; g.fillRect(48,69,15,5);
    } else if (type === "eye") {
      g.fillStyle = "rgba(12,20,19,.55)"; g.beginPath(); g.ellipse(64,151,35,9,0,0,TAU); g.fill();
      g.fillStyle = "#d8d3bc"; g.beginPath(); g.ellipse(64,101,43,27,0,0,TAU); g.fill();
      g.strokeStyle = "#8b8d82"; g.lineWidth = 4; g.stroke();
      const eye = g.createRadialGradient(58,93,3,64,101,19); eye.addColorStop(0,"#e2f0e0"); eye.addColorStop(.3,"#577b70"); eye.addColorStop(.72,"#183c38"); eye.addColorStop(1,"#07100f");
      g.fillStyle = eye; g.beginPath(); g.arc(64,101,20,0,TAU); g.fill();
      g.fillStyle = "#020303"; g.beginPath(); g.arc(64,101,8,0,TAU); g.fill();
      g.fillStyle = "white"; g.beginPath(); g.arc(57,94,4,0,TAU); g.fill();
      g.strokeStyle = "rgba(190,63,44,.7)"; g.lineWidth = 1;
      for (let i=0;i<10;i+=1) { const a=i/10*TAU; g.beginPath(); g.moveTo(64+Math.cos(a)*22,101+Math.sin(a)*13); g.lineTo(64+Math.cos(a)*38,101+Math.sin(a)*22); g.stroke(); }
    } else if (type === "socket" || type === "socketFull") {
      g.fillStyle = "#c3ab99"; g.beginPath(); g.ellipse(64,80,42,62,0,0,TAU); g.fill();
      g.fillStyle = "#8d7769"; g.fillRect(49,137,30,42);
      g.fillStyle = type === "socketFull" ? "#d5d1bb" : "#171112"; g.beginPath(); g.ellipse(47,72,13,9,0,0,TAU); g.fill();
      if (type === "socketFull") { g.fillStyle="#244a46"; g.beginPath(); g.arc(47,72,7,0,TAU); g.fill(); g.fillStyle="#050808"; g.beginPath(); g.arc(47,72,3,0,TAU); g.fill(); }
      g.fillStyle = "#171112"; g.beginPath(); g.ellipse(81,72,7,5,0,0,TAU); g.fill();
      g.strokeStyle = "#5b3b39"; g.lineWidth = 3; g.beginPath(); g.moveTo(47,113); g.quadraticCurveTo(64,123,81,110); g.stroke();
      g.strokeStyle = "rgba(138,39,37,.7)"; g.beginPath(); g.moveTo(64,18); g.lineTo(68,52); g.lineTo(58,89); g.lineTo(70,135); g.stroke();
    } else if (type === "clock" || type === "clockBlank") {
      g.fillStyle = "#1b1b1a"; g.beginPath(); g.arc(64,90,57,0,TAU); g.fill();
      g.fillStyle = type === "clock" ? "#e1ded1" : "#bab9b2"; g.beginPath(); g.arc(64,90,49,0,TAU); g.fill();
      g.strokeStyle = "#363633"; g.lineWidth = 2;
      for (let i=0;i<12;i+=1) { const a=i/12*TAU-Math.PI/2; g.beginPath(); g.moveTo(64+Math.cos(a)*39,90+Math.sin(a)*39); g.lineTo(64+Math.cos(a)*45,90+Math.sin(a)*45); g.stroke(); }
      if (type === "clock") {
        g.strokeStyle = "#9d3229"; g.lineWidth = 5; g.beginPath(); g.moveTo(64,90); g.lineTo(70,55); g.moveTo(64,90); g.lineTo(24,82); g.stroke();
        g.fillStyle = "#9d3229"; g.font = "bold 13px Courier New"; g.textAlign="center"; g.fillText("03:17",64,166);
      } else {
        g.fillStyle = "#77766f"; g.beginPath(); g.arc(64,90,7,0,TAU); g.fill();
        g.strokeStyle = "rgba(40,40,38,.2)"; g.beginPath(); g.moveTo(22,55); g.lineTo(105,122); g.stroke();
      }
    } else if (type === "chair") {
      g.fillStyle = "#6f3029"; g.fillRect(30,44,68,83); g.fillStyle = "#54241f"; g.fillRect(24,116,80,30);
      g.fillStyle = "#32231f"; g.fillRect(31,144,9,46); g.fillRect(88,144,9,46);
      g.strokeStyle="#9a4b3f"; g.lineWidth=3; g.strokeRect(35,50,58,68);
    } else if (type === "lamp") {
      g.fillStyle = "rgba(226,209,151,.12)"; g.beginPath(); g.arc(64,62,52,0,TAU); g.fill();
      g.fillStyle = "#b6a372"; g.beginPath(); g.moveTo(36,65); g.lineTo(51,25); g.lineTo(78,25); g.lineTo(94,65); g.closePath(); g.fill();
      g.fillStyle = "#3b352e"; g.fillRect(60,65,8,92); g.fillRect(40,155,48,8);
    }
    return out;
  }

  ["crack","mirror","window","door","eye","socket","socketFull","clock","clockBlank","chair","lamp"].forEach((type) => { sprites[type] = makeSprite(type); });

  function makePortalSprite(destination, now) {
    const out = spriteCanvas(128, 208);
    const g = out.getContext("2d");
    const palette = WORLDS[destination].palette;
    g.fillStyle = "rgba(226,219,198,.95)"; g.fillRect(4,2,120,204);
    g.fillStyle = "#0b0c0c"; g.fillRect(10,8,108,174);
    const grad = g.createLinearGradient(10,8,118,182);
    grad.addColorStop(0,palette.walls[2]); grad.addColorStop(.45,palette.ceiling); grad.addColorStop(1,palette.floor);
    g.fillStyle=grad; g.fillRect(14,12,100,166);
    for (let i=0;i<18;i+=1) {
      const yy=15+i*9;
      const shift=Math.sin(now*.004+i*1.7)*14;
      g.fillStyle=i%3===0?"rgba(228,218,193,.22)":"rgba(4,7,8,.24)";
      g.fillRect(14+shift,yy,100-Math.abs(shift),3+(i%2)*2);
    }
    g.strokeStyle="rgba(235,226,201,.75)"; g.lineWidth=2; g.strokeRect(14,12,100,166);
    g.fillStyle="#22221f"; g.font="bold 8px Courier New"; g.textAlign="center";
    g.fillText(destination === "reality" ? "RETURN" : destination.toUpperCase(),64,197);
    return out;
  }

  function visibleObjects(now) {
    const objects = scenery[currentWorld].map((o)=>({...o}));
    if (currentWorld === "reality") objects.push(...anchors.map((o)=>({...o})));
    if (progress.eyeTaken) {
      const i = objects.findIndex((o) => o.id === "eye");
      if (i >= 0) objects.splice(i,1);
    }
    const socket = objects.find((o) => o.id === "socket");
    if (socket && progress.eyePlaced) socket.type = "socketFull";
    const clock = objects.find((o) => o.id === "clock");
    if (clock) clock.type = progress.eyePlaced ? "clock" : "clockBlank";
    if (portal) objects.push({ ...portal, type: "portal", image: makePortalSprite(portal.destination, now), scale: 1.25 });
    return objects;
  }

  function renderBackground(now) {
    const world = WORLDS[currentWorld];
    const horizon = H / 2 + Math.sin(player.bob) * 2;
    const ceiling = ctx.createLinearGradient(0,0,0,horizon);
    ceiling.addColorStop(0,shade(world.palette.ceiling,-14)); ceiling.addColorStop(1,world.palette.ceiling);
    ctx.fillStyle=ceiling; ctx.fillRect(0,0,W,horizon);
    const floor = ctx.createLinearGradient(0,horizon,0,H);
    floor.addColorStop(0,world.palette.floor); floor.addColorStop(1,shade(world.palette.floor,-25));
    ctx.fillStyle=floor; ctx.fillRect(0,horizon,W,H-horizon);

    if (currentWorld === "reality") {
      ctx.fillStyle="rgba(228,211,155,.08)"; ctx.beginPath(); ctx.moveTo(W*.42,0); ctx.lineTo(W*.58,0); ctx.lineTo(W*.67,horizon); ctx.lineTo(W*.33,horizon); ctx.fill();
    } else if (currentWorld === "drowned") {
      for (let y=horizon+8;y<H;y+=14) { ctx.strokeStyle=`rgba(99,190,184,${.025+(y-horizon)/H*.04})`; ctx.beginPath(); for(let x=0;x<=W;x+=12){ const yy=y+Math.sin(x*.035+now*.002+y)*2; x===0?ctx.moveTo(x,yy):ctx.lineTo(x,yy); } ctx.stroke(); }
    } else if (currentWorld === "longhall") {
      ctx.fillStyle="rgba(117,27,34,.1)"; for(let x=0;x<W;x+=80) ctx.fillRect(x+Math.sin(now*.001)*20,0,2,H);
    } else {
      ctx.globalCompositeOperation="difference"; ctx.fillStyle="rgba(255,255,255,.035)";
      for(let i=0;i<8;i+=1) ctx.fillRect(0,(i*47+now*.02)%H,W,2);
      ctx.globalCompositeOperation="source-over";
    }
  }

  function renderWalls() {
    const world = WORLDS[currentWorld];
    const bob = Math.sin(player.bob) * 2;
    for (let i=0;i<RAYS;i+=1) {
      const rayAngle = player.a - FOV/2 + (i/RAYS)*FOV;
      const hit = castRay(rayAngle);
      const corrected = hit.dist * Math.cos(rayAngle-player.a);
      zBuffer[i] = corrected;
      const height = Math.min(H*2.5, H/corrected);
      const top = H/2-height/2+bob;
      const base = world.palette.walls[(hit.tile-1)%world.palette.walls.length];
      const distanceShade = -Math.min(48, corrected*5.4) - (hit.side ? 15 : 0);
      const seam = (Math.floor(hit.wallU*12)%3===0) ? -8 : 0;
      ctx.fillStyle = shade(base,distanceShade+seam);
      ctx.fillRect(i*STRIP,top,STRIP+1,height);
      if (hit.wallU < .025) { ctx.fillStyle="rgba(0,0,0,.22)"; ctx.fillRect(i*STRIP,top,STRIP+1,height); }
    }
  }

  function renderObject(obj) {
    const dx=obj.x-player.x, dy=obj.y-player.y;
    const dirX=Math.cos(player.a), dirY=Math.sin(player.a);
    const planeX=-dirY*Math.tan(FOV/2), planeY=dirX*Math.tan(FOV/2);
    const inv=1/(planeX*dirY-dirX*planeY);
    const tx=inv*(dirY*dx-dirX*dy);
    const ty=inv*(-planeY*dx+planeX*dy);
    if (ty <= .08) return;
    const image=obj.image || sprites[obj.type];
    if (!image) return;
    const screenX=Math.floor((W/2)*(1+tx/ty));
    const spriteH=Math.abs(Math.floor((H/ty)*(obj.scale||1)));
    const spriteW=Math.floor(spriteH*(image.width/image.height));
    const floorTypes=new Set(["eye","chair","lamp"]);
    const baseY=floorTypes.has(obj.type) ? H/2+H/(2*ty)+Math.sin(player.bob)*2 : H/2+spriteH*.03+Math.sin(player.bob)*2;
    const startX=Math.floor(screenX-spriteW/2);
    const startY=Math.floor(baseY-spriteH/2);
    for(let sx=0;sx<spriteW;sx+=2){
      const x=startX+sx;
      if(x<0||x>=W) continue;
      const rayIndex=Math.floor(x/STRIP);
      if(rayIndex<0||rayIndex>=RAYS||ty>=zBuffer[rayIndex]+.12) continue;
      const sourceX=Math.floor((sx/spriteW)*image.width);
      ctx.drawImage(image,sourceX,0,Math.max(1,Math.ceil(image.width*2/spriteW)),image.height,x,startY,2,spriteH);
    }
  }

  function renderScene(now) {
    renderBackground(now);
    renderWalls();
    visibleObjects(now)
      .map((o)=>({o,d:Math.hypot(o.x-player.x,o.y-player.y)}))
      .sort((a,b)=>b.d-a.d)
      .forEach(({o})=>renderObject(o));

    if (currentWorld === "drowned") {
      ctx.fillStyle="rgba(33,112,116,.09)"; ctx.fillRect(0,H*.67,W,H*.33);
    }
    if (currentWorld === "negative") {
      ctx.globalCompositeOperation="difference"; ctx.fillStyle="rgba(255,255,255,.035)"; ctx.fillRect(0,0,W,H); ctx.globalCompositeOperation="source-over";
    }
  }

  function lineOfSight(obj) {
    const angle=Math.atan2(obj.y-player.y,obj.x-player.x);
    const wall=castRay(angle).dist;
    return Math.hypot(obj.x-player.x,obj.y-player.y) < wall+.3;
  }

  function updateFocus() {
    const objects=visibleObjects(performance.now());
    let candidates=[];
    if(cameraUp && currentWorld === "reality") {
      candidates=anchors.filter(lineOfSight).map((o)=>{
        const angle=Math.atan2(o.y-player.y,o.x-player.x);
        return {o,score:Math.abs(angleDelta(angle,player.a)),dist:distance(o,player)};
      }).filter((v)=>v.score<.16&&v.dist<11).sort((a,b)=>a.score-b.score);
    } else if(!cameraUp) {
      candidates=objects.filter((o)=>o.interactive).filter(lineOfSight).map((o)=>{
        const angle=Math.atan2(o.y-player.y,o.x-player.x);
        return {o,score:Math.abs(angleDelta(angle,player.a)),dist:distance(o,player)};
      }).filter((v)=>v.score<.25&&v.dist<2.15).sort((a,b)=>(a.score+a.dist*.04)-(b.score+b.dist*.04));
    }
    focus=candidates[0]?.o || null;

    if(cameraUp){
      ui.focusLabel.textContent=focus?`SUBJECT LOCK · ${focus.label}`:(currentWorld === "reality"?"NO USEFUL SUBJECT":"THE IMAGE IS ALREADY DEVELOPED");
      ui.focusLabel.classList.toggle("locked",!!focus);
      ui.prompt.classList.add("hidden");
    }else if(focus){
      ui.promptText.textContent=focus.id === "door" ? "TRY THE LOCK" : focus.id === "eye" ? "TAKE GLASS EYE" : focus.id === "socket" ? "EXAMINE FACE" : "EXAMINE CLOCK";
      ui.prompt.classList.remove("hidden");
    }else{
      ui.prompt.classList.add("hidden");
    }
  }

  function canMoveTo(x,y){
    const r=.2;
    return tileAt(currentWorld,x-r,y-r)===0&&tileAt(currentWorld,x+r,y-r)===0&&tileAt(currentWorld,x-r,y+r)===0&&tileAt(currentWorld,x+r,y+r)===0;
  }

  function update(dt){
    if(!started||paused||transitioning||ui.keypad.open) return;
    const speed=(keys.has("ShiftLeft")||keys.has("ShiftRight")?3.2:2.15)*dt;
    let forward=0,side=0,turn=0;
    if(keys.has("KeyW")||keys.has("ArrowUp")) forward+=1;
    if(keys.has("KeyS")||keys.has("ArrowDown")) forward-=1;
    if(keys.has("KeyA")) side-=1;
    if(keys.has("KeyD")) side+=1;
    if(keys.has("ArrowLeft")) turn-=1;
    if(keys.has("ArrowRight")) turn+=1;
    player.a=(player.a+turn*1.7*dt+TAU)%TAU;
    if(forward||side){
      const len=Math.hypot(forward,side); forward/=len; side/=len;
      const dx=(Math.cos(player.a)*forward+Math.cos(player.a+Math.PI/2)*side)*speed;
      const dy=(Math.sin(player.a)*forward+Math.sin(player.a+Math.PI/2)*side)*speed;
      if(canMoveTo(player.x+dx,player.y)) player.x+=dx;
      if(canMoveTo(player.x,player.y+dy)) player.y+=dy;
      player.bob+=dt*11*(speed>2.5?1.3:1);
    }
    if(portal&&Math.hypot(player.x-portal.x,player.y-portal.y)<.58) travel(portal.destination);
    updateFocus();
  }

  function objectiveText(){
    if(progress.clueKnown) return "03:17. Return to reality and unlock the exit.";
    if(progress.eyePlaced) return "The black window is awake. Photograph it.";
    if(progress.eyeTaken) return "Carry the GLASS EYE somewhere it can watch.";
    return "Photograph the cracked wall. The angle matters.";
  }

  function updateUI(){
    ui.location.textContent=WORLDS[currentWorld].name;
    ui.objective.textContent=objectiveText();
    const carrying=progress.eyeTaken&&!progress.eyePlaced;
    ui.inventory.classList.toggle("empty",!carrying);
    ui.inventoryName.textContent=carrying?"GLASS EYE":"EMPTY";
    ui.inventoryIcon.textContent=carrying?"◉":"—";
    for(const id of ["drowned","longhall","negative"]){
      const film=document.querySelector(`.film[data-state="${id}"]`);
      film.classList.toggle("locked",!progress.seen[id]);
      film.classList.toggle("seen",progress.seen[id]);
      const solved=(id==="drowned"&&progress.eyeTaken)||(id==="longhall"&&progress.eyePlaced)||(id==="negative"&&progress.clueKnown);
      film.classList.toggle("solved",solved);
    }
  }

  function showToast(text,duration=2100){
    clearTimeout(toastTimer); ui.toast.textContent=text; ui.toast.classList.add("show");
    toastTimer=setTimeout(()=>ui.toast.classList.remove("show"),duration);
  }

  function say(text,duration=3200){
    clearTimeout(subtitleTimer); ui.subtitle.textContent=text; ui.subtitle.classList.add("show");
    subtitleTimer=setTimeout(()=>ui.subtitle.classList.remove("show"),duration);
  }

  function initAudio(){
    if(audio) return;
    const AudioContext=window.AudioContext||window.webkitAudioContext;
    if(!AudioContext) return;
    audio=new AudioContext();
    ambience=audio.createOscillator(); ambienceGain=audio.createGain();
    ambience.type="sine"; ambience.frequency.value=WORLDS[currentWorld].ambience; ambienceGain.gain.value=.016;
    ambience.connect(ambienceGain).connect(audio.destination); ambience.start();
  }

  function tone(freq=220,duration=.12,volume=.05,type="sine",delay=0){
    if(!audio) return;
    const osc=audio.createOscillator(), gain=audio.createGain();
    osc.type=type; osc.frequency.setValueAtTime(freq,audio.currentTime+delay);
    gain.gain.setValueAtTime(volume,audio.currentTime+delay);
    gain.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+delay+duration);
    osc.connect(gain).connect(audio.destination); osc.start(audio.currentTime+delay); osc.stop(audio.currentTime+delay+duration+.02);
  }

  function shutter(){ tone(115,.055,.08,"square"); tone(58,.11,.07,"square",.065); }

  function toggleCamera(force){
    if(!started||paused||transitioning) return;
    cameraUp=typeof force==="boolean"?force:!cameraUp;
    document.body.classList.toggle("camera-up",cameraUp);
    tone(cameraUp?420:260,.06,.025,"triangle");
    updateFocus();
  }

  function safePortalPosition(){
    const ray=castRay(player.a);
    let d=Math.min(1.8,Math.max(.85,ray.dist-.48));
    while(d>.7){
      const x=player.x+Math.cos(player.a)*d;
      const y=player.y+Math.sin(player.a)*d;
      if(tileAt(currentWorld,x,y)===0) return {x,y};
      d-=.12;
    }
    return {x:player.x+Math.cos(player.a)*.65,y:player.y+Math.sin(player.a)*.65};
  }

  function takePhoto(forcedAnchor=null){
    if(!started||paused||transitioning||developTimer) return;
    progress.shots+=1;
    shutter();
    ui.flash.classList.remove("fire"); void ui.flash.offsetWidth; ui.flash.classList.add("fire");
    const photoCtx=ui.photo.getContext("2d"); photoCtx.drawImage(canvas,0,0,ui.photo.width,ui.photo.height);
    const subject=forcedAnchor||focus;
    if(currentWorld!=="reality"||!subject?.destination){
      ui.photoCaption.textContent=currentWorld!=="reality"?"DOUBLE EXPOSURE · NO NEW DEPTH":"PLASTER · NO USEFUL DEPTH";
      developTimer=setTimeout(()=>{ui.develop.classList.remove("show");developTimer=0;},1700);
      ui.develop.classList.add("show");
      showToast("THE CAMERA FINDS NOTHING BEYOND IT",1500);
      return;
    }
    const dest=subject.destination;
    ui.photoCaption.textContent=`${WORLDS[dest].caption} · ${String(progress.shots).padStart(2,"0")}`;
    ui.develop.classList.add("show");
    cameraUp=false; document.body.classList.remove("camera-up");
    const p=safePortalPosition();
    developTimer=setTimeout(()=>{
      portal={id:"portal",x:p.x,y:p.y,destination:dest,label:`ENTER ${WORLDS[dest].name}`};
      ui.develop.classList.remove("show"); developTimer=0;
      showToast("PHOTOGRAPH DEVELOPED · WALK INTO THE FRAME",2800);
      tone(88,.6,.045,"sine"); tone(132,.8,.025,"triangle",.12);
    },1050);
  }

  function returnPortalFor(world){
    if(world==="drowned") return {id:"portal",x:1.4,y:6,destination:"reality",label:"RETURN TO REALITY"};
    if(world==="longhall") return {id:"portal",x:1.35,y:5,destination:"reality",label:"RETURN TO REALITY"};
    return {id:"portal",x:6,y:10.55,destination:"reality",label:"RETURN TO REALITY"};
  }

  function travel(destination){
    if(transitioning) return;
    transitioning=true; cameraUp=false; document.body.classList.remove("camera-up");
    ui.transition.classList.remove("cross"); void ui.transition.offsetWidth; ui.transition.classList.add("cross");
    tone(70,.7,.05,"sawtooth");
    if(currentWorld==="reality") returnPoint={x:player.x,y:player.y,a:player.a};
    setTimeout(()=>{
      currentWorld=destination;
      if(destination==="reality"){
        player={...(returnPoint||WORLDS.reality.spawn),bob:0}; portal=null;
        say("The room is unchanged. You are not.",2400);
      }else{
        player={...WORLDS[destination].spawn,bob:0};
        progress.seen[destination]=true; portal=returnPortalFor(destination);
        const lines={drowned:"Water remembers every face.",longhall:"A reflection keeps going after you turn away.",negative:"The light here arrives before its source."};
        say(lines[destination],3100);
      }
      if(ambience) ambience.frequency.setTargetAtTime(WORLDS[currentWorld].ambience,audio.currentTime,.25);
      updateUI();
    },420);
    setTimeout(()=>{transitioning=false;ui.transition.classList.remove("cross");},930);
  }

  function interact(forcedId=null){
    const target=forcedId?visibleObjects(performance.now()).find((o)=>o.id===forcedId):focus;
    if(!target) return;
    if(target.id==="eye"){
      progress.eyeTaken=true; updateUI(); tone(520,.12,.05,"triangle"); tone(780,.22,.035,"sine",.09);
      say("Cold glass. It turns in your palm to keep watching you.",3200); showToast("GLASS EYE ADDED TO POCKET");
    }else if(target.id==="socket"){
      if(progress.eyePlaced){ say("The borrowed eye stares toward the apartment window."); }
      else if(progress.eyeTaken){
        progress.eyePlaced=true; updateUI(); tone(180,.15,.05,"square"); tone(360,.55,.04,"sine",.1);
        say("The eye opens. The mannequin turns toward a window that is not here.",3800); showToast("SOMETHING CHANGED IN REALITY",2800);
      }else say("One eye is missing. The empty socket is exactly the size of a marble.");
    }else if(target.id==="clock"){
      if(!progress.eyePlaced){ say("The clock has no hands. Its face has never been watched."); }
      else{
        progress.clueKnown=true; updateUI(); tone(317,.8,.04,"sine");
        say("The hands twitch once: three seventeen. 03:17.",4200); showToast("TIME REMEMBERED · 03:17",3000);
      }
    }else if(target.id==="door"){
      toggleCamera(false); keypadValue=""; updateKeypad(); ui.keypad.showModal(); paused=true;
      if(!progress.clueKnown) say("Four digits. The lock is waiting for a time the room remembers.");
    }
  }

  function updateKeypad(){
    const padded=(keypadValue+"····").slice(0,4);
    ui.keypadDisplay.textContent=`${padded.slice(0,2)}:${padded.slice(2)}`;
  }

  function keypadInput(value){
    if(value==="clear") keypadValue="";
    else if(value==="enter"){
      if(keypadValue==="0317") { ui.keypad.close(); paused=false; finish(); return; }
      keypadValue=""; tone(85,.25,.06,"sawtooth"); showToast("THE LOCK DOES NOT REMEMBER THAT TIME");
    }else if(value==="cancel") { ui.keypad.close(); paused=false; return; }
    else if(/^\d$/.test(value)&&keypadValue.length<4){ keypadValue+=value; tone(280+Number(value)*18,.045,.03,"square"); }
    updateKeypad();
  }

  function finish(){
    progress.completed=true; paused=true; if(document.pointerLockElement) document.exitPointerLock();
    tone(110,.5,.05,"sine"); tone(165,.9,.04,"sine",.25); tone(220,1.2,.025,"sine",.45);
    const elapsed=Math.max(0,Math.floor((performance.now()-progress.startTime)/1000));
    ui.finalTime.textContent=`${String(Math.floor(elapsed/60)).padStart(2,"0")}:${String(elapsed%60).padStart(2,"0")}`;
    ui.finalShots.textContent=String(progress.shots);
    setTimeout(()=>{ui.ending.classList.add("active");},650);
  }

  function beginIntro(){
    initAudio(); if(audio?.state==="suspended") audio.resume();
    ui.title.classList.remove("active"); ui.intro.classList.add("active");
  }

  function enterGame(){
    ui.intro.classList.remove("active"); ui.hud.classList.remove("hidden"); ui.gallery.classList.remove("hidden"); ui.helpButton.classList.remove("hidden");
    started=true; paused=false; progress.startTime=performance.now(); updateUI();
    say("The room smells of dust and burned film.",3200);
    showToast("C · RAISE CAMERA     E · INTERACT     H · CONTROLS",4200);
    canvas.requestPointerLock?.();
  }

  function resetGame(){
    progress=freshProgress(); currentWorld="reality"; player={...WORLDS.reality.spawn,bob:0};
    portal=null; returnPoint=null; focus=null; transitioning=false; cameraUp=false; paused=false; started=true;
    progress.startTime=performance.now(); keys.clear(); document.body.classList.remove("camera-up");
    ui.ending.classList.remove("active"); ui.develop.classList.remove("show"); ui.keypad.close?.();
    if(ambience) ambience.frequency.setTargetAtTime(WORLDS.reality.ambience,audio.currentTime,.2);
    updateUI(); say("Again. This time, the room recognizes you.",3000);
  }

  function toggleHelp(force){
    const shouldShow=typeof force==="boolean"?force:ui.help.classList.contains("hidden");
    ui.help.classList.toggle("hidden",!shouldShow);
  }

  $("#startButton").addEventListener("click",beginIntro);
  $("#enterButton").addEventListener("click",enterGame);
  $("#restartButton").addEventListener("click",resetGame);
  ui.helpButton.addEventListener("click",()=>toggleHelp());
  $("#closeHelp").addEventListener("click",()=>toggleHelp(false));

  ui.keypad.querySelectorAll("button").forEach((button)=>{
    button.addEventListener("click",(event)=>{event.preventDefault();keypadInput(button.value);});
  });
  ui.keypad.addEventListener("cancel",(event)=>{event.preventDefault();ui.keypad.close();paused=false;});

  document.addEventListener("keydown",(event)=>{
    if(ui.keypad.open){
      if(/^Digit\d$/.test(event.code)) keypadInput(event.code.slice(-1));
      else if(event.code==="NumpadEnter"||event.code==="Enter") keypadInput("enter");
      else if(event.code==="Backspace"||event.code==="Delete") keypadInput("clear");
      else if(event.code==="Escape") keypadInput("cancel");
      return;
    }
    if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if(event.repeat) return;
    if(event.code==="KeyC") toggleCamera();
    else if(event.code==="Space"&&cameraUp) takePhoto();
    else if(event.code==="KeyE"&&!cameraUp) interact();
    else if(event.code==="KeyH") toggleHelp();
    else if(event.code==="Escape") {toggleCamera(false);toggleHelp(false);}
  });
  document.addEventListener("keyup",(event)=>keys.delete(event.code));
  document.addEventListener("mousemove",(event)=>{
    if(document.pointerLockElement===canvas&&started&&!paused&&!transitioning){
      player.a=(player.a+event.movementX*.00225+TAU)%TAU; updateFocus();
    }
  });
  canvas.addEventListener("mousedown",(event)=>{
    if(!started||paused) return;
    if(event.button===2){event.preventDefault();toggleCamera();return;}
    if(event.button===0&&cameraUp) takePhoto();
    else if(event.button===0&&document.pointerLockElement!==canvas) canvas.requestPointerLock?.();
  });
  canvas.addEventListener("contextmenu",(event)=>event.preventDefault());
  window.addEventListener("blur",()=>keys.clear());

  function loop(now){
    const dt=Math.min(.05,(now-last)/1000); last=now;
    update(dt); renderScene(now);
    requestAnimationFrame(loop);
  }

  window.__afterimageDebug={
    snapshot:()=>({world:currentWorld,player:{x:player.x,y:player.y,a:player.a},progress:JSON.parse(JSON.stringify(progress)),portal:portal?{...portal}:null,focus:focus?.id||null}),
    start:()=>{ui.title.classList.remove("active");ui.intro.classList.remove("active");ui.hud.classList.remove("hidden");ui.gallery.classList.remove("hidden");started=true;paused=false;progress.startTime=performance.now();updateUI();},
    photograph:(anchorId)=>{const anchor=anchors.find((o)=>o.id===anchorId);if(anchor)takePhoto(anchor);},
    travel:(world)=>travel(world),
    interact:(id)=>interact(id),
    teleport:(x,y,a=player.a)=>{player.x=x;player.y=y;player.a=a;updateFocus();},
    keypad:(value)=>keypadInput(value),
    reset:resetGame,
  };
  if(new URLSearchParams(location.search).has("test")){
    const harness=$("#testHarness"); harness.classList.remove("hidden");
    harness.addEventListener("click",(event)=>{
      const action=event.target.dataset.testAction; if(!action) return;
      if(action==="start") window.__afterimageDebug.start();
      else if(action.startsWith("photo:")) window.__afterimageDebug.photograph(action.split(":")[1]);
      else if(action.startsWith("travel:")) window.__afterimageDebug.travel(action.split(":")[1]);
      else if(action.startsWith("interact:")) window.__afterimageDebug.interact(action.split(":")[1]);
      else if(action==="solve"){ for(const digit of "0317") keypadInput(digit); keypadInput("enter"); }
    });
  }
  document.body.dataset.gameReady="true";
  updateUI();
  requestAnimationFrame(loop);
})();
