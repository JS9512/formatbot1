const AL_ID = parseInt(process.env.TGADMIN);

class BotHelper {
  constructor(bot) {
    this.bot = bot;
  }

  isAdmin(chatId) {
    return chatId === AL_ID;
  }

  botMes(chatId, text, mark = true) {
    let opts = {};
    if (parseInt(chatId, 10) < 0 && mark) {
      opts = { parseMode: 'Markdown' };
    }
    return this.bot.sendMessage(chatId, text, opts).
        catch(e => {
          console.log(e, chatId, text);
          return this.sendAdmin(JSON.stringify(e));
        });
  }

  sendAdmin(text) {
    this.botMes(AL_ID, `service: ${text}`);
  }

  sendToUser(text, uid, mark = true) {
    return this.botMes(uid || AL_ID, text, mark);
  }
}

module.exports = BotHelper;