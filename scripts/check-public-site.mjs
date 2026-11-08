// Anonymous HTTP request: deliberately sends no cookie or authorization header.
const response = await fetch('https://research-receipt-lab.milkyhoop.chatgpt.site/', { redirect: 'manual', signal: AbortSignal.timeout(30000) });
const html = await response.text();
const evidence = { checkedAt: new Date().toISOString(), status: response.status, redirect: response.headers.get('location'), title: html.match(/<title>(.*?)<\/title>/s)?.[1], appRoot: /id=["']root["']/.test(html), credentialsSent: false };
console.log(JSON.stringify(evidence));
if (response.status !== 200 || !evidence.appRoot || evidence.redirect) process.exitCode = 1;
