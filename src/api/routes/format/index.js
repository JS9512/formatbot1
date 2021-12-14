const url = require('url');

const keyboards = require('../../../keyboards/keyboards');
const messages = require('../../../messages/format');
const db = require('../../utils/db');
const logger = require('../../utils/logger');
const ivMaker = require('../../utils/ivMaker');
const puppet = require('../../utils/puppet');
const {check, timeout, checkData} = require('../../utils');
const {getAllLinks, getLinkFromEntity, getLink} = require('../../utils/links');

const {validRegex} = require('../../../config/config.json');

const rabbitmq = require('../../../service/rabbitmq');

const group = process.env.TGGROUP;
const groupBugs = process.env.TGGROUPBUGS;

const IV_MAKING_TIMEOUT = +(process.env.IV_MAKING_TIMEOUT || 60);
const IV_CHAN_ID = +process.env.IV_CHAN_ID;
const IV_CHAN_MID = +process.env.IV_CHAN_MID;
const USERIDS = (process.env.USERIDS || '').split(',');

rabbitmq.startChannel();
global.lastIvTime = +new Date();
const supportLinks = [process.env.SUP_LINK];
for (let i = 1; i < 10; i += 1) {
  if (process.env[`SUP_LINK${i}`]) {
    supportLinks.push(process.env[`SUP_LINK${i}`]);
  }
}

const support = async (ctx, botHelper) => {
  let system = JSON.stringify(ctx.message.from);
  const {
    chat: {id: chatId},
  } = ctx.message;

  if (USERIDS.length && USERIDS.includes(`${chatId}`)) {
    return;
  }
  try {
    const hide = Object.create(keyboards.hide());
    await ctx.reply(messages.support(supportLinks), {
      hide,
      disable_web_page_preview: true,
      parse_mode: 'Markdown',
    });

    if (IV_CHAN_MID) {
      botHelper.forward(IV_CHAN_MID, IV_CHAN_ID * -1, chatId);
    }
  } catch (e) {
    system = `${e}${system}`;
  }
  botHelper.sendAdmin(`support ${system}`);
};

const startOrHelp = (ctx, botHelper) => {
  if (!ctx.message) {
    // return botHelper.sendAdmin(JSON.stringify(ctx.update));
    const {
      chat: {id: chatId},
    } = ctx.message;
    if (USERIDS.length && USERIDS.includes(`${chatId}`)) {
      return;
    }
  } else {
    const {
      chat: {id: chatId},
    } = ctx.message;
    if (USERIDS.length && USERIDS.includes(`${chatId}`)) {
      return;
    }
  }
  let system = JSON.stringify(ctx.message.from);
  try {
    ctx.reply(messages.start(), keyboards.start());
  } catch (e) {
    system = `${e}${system}`;
  }

  // eslint-disable-next-line consistent-return
  return botHelper.sendAdmin(system);
};

const broadcast = (ctx, botHelper) => {
  const {
    chat: {id: chatId},
    text,
  } = ctx.message;
  if (!botHelper.isAdmin(chatId) || !text) {
    return;
  }

  db.processBroadcast(text, ctx, botHelper);
};

const format = (bot, botHelper) => {
  bot.command(['/start', '/help'], ctx => startOrHelp(ctx, botHelper));
  bot.command(['/createBroadcast', '/startBroadcast'], ctx =>
    broadcast(ctx, botHelper),
  );
  bot.hears('👋 Help', ctx => startOrHelp(ctx, botHelper));
  bot.hears('👍Support', ctx => support(ctx, botHelper));
  bot.command('support', ctx => support(ctx, botHelper));
  bot.hears('⌨️ Hide keyboard', ctx => {
    try {
      ctx.reply('Type /help to show.', keyboards.hide());
    } catch (e) {
      botHelper.sendError(e);
    }
  });

  bot.on('inline_query', async msg => {
    const {id} = msg.update.inline_query;
    let {query} = msg.update.inline_query;
    query = query.trim();
    const links = getAllLinks(query);
    if (links.length === 0) {
      const res = {
        type: 'article',
        id,
        title: 'Links not found',
        cache_time: 0,
        is_personal: true,
        input_message_content: {message_text: 'Links not found'},
      };
      return msg.answerInlineQuery([res]).catch(() => {});
    }
    const ivObj = await db.getIV(links[0]);
    if (ivObj && ivObj.iv) {
      return botHelper
        .sendInline({
          messageId: id,
          ivLink: ivObj.iv,
        })
        .catch(e => logger(e));
    }
    const exist = await db.getInine(links[0]);
    const res = {
      type: 'article',
      id,
      title: "Waiting for InstantView... Type 'Any symbol' to check",
      input_message_content: {message_text: links[0]},
    };
    if (!exist) {
      await rabbitmq
        .addToQueue({
          message_id: id,
          chatId: msg.from.id,
          link: links[0],
          inline: true,
        })
        .catch(() => {});
    }
    return msg
      .answerInlineQuery([res], {cache_time: 60, is_personal: true})
      .catch(() => {});
  });

  bot.action(/.*/, async ctx => {
    const [data] = ctx.match;
    logger('action');
    const s = data === 'no_img';
    if (s) {
      const {message} = ctx.update.callback_query;
      // eslint-disable-next-line camelcase
      const {message_id, chat, entities} = message;
      const rabbitMes = {message_id, chatId: chat.id, link: entities[1].url};
      await rabbitmq
        .addToQueue(rabbitMes, rabbitmq.chanPuppet())
        .catch(() => {});
      return;
    }
    const resolveDataMatch = data.match(/^r_([0-9]+)_([0-9]+)/);
    if (resolveDataMatch) {
      const [, msgId, userId] = resolveDataMatch;
      const extra = {reply_to_message_id: msgId};
      let error = '';
      try {
        await bot.telegram
          .sendMessage(userId, messages.resolved(), extra)
          .catch(() => {});
      } catch (e) {
        error = JSON.stringify(e);
      }
      const {
        // eslint-disable-next-line camelcase
        update: {callback_query},
      } = ctx;
      const {
        // eslint-disable-next-line camelcase
        message: {text, message_id},
        from, // eslint-disable-next-line camelcase
      } = callback_query;
      const RESULT = `${text}\nResolved! ${error}`;
      await bot.telegram
        .editMessageText(from.id, message_id, null, RESULT)
        .catch(console.log);
    }
  });

  const addToQueue = async ctx => {
    try {
      const {update} = ctx;
      let {message} = ctx;
      if (
        message &&
        message.text &&
        message.text.match(/(createBroadcast|startBroadcast)/)
      ) {
        broadcast(ctx, botHelper);
        return;
      }
      let isChanMesId = false;
      if (update && update.channel_post) {
        logger('chp');
        message = update.channel_post;
      }

      const {reply_to_message: rplToMsg, caption_entities: cEntities} =
        message || {};
      if (rplToMsg || message.audio) {
        return;
      }
      let {entities} = message;

      const msg = message;
      if (update && update.channel_post) {
        isChanMesId = msg.message_id;
      }
      const {
        chat: {id: chatId},
        caption,
      } = msg;
      let {text} = msg;
      const isAdm = botHelper.isAdmin(chatId);
      const rpl = rplToMsg;
      if (msg.document || (rpl && rpl.document)) {
        return;
      }

      if (caption) {
        text = caption;
        if (cEntities) {
          entities = cEntities;
        }
      }
      if (msg && text) {
        try {
          const force = isAdm && check(text);
          let links = getAllLinks(text);
          let link = links[0];
          if (!link && entities) {
            links = getLinkFromEntity(entities, text);
          }
          link = getLink(links);
          if (!link) {
            logger('no link');
            return;
          }
          const parsed = url.parse(link);
          if (link.match(/^(https?:\/\/)?(www.)?google/)) {
            const l = link.match(/url=(.*?)($|&)/);
            if (l && l[1]) link = decodeURIComponent(l[1]);
          }
          if (link.match(new RegExp(validRegex))) {
            ctx
              .reply(messages.showIvMessage('', link, link), {
                parse_mode: 'Markdown',
              })
              .catch(e => botHelper.sendError(e));
            return;
          }
          if (link.match(/^https?:\/\/t\.me\//)) {
            return;
          }
          if (!parsed.pathname) {
            return;
          }
          const res =
            (await ctx.reply('Waiting for instantView...').catch(() => {})) ||
            {};
          const messageId = res && res.message_id;
          await timeout(0.1);
          if (!messageId) {
            logger('no messageId');
            return;
          }
          const rabbitMes = {
            message_id: messageId,
            chatId,
            link,
            isChanMesId,
          };
          if (force) {
            rabbitMes.force = force;
          }
          let newIvTime = +new Date();
          newIvTime = (newIvTime - global.lastIvTime) / 1000;
          if (newIvTime > 3600) {
            global.lastIvTime = +new Date();
            botHelper.sendAdmin(`alert ${newIvTime} sec`);
          }
          await rabbitmq.addToQueue(rabbitMes);
        } catch (e) {
          botHelper.sendError(e).catch(() => {});
        }
      }
    } catch (e) {
      // console.log(e);
      botHelper.sendError(e).catch(() => {});
    }
  };
  bot.on('channel_post', ctx => addToQueue(ctx));
  bot.hears(/.*/, ctx => addToQueue(ctx));
  bot.on('message', ctx => addToQueue(ctx));

  let browserWs = null;
  if (!botHelper.config.no_puppet && !process.env.NOPUPPET) {
    puppet.getBrowser().then(ws => {
      browserWs = ws;
    });
  }
  const jobMessage = async task => {
    const {chatId, message_id: messageId, q, force, isChanMesId, inline} = task;
    let {link} = task;
    if (link.match(/^https?:\/\/t\.me\//)) {
      return;
    }
    let error = '';
    let isBroken = false;
    const resolveMsgId = false;
    let ivLink = '';
    let skipTimer = 0;
    try {
      let RESULT;
      let TITLE = '';
      let isFile = false;
      let linkData = '';
      let timeOutLink = false;
      try {
        logger(`db is ${botHelper.db}`);
        logger(`queue job ${q}`);
        let params = rabbitmq.getParams(q);
        const isAdm = botHelper.isAdmin(chatId);
        if (isAdm) {
          params.isadmin = true;
        }
        rabbitmq.time(q, true);
        link = ivMaker.parse(link);
        const {isText, url: baseUrl} = await ivMaker.isText(link, force);
        if (baseUrl !== link) link = baseUrl;
        if (!isText) {
          isFile = true;
        } else {
          const {hostname} = url.parse(link);
          logger(hostname);
          logger(link);
          checkData(hostname.match('djvu'));
          clearInterval(skipTimer);
          if (process.env.SKIP_ITEMS === '1') {
            // eslint-disable-next-line no-throw-literal
            throw 1;
          }
          if (global.skipCount) {
            global.skipCount -= 1;
            timeOutLink = true;
            checkData(1, `skip links buffer ${global.skipCount}`);
          }
          checkData(botHelper.isBlackListed(hostname), 'BlackListed');

          const botParams = botHelper.getParams(hostname, chatId, force);
          params = {...params, ...botParams};
          params.browserWs = browserWs;
          params.db = botHelper.db !== false;
          // logger(params);
          await timeout(0.2);
          const ivTask = ivMaker.makeIvLink(link, params);
          const ivTimer = new Promise(resolve => {
            skipTimer = setInterval(() => {
              if (global.skipCount) {
                clearInterval(skipTimer);
                resolve('timedOut');
              }
            }, 1000);
            setTimeout(resolve, IV_MAKING_TIMEOUT * 1000, 'timedOut');
          });
          await Promise.race([ivTimer, ivTask]).then(value => {
            if (value === 'timedOut') {
              if (groupBugs) {
                botHelper.sendAdmin(`timedOut ${link}`, groupBugs);
              }
              timeOutLink = true;
            } else {
              linkData = value;
            }
          });
          clearInterval(skipTimer);
        }
        if (isFile) {
          RESULT = messages.isLooksLikeFile(link);
        } else if (timeOutLink) {
          TITLE = '';
          RESULT = messages.timeOut();
        } else if (linkData.error) {
          RESULT = messages.brokenFile(linkData.error);
        } else {
          const {iv, isLong, pages = '', ti: title = ''} = linkData;
          ivLink = iv;
          const longStr = isLong ? `Long ${pages}` : '';
          TITLE = `${title}\n`;
          RESULT = messages.showIvMessage(longStr, iv, `${link}`);
        }
      } catch (e) {
        logger(e);
        clearInterval(skipTimer);
        isBroken = true;
        if (timeOutLink) {
          TITLE = '';
          RESULT = messages.timeOut();
        } else {
          RESULT = messages.broken(link);
        }
        error = `broken ${link} ${e}`;
      }
      const t = rabbitmq.time(q);
      const extra = {parse_mode: 'Markdown'};
      const messageText = `${TITLE}${RESULT}`;
      if (inline) {
        let title = '';
        if (error || !ivLink) {
          title = 'Sorry IV not found';
          ivLink = title;
        }
        await botHelper
          .sendInline({
            title,
            messageId,
            ivLink,
          })
          .then(() => db.removeInline(link))
          .catch(() => {
            db.removeInline(link);
          });
      } else {
        if (isChanMesId) {
          let toDelete = messageId;
          if (!error) {
            await botHelper.sendIV(chatId, messageId, null, messageText, extra);
            toDelete = isChanMesId;
          }
          await botHelper.delMessage(chatId, toDelete);
        } else {
          await botHelper.sendIV(chatId, messageId, null, messageText, extra);
        }

        global.lastIvTime = +new Date();
      }

      if (!error) {
        let mark = inline ? 'i' : '';
        if (isChanMesId) mark += 'c';
        const text = `${mark ? `${mark} ` : ''}${RESULT}${
          q ? ` from ${q}` : ''
        }\n${t}`;
        if (group) {
          botHelper.sendAdminMark(text, group).catch(() => {});
        }
      }
    } catch (e) {
      logger(e);
      error = `${link} error: ${JSON.stringify(
        e,
      )} ${e.toString()} ${chatId} ${messageId}`;
    }
    logger(error);
    if (error) {
      if (isBroken && resolveMsgId) {
        botHelper
          .sendAdminOpts(error, keyboards.resolvedBtn(resolveMsgId, chatId))
          .catch(() => {});
      } else {
        if (groupBugs) {
          botHelper.sendAdmin(error, groupBugs).catch(() => {});
        }
      }
    }
  };

  try {
    setTimeout(() => {
      rabbitmq.run(jobMessage);
      rabbitmq.runSecond(jobMessage);
      rabbitmq.runPuppet(jobMessage);
    }, 5000);
  } catch (e) {
    botHelper.sendError(e);
  }
};

module.exports = format;
