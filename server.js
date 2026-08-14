const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(process.env.DB_FILE || 'rewards.db');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 points INTEGER NOT NULL DEFAULT 0,
 referral_code TEXT UNIQUE NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 reward INTEGER NOT NULL,
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS completions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 task_id INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id, task_id),
 FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(task_id) REFERENCES tasks(id)
);
CREATE TABLE IF NOT EXISTS withdrawals(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 amount INTEGER NOT NULL,
 method TEXT NOT NULL,
 account TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'Pending',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

const count = db.prepare('SELECT COUNT(*) c FROM tasks').get().c;
if (!count) {
  const add = db.prepare('INSERT INTO tasks(title,description,reward) VALUES(?,?,?)');
  [['Daily Check-in','প্রতিদিন check-in করুন',10],['Quick Quiz','ছোট quiz সম্পন্ন করুন',30],['Survey','একটি short survey সম্পন্ন করুন',50]].forEach(x=>add.run(...x));
}

const sessions = new Map();
const hash = p => crypto.createHash('sha256').update(p).digest('hex');
const token = () => crypto.randomBytes(24).toString('hex');
function auth(req,res,next){
  const t=req.headers.authorization?.replace('Bearer ','');
  const uid=sessions.get(t);
  if(!uid) return res.status(401).json({error:'Login required'});
  req.userId=uid; next();
}

app.post('/api/register',(req,res)=>{
  const {name,email,password}=req.body||{};
  if(!name||!email||!password||password.length<6) return res.status(400).json({error:'Name, email and 6+ character password required'});
  try{
    const code='1MIN'+crypto.randomBytes(4).toString('hex').toUpperCase();
    const info=db.prepare('INSERT INTO users(name,email,password_hash,referral_code) VALUES(?,?,?,?)').run(name,email.toLowerCase(),hash(password),code);
    const t=token(); sessions.set(t,info.lastInsertRowid);
    res.json({token:t,user:{id:info.lastInsertRowid,name,email:email.toLowerCase(),points:0,referral_code:code}});
  }catch(e){res.status(400).json({error:'Email already registered'})}
});

app.post('/api/login',(req,res)=>{
  const {email,password}=req.body||{};
  const u=db.prepare('SELECT * FROM users WHERE email=? AND password_hash=?').get((email||'').toLowerCase(),hash(password||''));
  if(!u) return res.status(401).json({error:'Invalid email or password'});
  const t=token(); sessions.set(t,u.id);
  res.json({token:t,user:{id:u.id,name:u.name,email:u.email,points:u.points,referral_code:u.referral_code}});
});

app.get('/api/me',auth,(req,res)=>{
  const u=db.prepare('SELECT id,name,email,points,referral_code FROM users WHERE id=?').get(req.userId);
  res.json({user:u});
});

app.get('/api/tasks',auth,(req,res)=>{
  const rows=db.prepare(`SELECT t.id,t.title,t.description,t.reward,t.active,
  EXISTS(SELECT 1 FROM completions c WHERE c.task_id=t.id AND c.user_id=?) completed
  FROM tasks t WHERE t.active=1 ORDER BY t.id DESC`).all(req.userId);
  res.json({tasks:rows});
});

app.post('/api/tasks/:id/complete',auth,(req,res)=>{
  const t=db.prepare('SELECT * FROM tasks WHERE id=? AND active=1').get(req.params.id);
  if(!t) return res.status(404).json({error:'Task not found'});
  try{
    const tx=db.transaction(()=>{
      db.prepare('INSERT INTO completions(user_id,task_id) VALUES(?,?)').run(req.userId,t.id);
      db.prepare('UPDATE users SET points=points+? WHERE id=?').run(t.reward,req.userId);
    });
    tx();
    const u=db.prepare('SELECT points FROM users WHERE id=?').get(req.userId);
    res.json({points:u.points});
  }catch(e){res.status(409).json({error:'Task already completed'})}
});

app.get('/api/admin/tasks',(req,res)=>res.json({tasks:db.prepare('SELECT * FROM tasks ORDER BY id DESC').all()}));
app.post('/api/admin/tasks',(req,res)=>{
  const {title,description='',reward}=req.body||{};
  if(!title||!Number.isInteger(reward)||reward<1) return res.status(400).json({error:'Invalid task'});
  const x=db.prepare('INSERT INTO tasks(title,description,reward) VALUES(?,?,?)').run(title,description,reward);
  res.json({id:x.lastInsertRowid});
});
app.patch('/api/admin/tasks/:id',(req,res)=>{
  const active=req.body.active?1:0;
  db.prepare('UPDATE tasks SET active=? WHERE id=?').run(active,req.params.id);
  res.json({ok:true});
});
app.get('/api/admin/stats',(req,res)=>{
  const users=db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const completed=db.prepare('SELECT COUNT(*) c FROM completions').get().c;
  const points=db.prepare('SELECT COALESCE(SUM(points),0) s FROM users').get().s;
  const pending=db.prepare("SELECT COUNT(*) c FROM withdrawals WHERE status='Pending'").get().c;
  res.json({users,completed,points,pending});
});

app.post('/api/withdrawals',auth,(req,res)=>{
  const {amount,method,account}=req.body||{};
  if(!Number.isInteger(amount)||amount<100||!method||!account) return res.status(400).json({error:'Minimum withdrawal is 100 points'});
  const u=db.prepare('SELECT points FROM users WHERE id=?').get(req.userId);
  if(u.points<amount) return res.status(400).json({error:'Insufficient points'});
  const tx=db.transaction(()=>{
    db.prepare('UPDATE users SET points=points-? WHERE id=?').run(amount,req.userId);
    db.prepare('INSERT INTO withdrawals(user_id,amount,method,account) VALUES(?,?,?,?)').run(req.userId,amount,method,account);
  }); tx(); res.json({ok:true});
});

app.listen(PORT,()=>console.log(`1Minute Rewards running on http://localhost:${PORT}`));
