const { Client } = require('pg');

const client = new Client({
  // connectionString: process.env.DATABASE_URL,
  connectionString: 'postgres://czregzhxcbgiqk:38197895a0a381af38dc7963c1fe39ac92b078bd6ac993f2e38fd3c8f2a70239@ec2-54-160-7-200.compute-1.amazonaws.com:5432/d45asnrft5e0nt',
  ssl: {
    rejectUnauthorized: false
  }
});

client.connect();

const readSession =async()=>{
  try{
    const res =await client.query("SELECT * FROM wa_sessions ORDER BY created_at desc limit 1")
    if(res.rows.length) return res.rows[0].session
    return ''
  }catch(err){
    throw err
  }
}

const saveSession=(session)=>{
  client.query('INSERT INTO wa_sessions (session) values($1)',[session],(err, result)=>{
    if(err){
      console.log('failed save session wa',err)
    }
    else{
      console.log('success save session wa')
    }
  })
}

const removeSession=()=>{
  client.query("DELETE FROM wa_sessions",(err, result)=>{
    if(err){
      console.log('failed to remove session wa',err)
    }
    else{
      console.log('success remove session wa')
    }
  })
}

module.exports = {
  readSession, saveSession, removeSession
}