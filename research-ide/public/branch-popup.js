import { safeMarkdown } from './markdown.js';
import { sessionRead, sessionWrite } from './browser-session.js';

// Keep popup choice, focus and reading position independent of the main transcript.
export function createBranchPopup({ getConversations, onSelect, onOpen, onSend, onStop, getApproval, onApproval, onClose = () => {} }) {
  const query = selector => document.querySelector(selector);
  let popupChatIds = [];
  let popupChatId = null;
  let composerChatId = null;
  const sending = new Set();
  const composer = query('#popupComposer');
  function saveDraft() {
    if (composerChatId) sessionWrite('draft:' + composerChatId, composer.value);
  }
  function resizeComposer() {
    composer.style.height = 'auto';
    composer.style.height = Math.min(140, Math.max(60, composer.scrollHeight)) + 'px';
  }
  function showError(message = '') {
    query('#popupError').textContent = message;
    query('#popupError').hidden = !message;
  }
  async function submitMessage() {
    const id = popupChatId;
    const chat = getConversations().find(item => item.id === id);
    const text = composer.value.trim();
    if (!chat || chat.busy || sending.has(id) || !text) return;
    sending.add(id);
    composer.value = '';
    saveDraft();
    resizeComposer();
    showError();
    renderBranchPopup();
    let sent = false;
    try {
      sent = await onSend(id, text);
      if (!sent && popupChatId === id) showError('Could not send. Your message has been kept; try again.');
    } catch (error) {
      if (popupChatId === id) showError(error.message || 'Could not send.');
    } finally {
      sending.delete(id);
      if (!sent) {
        if (!sessionRead('draft:' + id)) sessionWrite('draft:' + id, text);
        if (composerChatId === id && !composer.value) { composer.value = sessionRead('draft:' + id); resizeComposer(); }
      }
      renderBranchPopup();
    }
  }

  function renderBranchPopup() {
    const dialog = query('#branchPopup');
    if (!dialog.open) {
      return;
    }
    const chats = popupChatIds.map(id => getConversations().find(chat => chat.id === id)).filter(Boolean);
    const chat = chats.find(chat => chat.id === popupChatId) || chats[0];
    if (!chat) {
      dialog.close();
      return;
    }
    popupChatId = chat.id;
    if (composerChatId !== chat.id) {
      saveDraft();
      composerChatId = chat.id;
      composer.value = sessionRead('draft:' + chat.id);
      resizeComposer();
      showError();
    }
    query('#popupSend').disabled = chat.busy || sending.has(chat.id) || !composer.value.trim();
    query('#popupStop').hidden = !chat.busy;
    query('#popupTurnState').textContent = chat.busy ? 'Agent working…' : '';
    const approval = getApproval();
    query('#popupApprovalBar').hidden = !approval;
    query('#popupApprovalDescription').textContent = approval;
    query('#branchPopupTitle').textContent = chat.title;
    const choices = query('#branchPopupChoices');
    const choiceSignature = JSON.stringify([chats.map(item => [item.id, item.title]), chat.id]);
    if (choices.dataset.signature !== choiceSignature) {
      choices.dataset.signature = choiceSignature;
      choices.replaceChildren();
      if (chats.length > 1) {
        for (const item of chats) {
          const button = document.createElement('button');
          button.className = 'button button-small';
          button.textContent = item.title;
          button.setAttribute('aria-pressed', String(item.id === chat.id));
          button.onclick = () => {
            popupChatId = item.id;
            renderBranchPopup();
          };
          choices.append(button);
        }
      }
    }
    query('#branchPopupQuote').textContent = chat.selectedQuote;
    const transcript = query('#branchPopupTranscript');
    const oldScrollTop = transcript.scrollTop;
    const bottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;
    const signature = JSON.stringify([chat.id, chat.messages, chat.busy]);
    if (transcript.dataset.signature !== signature) {
      const switched = transcript.dataset.chatId !== chat.id;
      transcript.dataset.signature = signature;
      transcript.dataset.chatId = chat.id;
      transcript.replaceChildren();
      for (const message of chat.messages) {
        const article = document.createElement('article');
        article.className = 'chat-message ' + message.role;
        const body = document.createElement('div');
        body.className = message.role === 'assistant' ? 'message-body' : 'message-bubble';
        if (message.role === 'assistant') {
          body.innerHTML = safeMarkdown(message.text || (chat.busy ? 'Thinking…' : ''));
        } else {
          body.textContent = message.text;
        }
        article.append(body);
        transcript.append(article);
      }
      if (!chat.messages.length) {
        transcript.textContent = 'No messages yet. Ask your question below.';
      }
      transcript.scrollTop = switched || bottom ? transcript.scrollHeight : oldScrollTop;
    }
  }

  function openBranchPopup(ids) {
    saveDraft();
    composerChatId = null;
    popupChatIds = ids;
    popupChatId = ids[0];
    onOpen();
    const dialog = query('#branchPopup');
    if (!dialog.open) {
      dialog.showModal();
    }
    renderBranchPopup();
  }

  query('#popupComposerForm').addEventListener('submit', event => { event.preventDefault(); return submitMessage(); });
  composer.addEventListener('input', () => { saveDraft(); resizeComposer(); renderBranchPopup(); });
  composer.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault(); submitMessage();
    }
  });
  query('#popupStop').addEventListener('click', async () => {
    if (await onStop(popupChatId) === false) showError('Could not stop the response. Try again.');
  });
  query('#popupAllowApproval').addEventListener('click', async () => {
    if (await onApproval('allow') === false) showError('Could not send approval. Try again.');
  });
  query('#popupDeclineApproval').addEventListener('click', async () => {
    if (await onApproval('deny') === false) showError('Could not decline approval. Try again.');
  });
  query('#branchPopup').addEventListener('close', () => {
    saveDraft();
    onClose(composerChatId);
    composerChatId = null;
  });
  query('#closeBranchPopup').addEventListener('click', () => query('#branchPopup').close());
  query('#openBranchChat').addEventListener('click', () => {
    if (popupChatId) {
      saveDraft();
      onSelect(popupChatId);
    }
  });
  query('#branchPopup').addEventListener('click', event => {
    if (event.target === query('#branchPopup')) {
      const rect = event.target.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
        event.target.close();
      }
    }
  });
  return {
    open: openBranchPopup,
    render: renderBranchPopup,
    close: () => query('#branchPopup').close(),
    get isOpen() {
      return query('#branchPopup').open;
    }
  };
}
