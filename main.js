const fs = require('fs');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const CONFIG = {
  API_BASE_URL: 'https://api1-pp.klokapp.ai/v1',
  CHAT_INTERVAL: 60000,
  MESSAGES_FILE: 'questions.txt' // File containing your custom messages
};

function loadAccounts() {
  try {
    const raw = fs.readFileSync('tokens.json', 'utf8');
    const accounts = JSON.parse(raw);

    if (!Array.isArray(accounts) || accounts.length === 0) {
      throw new Error("tokens.json is empty or in the wrong format");
    }

    for (const acc of accounts) {
      if (!acc.token || !acc.ai_id) {
        throw new Error("Each account must have a 'token' and an 'ai_id'");
      }
    }

    return accounts;
  } catch (err) {
    console.error('[ERROR] Failed to read tokens.json:', err.message);
    process.exit(1);
  }
}

function loadMessages() {
  try {
    const raw = fs.readFileSync(CONFIG.MESSAGES_FILE, 'utf8');
    const messages = raw.split('\n').map(m => m.trim()).filter(Boolean);

    if (messages.length === 0) {
      throw new Error("questions.txt is empty");
    }

    return messages;
  } catch (err) {
    console.error('[ERROR] Failed to read questions.txt:', err.message);
    process.exit(1);
  }
}

const RANDOM_MESSAGES = loadMessages();

function createApiClient(token) {
  return axios.create({
    baseURL: CONFIG.API_BASE_URL,
    headers: {
      'x-session-token': token,
      'user-agent': 'Mozilla/5.0',
      'accept': '*/*',
      'origin': 'https://klokapp.ai',
      'referer': 'https://klokapp.ai/'
    }
  });
}

function getRandomMessage() {
  const i = Math.floor(Math.random() * RANDOM_MESSAGES.length);
  return RANDOM_MESSAGES[i];
}

async function checkPoints(client, label) {
  try {
    const res = await client.get('/points');
    const p = res.data;
    console.log(`[${label}] 🔹 Points: ${p.points} | Referral: ${p.referral_points} | Total: ${p.total_points}`);
    return p;
  } catch (err) {
    console.error(`[${label}] Failed to check points:`, err.response?.data || err.message);
    return null;
  }
}

async function getThreads(client, label) {
  try {
    const res = await client.get('/threads');
    return res.data.data || [];
  } catch (err) {
    console.error(`[${label}] Failed to get threads:`, err.response?.data || err.message);
    return [];
  }
}

async function createThread(client, message, label) {
  const data = {
    title: "New Chat",
    messages: [{ role: "user", content: message }],
    sources: null,
    id: uuidv4(),
    dataset_id: "34a725bc-3374-4042-9c37-c2076a8e4c2b",
    created_at: new Date().toISOString()
  };

  try {
    const res = await client.post('/threads', data);
    console.log(`[${label}] 🆕 New thread: ${res.data.id}`);
    return res.data;
  } catch (err) {
    console.error(`[${label}] Failed to create thread:`, err.response?.data || err.message);
    return null;
  }
}

async function sendMessage(client, threadId, ai_id, message, label) {
  const data = {
    id: threadId,
    ai_id: ai_id,
    title: "New Chat",
    messages: [{ role: "user", content: message }],
    sources: [],
    model: "llama-3.3-70b-instruct",
    created_at: new Date().toISOString(),
    language: "english"
  };

  try {
    await client.post('/chat', data);
    console.log(`[${label}] ✅ Message sent to thread ${threadId}`);
    return true;
  } catch (err) {
    if (err.message.includes('stream has been aborted')) {
      console.warn(`[${label}] Stream aborted, likely still sent`);
      return true;
    }
    console.error(`[${label}] Failed to send message:`, err.response?.data || err.message);
    return false;
  }
}

async function runBot({ token, ai_id }, index) {
  const label = `Account-${index + 1}`;
  const client = createApiClient(token);
  let currentThreadId = null;

  await checkPoints(client, label);

  const threads = await getThreads(client, label);
  if (threads.length > 0) {
    currentThreadId = threads[0].id;
    console.log(`[${label}] Using old thread: ${currentThreadId}`);
  } else {
    const newThread = await createThread(client, "Starting a new conversation", label);
    if (newThread) currentThreadId = newThread.id;
  }

  setInterval(async () => {
    if (!currentThreadId) {
      const newThread = await createThread(client, "New conversation because the previous one failed", label);
      if (newThread) {
        currentThreadId = newThread.id;
      } else {
        return;
      }
    }

    const points = await checkPoints(client, label);
    if (!points || points.total_points <= 0) {
      console.log(`[${label}] ⏸ No points available. Waiting...`);
      return;
    }

    const message = getRandomMessage();
    const sent = await sendMessage(client, currentThreadId, ai_id, message, label);
    if (!sent) {
      currentThreadId = null;
    }
  }, CONFIG.CHAT_INTERVAL);
}

async function main() {
  console.log('\n🚀 Running KLOK Multi-Account Bot...\n');
  const accounts = loadAccounts();

  accounts.forEach((account, index) => {
    runBot(account, index);
  });
}

main();
