const fs = require('fs');
const { io } = require('../client/node_modules/socket.io-client');
const crypto = require('crypto');

async function run() {
  const users = [];
  console.log("Creating 50 users...");
  for (let x = 1; x <= 50; x++) {
    const email = `user${x}@gmail.com`;
    const password = `user6225${x}`;
    const username = `user_${x}`;
    const name = `User ${x}`;

    let res = await fetch('http://localhost:3001/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, username, name })
    });
    let data = await res.json();
    
    if (res.status === 409) {
      res = await fetch('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      data = await res.json();
    }

    if (res.ok) {
      users.push({ id: data.user.id, email, username, cookie: res.headers.get('set-cookie') });
    }
  }
  console.log(`Successfully created/logged in ${users.length} users.`);

  if (users.length < 50) return console.error("Failed to create all users");

  // Create a group with user1 and users 2-20 (limit is 20)
  // Wait, the code says:
  // if (uniqueIds.length + 1 > 20) { return res.status(400).json({ error: 'Group cannot have more than 20 members' }); }
  // So I can only add 19 other users. That's fine.
  console.log("Creating Group...");
  let groupRes = await fetch('http://localhost:3001/api/conversations/group', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': users[0].cookie },
    body: JSON.stringify({ 
      name: `Mega Group ${Date.now()}`, 
      memberIds: users.slice(1, 20).map(u => u.id)
    })
  });
  let groupData = await groupRes.json();
  if (!groupRes.ok) return console.error("Group creation failed:", groupData);
  const groupId = groupData.conversation.id;
  console.log("Group created:", groupId);

  // Connect socket for user 1
  const socket = io('http://localhost:3001', {
    extraHeaders: { Cookie: users[0].cookie }
  });

  await new Promise(resolve => socket.on('connect', resolve));
  console.log("User 1 socket connected.");

  // Send 60 messages to the group
  console.log("Sending 60 messages quickly...");
  for (let i = 1; i <= 60; i++) {
    socket.emit('message:send', {
      conversationId: groupId,
      clientMessageId: crypto.randomUUID(),
      content: `Message number ${i}`
    });
  }

  // Wait a bit for server to process them
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log("Testing Pagination...");
  // Now User 2 fetches messages
  let msgsRes = await fetch(`http://localhost:3001/api/conversations/${groupId}/messages`, {
    headers: { 'Cookie': users[1].cookie }
  });
  let page1 = await msgsRes.json();
  console.log(`Page 1 fetched ${page1.messages.length} messages.`);
  
  if (page1.messages.length > 0) {
    const oldestMessage = page1.messages[0]; // because it was reversed in the endpoint: messages.reverse()
    // Wait, let's verify if reverse made the oldest at index 0.
    // ORDER BY created_at DESC, id DESC LIMIT 50 => Reverse => Oldest is at index 0, newest is at index 49.
    const cursor = oldestMessage.created_at;
    console.log(`Fetching Page 2 with cursor = ${cursor}`);

    let msgsRes2 = await fetch(`http://localhost:3001/api/conversations/${groupId}/messages?cursor=${encodeURIComponent(cursor)}`, {
      headers: { 'Cookie': users[1].cookie }
    });
    let page2 = await msgsRes2.json();
    console.log(`Page 2 fetched ${page2.messages.length} messages.`);
    
    if (page1.messages.length + page2.messages.length < 60) {
      console.log("BUG CONFIRMED: Messages were lost due to pagination cursor being based only on second-precision created_at!");
    } else {
      console.log("Pagination worked fine (this shouldn't happen unless created_at spanned multiple seconds perfectly).");
    }
  }

  socket.disconnect();
  process.exit(0);
}
run();
