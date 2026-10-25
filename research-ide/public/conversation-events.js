/**
 * Reconcile a server event with the local conversation, returning the affected
 * chat (or null). DOM rendering and state refreshes belong to the controller.
 * Messages may already exist because sending renders an optimistic placeholder.
 */
export function applyConversationEvent(conversations, event, createMessageId) {
  const chat = conversations.find(item => item.id === event.chatId);
  if (!chat) {
    return null;
  }

  switch (event.type) {
    case 'message-started': {
      const message = [...chat.messages].reverse().find(item => (
        item.role === 'assistant' && item.status === 'streaming' && !item.turnId
      ));
      if (message) {
        message.id = event.assistantMessageId;
        message.turnId = event.turnId;
      }
      return chat;
    }

    case 'agent-delta': {
      let message = [...chat.messages].reverse().find(item => (
        item.role === 'assistant' && (!item.turnId || item.turnId === event.turnId)
      ));
      if (!message) {
        message = {
          id: event.messageId || createMessageId(),
          role: 'assistant',
          text: '',
          turnId: event.turnId,
          status: 'streaming'
        };
        chat.messages.push(message);
      }
      message.turnId = event.turnId;
      message.text += event.delta || '';
      message.status = 'streaming';
      return chat;
    }

    case 'turn-completed': {
      chat.busy = false;
      const message = [...chat.messages].reverse().find(item => (
        item.role === 'assistant' && (!event.turnId || item.turnId === event.turnId)
      ));
      if (message) {
        if (event.status === 'completed') {
          message.status = 'complete';
        } else if (event.status === 'interrupted') {
          message.status = 'stopped';
        } else {
          message.status = 'error';
        }
      }
      return chat;
    }

    default:
      return null;
  }
}
