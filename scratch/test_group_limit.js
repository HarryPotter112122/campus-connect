const fs = require('fs');

async function run() {
  // Assume users 1 to 25 are already created
  let groupRes = await fetch('http://localhost:3001/api/conversations/group', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': "connect.sid=..." }, // we'll fetch a fresh cookie
    body: JSON.stringify({ 
      name: `Bypass Group ${Date.now()}`, 
      memberIds: [] 
    })
  });
}
