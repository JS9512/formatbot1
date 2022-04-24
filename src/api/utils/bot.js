const fs = require('fs');

const TG_ADMIN = parseInt(process.env.TGADMIN, 10);
const OFF = 'Off';
const ON = 'On';

const PARSE_MODE_MARK = 'Markdown';

const INLINE_TITLE = 'InstantView created. Click me to send';
const BANNED_ERROR = 'USER_BANNED_IN_CHANNEL';
const RIGHTS_ERROR = 'need administrator rights in the channel chat';

class BotHelper {
  constructor(bot) {
    this.bot = bot;
    let c = {no_puppet: false};
    try {
      c = JSON.parse(`${fs.readFileSync('.conf/config.json')}`);
    } catch (e) {
      //
    }
    this.config = c;
    this.tgAdmin = TG_ADMIN;
  }

  isAdmin(chatId) {
    return chatId === this.tgAdmin;
  }

  botMes(chatId, text, mark = true) {
    let opts = {};
    if (mark) {
      opts = {parse_mode: PARSE_MODE_MARK};
    }
    return this.bot
      .sendMessage(chatId, text, opts)
      .catch(e => this.sendError(e, `${chatId}${text}`));
  }

  sendAdmin(textParam, chatIdParam = '', mark = false) {
    let chatId = chatIdParam;
    let text = textParam;
    let opts = {};
    if (mark === true) {
      opts = {
        parse_mode: PARSE_MODE_MARK,
        disable_web_page_preview: true,
      };
    }
    if (!chatId) {
      chatId = TG_ADMIN;
    }
    if (`${chatId}` === `${this.tgAdmin}`) {
      text = `service: ${text}`;
    }
    return this.bot.sendMessage(chatId, text, opts).catch(() => {});
  }

  sendAdminOpts(text, opts) {
    const chatId = process.env.TGGROUPBUGS || TG_ADMIN;
    return this.bot.sendMessage(chatId, text, opts).catch(() => {});
  }

  sendInline({title, messageId, ivLink}) {
    let inlineTitle = title;
    if (!title) {
      inlineTitle = INLINE_TITLE;
    }
    const queryResult = {
      type: 'article',
      id: messageId,
      title: inlineTitle,
      input_message_content: {message_text: ivLink},
    };

    return this.bot.answerInlineQuery(messageId, [queryResult]);
  }

  sendAdminMark(text, chatId) {
    return this.sendAdmin(text, chatId, true);
  }

  getParams(hostname, chatId, force) {
    const params = {};
    const contentSelector =
      force === 'content' || this.getConf(`${hostname}_content`);
    if (contentSelector) {
      params.content = contentSelector;
    }
    const puppetOnly = force === 'puppet' || this.getConf(`${hostname}_puppet`);
    if (puppetOnly) {
      params.isPuppet = true;
    }
    const customOnly = force === 'custom' || this.getConf(`${hostname}_custom`);
    if (customOnly) {
      params.isCustom = true;
    }
    const wget = force === 'wget' || this.getConf(`${hostname}_wget`);
    if (wget) {
      params.isWget = true;
    }
    const cached = force === 'cached' || this.getConf(`${hostname}_cached`);
    if (cached) {
      params.isCached = true;
    }
    const scroll = this.getConf(`${hostname}_scroll`);
    if (scroll) {
      params.scroll = scroll;
    }
    const noLinks =
      force === 'no_links' || this.getConf(`${hostname}_no_links`);
    if (noLinks) {
      params.noLinks = true;
    }
    const pcache = force === 'p_cache';
    if (pcache) {
      params.isCached = true;
      params.cachefile = 'puppet.html';
      params.content = this.getConf('p_cache_content');
    }
    if (this.isAdmin(chatId)) {
      if (this.getConf('test_puppet')) {
        params.isPuppet = true;
      }
      if (this.getConf('test_custom')) {
        params.isCustom = true;
      }
    }
    return params;
  }

  getConf(param) {
    let c = this.config[param] || '';
    if (c === OFF) c = '';
    return c;
  }

  togglecConfig(msg) {
    const params = msg.text.replace('/cconfig', '').trim();
    if (!params || !this.isAdmin(msg.chat.id)) {
      return Promise.resolve('no param or forbidden');
    }
    const {param, content} = this.parseConfig(params);
    const c = {};
    c[param] = content;
    fs.writeFileSync(`.conf/custom/${param}.json`, JSON.stringify(c));
    return false;
  }

  parseConfig(params) {
    let content;
    let param;
    const c = params.replace(' _content', '_content').split(/\s/);
    if (c.length === 2) {
      [param] = c;
      content = c[1].replace(/~/g, ' ');
    } else {
      [param] = c;
      if (this.config[param] === ON) {
        content = OFF;
      } else {
        content = ON;
      }
    }
    return {param, content};
  }

  toggleConfig(msg) {
    const params = msg.text.replace('/config', '').trim();
    if (!params || !this.isAdmin(msg.chat.id)) {
      return Promise.resolve('no param or forbidden');
    }

    const {param, content} = this.parseConfig(params);
    this.config[param] = content;
    fs.writeFileSync('.conf/config.json', JSON.stringify(this.config));
    return this.botMes(TG_ADMIN, content, false);
  }

  sendError(error, text = '') {
    let e = error;
    if (typeof e === 'object' && !global.isDevEnabled) {
      if (e.response && typeof e.response === 'object') {
        e = e.response.description || 'unknown error';
        if (e.match(BANNED_ERROR) || e.match(RIGHTS_ERROR)) {
          return;
        }
      }
    } else {
      e = `error: ${JSON.stringify(e)} ${e.toString()} ${text}`;
    }

    return this.sendAdmin(e);
  }

  disDb() {
    this.db = false;
  }

  setBlacklist(f) {
    this.bllist = fs.readFileSync(f).toString() || '';
  }

  isBlackListed(h) {
    return this.bllist && this.bllist.match(h);
  }

  forward(mid, from, to) {
    return this.bot.forwardMessage(to, from, mid).catch(() => {});
  }

  sendIV(chatId, messageId, inlineMessageId, messageText, extra) {
    let text = messageText;
    if (extra && extra.parse_mode === PARSE_MODE_MARK) {
      text = text.replace(/[*`]/gi, '');
    }
    return this.bot
      .editMessageText(chatId, messageId, inlineMessageId, text, extra)
      .catch(() => {});
  }

  delMessage(chatId, messageId) {
    return this.bot.deleteMessage(chatId, messageId).catch(() => {});
  }

  // eslint-disable-next-line class-methods-use-this
  markdown() {
    return PARSE_MODE_MARK;
  }
}

module.exports = BotHelper;
