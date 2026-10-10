const fs = require('fs');

async function testFeatures() {
  const users = [];
  const log = [];
  
  function record(action, result, error = null) {
    const entry = { action, result, error };
    log.push(entry);
    console.log(`[${action}]`, result, error || '');
  }

  try {
    for (let x = 1; x <= 5; x++) {
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

      if (!res.ok) {
        record(`Create/Login user${x}`, 'Failed', data);
        continue;
      }
      
      const cookie = res.headers.get('set-cookie');
      users.push({ id: data.user.id, email, username, cookie });
      record(`Create/Login user${x}`, 'Success');
    }

    if (users.length < 5) {
      console.log('Failed to create/login users. Aborting.');
      return;
    }

    let searchRes = await fetch('http://localhost:3001/api/users?search=user_2', {
      headers: { 'Cookie': users[0].cookie }
    });
    let searchData = await searchRes.json();
    if (searchRes.ok && searchData.users.length > 0) {
      record('Search User', 'Success');
    } else {
      record('Search User', 'Failed', searchData);
    }

    let editRes = await fetch('http://localhost:3001/api/users/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Cookie': users[0].cookie },
      body: JSON.stringify({ bio: 'Hello from User 1!' })
    });
    record('Edit Profile', editRes.ok ? 'Success' : 'Failed', editRes.ok ? null : await editRes.json());

    let dmRes = await fetch('http://localhost:3001/api/conversations/direct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': users[0].cookie },
      body: JSON.stringify({ targetUserId: users[1].id })
    });
    let dmData = await dmRes.json();
    record('Create DM', dmRes.ok ? 'Success' : 'Failed', dmData);

    let groupRes = await fetch('http://localhost:3001/api/conversations/group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': users[0].cookie },
      body: JSON.stringify({ name: 'Test Group', memberIds: [users[1].id, users[2].id] })
    });
    let groupData = await groupRes.json();
    record('Create Group', groupRes.ok ? 'Success' : 'Failed', groupData);

    let group2Res = await fetch('http://localhost:3001/api/conversations/group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': users[0].cookie },
      body: JSON.stringify({ name: 'Test Group', memberIds: [users[3].id, users[4].id] })
    });
    let group2Data = await group2Res.json();
    record('Create Group 2 (Same Name)', group2Res.ok ? 'Success' : 'Failed', group2Data);
    
    if (group2Res.ok) {
      let membersRes = await fetch(`http://localhost:3001/api/conversations/${group2Data.conversation.id}/members`, {
        headers: { 'Cookie': users[0].cookie }
      });
      let membersData = await membersRes.json();
      record('Group 2 Members', membersRes.ok ? 'Success' : 'Failed', membersData);
    }

    fs.writeFileSync('test_results.json', JSON.stringify(log, null, 2));
    console.log('Test completed. Results in test_results.json');
    
  } catch (err) {
    console.error('Error during tests:', err);
  }
}

testFeatures();
