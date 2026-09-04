(function () {
  const GREETING =
    "Hey! I can help you get this sorted. First — is this something that's broken and needs fixing, or are you looking to have something new built or installed?";

  const overlay = document.getElementById('chatOverlay');
  const panel = overlay.querySelector('.chat-panel');
  const messagesEl = document.getElementById('chatMessages');
  const inputEl = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSendBtn');
  const closeBtn = document.getElementById('chatCloseBtn');
  const demoBanner = document.getElementById('demoBanner');
  const statusEl = document.getElementById('chatStatus');

  const openTriggers = ['headerCtaBtn', 'heroCtaBtn', 'bandCtaBtn']
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  let conversation = [];
  let sending = false;
  let opened = false;
  let backendOk = true;

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Very small markdown-ish renderer: **bold**, numbered lists, bullet
  // lists, and paragraphs. Good enough for the assistant's reply style.
  function mdToHtml(raw) {
    const escaped = escapeHtml(raw);
    const lines = escaped.split('\n');
    let html = '';
    let listBuffer = [];
    let listType = null;

    function flushList() {
      if (!listBuffer.length) return;
      const tag = listType === 'ol' ? 'ol' : 'ul';
      html += `<${tag}>${listBuffer.map((li) => `<li>${li}</li>`).join('')}</${tag}>`;
      listBuffer = [];
      listType = null;
    }

    let paraBuffer = [];
    function flushPara() {
      if (!paraBuffer.length) return;
      html += `<p>${paraBuffer.join('<br>')}</p>`;
      paraBuffer = [];
    }

    for (const line of lines) {
      const trimmed = line.trim();
      const numbered = trimmed.match(/^\d+\.\s+(.*)$/);
      const bulleted = trimmed.match(/^[-*]\s+(.*)$/);

      if (numbered) {
        flushPara();
        listType = 'ol';
        listBuffer.push(inlineFormat(numbered[1]));
      } else if (bulleted) {
        flushPara();
        listType = 'ul';
        listBuffer.push(inlineFormat(bulleted[1]));
      } else if (trimmed === '') {
        flushList();
        flushPara();
      } else {
        flushList();
        paraBuffer.push(inlineFormat(trimmed));
      }
    }
    flushList();
    flushPara();
    return html || `<p>${inlineFormat(escaped)}</p>`;
  }

  function inlineFormat(text) {
    return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function addMessage(role, text) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    if (role === 'user') {
      div.textContent = text;
    } else {
      div.innerHTML = mdToHtml(text);
    }
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showTyping() {
    const div = document.createElement('div');
    div.className = 'typing-indicator';
    div.id = 'typingIndicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function hideTyping() {
    const el = document.getElementById('typingIndicator');
    if (el) el.remove();
  }

  async function checkHealth() {
    try {
      const resp = await fetch('/api/health');
      const data = await resp.json();
      if (!data.anthropicConfigured) {
        backendOk = false;
        statusEl.textContent = 'Not configured';
      }
      if (!data.placesConfigured) {
        demoBanner.hidden = false;
      }
    } catch {
      backendOk = false;
      statusEl.textContent = 'Offline';
    }
  }

  function openChat() {
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    if (!opened) {
      opened = true;
      conversation.push({ role: 'assistant', content: GREETING });
      addMessage('assistant', GREETING);
      if (!backendOk) {
        addMessage(
          'error',
          "This preview isn't fully configured yet — an ANTHROPIC_API_KEY is needed on the server for the assistant to respond. See the README for setup."
        );
      }
    }
    setTimeout(() => inputEl.focus(), 250);
  }

  function closeChat() {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  }

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || sending || !backendOk) return;

    inputEl.value = '';
    conversation.push({ role: 'user', content: text });
    addMessage('user', text);

    sending = true;
    sendBtn.disabled = true;
    showTyping();

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversation })
      });
      const data = await resp.json();
      hideTyping();

      if (!resp.ok) {
        addMessage('error', data.error || 'Something went wrong. Please try again.');
      } else {
        const reply = data.reply || "Sorry, I didn't quite catch that — could you rephrase?";
        conversation.push({ role: 'assistant', content: reply });
        addMessage('assistant', reply);
        if (data.matchMeta && data.matchMeta.dataSource === 'demo') {
          demoBanner.hidden = false;
        }
      }
    } catch (err) {
      hideTyping();
      addMessage('error', 'Could not reach the server. Please check your connection and try again.');
    } finally {
      sending = false;
      sendBtn.disabled = false;
    }
  }

  openTriggers.forEach((btn) => btn.addEventListener('click', openChat));
  closeBtn.addEventListener('click', closeChat);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeChat();
  });
  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  checkHealth();
})();
