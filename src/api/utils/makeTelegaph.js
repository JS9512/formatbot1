const fetch = require('isomorphic-fetch');

const makeTelegraph = async (article, content) => {
  const body = {
    access_token: process.env.TGPHTOKEN,
    title: article,
    author_name: 'FormatBot',
    author_url: 'https://t.me/CorsaBot',
    content,
    return_content: false,
  };
  return fetch('https://api.telegra.ph/createPage', {
    body: JSON.stringify(body),
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
    .then(res => {
      if (!res.ok) {
        const err = new Error(res.statusText || 'Error calling telegra.ph');
        err.statusCode = res.status;
        throw err;
      }
      return res.json()
        .then((json) => {
          if (('ok' in json && !json.ok)) {
            throw new Error(json.error || 'Error calling telegra.ph');
          }
          return json.result.url;
        });
    });
};
module.exports = makeTelegraph;