const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const DB = path.join(ROOT, "data.json");

function load() {
  try { return JSON.parse(fs.readFileSync(DB, "utf8")); }
  catch (_) { return { users: [], goals: [] }; }
}
function save(db) {
  fs.mkdirSync(ROOT,{recursive:true});
  const tmp = DB + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DB);
}
function send(res, code, body, type="application/json") {
  res.writeHead(code, {"Content-Type": type, "Cache-Control":"no-store"});
  res.end(type==="application/json" ? JSON.stringify(body) : body);
}
function body(req) {
  return new Promise((resolve,reject)=>{
    let s="";
    req.on("data",c=>{s+=c;if(s.length>2e6) req.destroy();});
    req.on("end",()=>{try{resolve(s?JSON.parse(s):{});}catch(e){reject(e);}});
    req.on("error",reject);
  });
}
function token() { return crypto.randomBytes(32).toString("hex"); }

const sessions = new Map();

const server=http.createServer(async (req,res)=>{
  try {
    if(req.method==="GET" && req.url==="/api/health")
      return send(res,200,{ok:true,service:"hedef-tahtasi",version:"1.2"});

    if(req.method==="POST" && req.url==="/api/register"){
      const x=await body(req), db=load();
      const email=String(x.email||"").trim().toLowerCase();
      const password=String(x.password||"");
      if(!email || password.length<8) return send(res,400,{error:"Geçerli e-posta ve en az 8 karakter parola gerekli."});
      if(db.users.some(u=>u.email===email)) return send(res,409,{error:"Bu hesap zaten mevcut."});
      const salt=crypto.randomBytes(16).toString("hex");
      const hash=crypto.scryptSync(password,salt,64).toString("hex");
      const id=crypto.randomUUID();
      db.users.push({id,email,salt,hash,settings:null,questions:null});
      save(db);
      const t=token(); sessions.set(t,id);
      return send(res,200,{token:t,userId:id});
    }

    if(req.method==="POST" && req.url==="/api/login"){
      const x=await body(req), db=load();
      const email=String(x.email||"").trim().toLowerCase();
      const password=String(x.password||"");
      const u=db.users.find(v=>v.email===email);
      if(!u) return send(res,401,{error:"E-posta veya parola hatalı."});
      const hash=crypto.scryptSync(password,u.salt,64).toString("hex");
      if(!crypto.timingSafeEqual(Buffer.from(hash,"hex"),Buffer.from(u.hash,"hex")))
        return send(res,401,{error:"E-posta veya parola hatalı."});
      const t=token(); sessions.set(t,u.id);
      return send(res,200,{token:t,userId:u.id});
    }

    const auth=req.headers.authorization||"";
    const uid=sessions.get(auth.replace(/^Bearer\s+/,""));
    if(req.url.startsWith("/api/") && !uid) return send(res,401,{error:"Giriş gerekli."});

    if(req.method==="GET" && req.url==="/api/profile"){
      const db=load(), u=db.users.find(v=>v.id===uid);
      return send(res,200,{settings:u&&u.settings||null,questions:u&&u.questions||null});
    }

    if(req.method==="PUT" && req.url==="/api/profile"){
      const x=await body(req), db=load(), u=db.users.find(v=>v.id===uid);
      if(!u) return send(res,404,{error:"Kullanıcı bulunamadı."});
      if(x.settings) u.settings=x.settings;
      if(Array.isArray(x.questions)) u.questions=x.questions;
      save(db);
      return send(res,200,{ok:true});
    }

    if(req.method==="GET" && req.url==="/api/goals"){
      return send(res,200,{goals:load().goals.filter(g=>g.userId===uid)});
    }

    if(req.method==="POST" && req.url==="/api/goals"){
      const x=await body(req), db=load();
      if(!x.id) return send(res,400,{error:"Hedef ID gerekli."});
      const old=db.goals.find(g=>g.userId===uid && g.id===x.id);
      if(old && old.locked) return send(res,409,{error:"Tahtaya alınmış hedef değiştirilemez."});
      const clean=Object.assign({},x,{userId:uid});
      if(old) Object.assign(old,clean);
      else db.goals.push(clean);
      save(db);
      return send(res,200,{ok:true,goal:clean});
    }

    const del=req.url.match(/^\/api\/goals\/([^/]+)$/);
    if(req.method==="DELETE" && del){
      const db=load(), idx=db.goals.findIndex(v=>v.userId===uid&&v.id===del[1]);
      if(idx<0) return send(res,404,{error:"Hedef bulunamadı."});
      if(db.goals[idx].locked) return send(res,409,{error:"Tahtaya alınmış hedef silinemez."});
      db.goals.splice(idx,1); save(db); return send(res,200,{ok:true});
    }

    const m=req.url.match(/^\/api\/goals\/([^/]+)\/board$/);
    if(req.method==="POST" && m){
      const db=load(), g=db.goals.find(v=>v.userId===uid&&v.id===m[1]);
      if(!g) return send(res,404,{error:"Hedef bulunamadı."});
      if(g.locked) return send(res,200,{ok:true,goal:g});
      g.locked=true; g.boardDate=new Date().toISOString();
      save(db);
      return send(res,200,{ok:true,goal:g});
    }

    if(req.method==="GET" && req.url==="/") {
      return send(res,200,fs.readFileSync(path.join(ROOT,"index.html"),"utf8"),"text/html; charset=utf-8");
    }

    if(req.method==="GET" && !req.url.startsWith("/api/")){
      const p=path.normalize(path.join(ROOT,req.url));
      if(p.startsWith(ROOT) && fs.existsSync(p) && fs.statSync(p).isFile())
        return send(res,200,fs.readFileSync(p), "application/octet-stream");
    }
    send(res,404,{error:"Bulunamadı"});
  } catch(e) { send(res,500,{error:"Sunucu hatası"}); }
});
server.listen(PORT, HOST, ()=>console.log("Hedef Tahtası server listening on "+HOST+":"+PORT));
