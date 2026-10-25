import { safeMarkdown } from './markdown.js';

// Keep popup choice, focus and reading position independent of the main transcript.
export function createBranchPopup({ getConversations, onSelect, onOpen }) {
  const query = selector => document.querySelector(selector);
  let popupChatIds = [];
  let popupChatId = null;

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
        transcript.textContent = 'No messages yet. Open this chat to ask your question.';
      }
      transcript.scrollTop = switched || bottom ? transcript.scrollHeight : oldScrollTop;
    }
  }

  function openBranchPopup(ids) {
    popupChatIds = ids;
    popupChatId = ids[0];
    onOpen();
    const dialog = query('#branchPopup');
    if (!dialog.open) {
      dialog.showModal();
    }
    renderBranchPopup();
  }

  query('#closeBranchPopup').addEventListener('click', () => query('#branchPopup').close());
  query('#openBranchChat').addEventListener('click', () => {
    if (popupChatId) {
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
