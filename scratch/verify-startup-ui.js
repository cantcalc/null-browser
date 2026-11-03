const fs = require('node:fs');
const path = require('node:path');
module.exports = async function ({ main, page, profile, origin, mainWindow: win, waitFor, delay, requests, results, assert }) {
  const eager = process.env.NULL_EXPECT_EAGER === 'true';
  await waitFor(() => main.evaluate(`${win}.contentView.children.some(v=>v.getVisible()&&v.webContents.getURL()==='${origin}/startup-0'&&!v.webContents.isLoading())`), 'active restored document');
  await delay(1200);
  const startupRequests = [...new Set(requests.filter(url => /^\/startup-\d+$/.test(url)))];
  const snapshot = await main.evaluate(`(()=>{const e=process.mainModule.require('electron'),m=e.app.getAppMetrics();return {name:e.app.name,profile:e.app.getPath('userData'),renderers:m.filter(x=>x.type==='Tab').length,workingSetKiB:m.reduce((n,x)=>n+x.memory.workingSetSize,0),visible:${win}.contentView.children.filter(v=>v.getVisible()).length}})()`);
  assert(fs.realpathSync(snapshot.profile) === fs.realpathSync(profile), 'explicit profile was ignored during rename: ' + JSON.stringify(snapshot));
  assert(startupRequests.length === (eager ? 20 : 1), 'unexpected restored-page requests: ' + startupRequests.length);
  assert(snapshot.visible === 1, 'wrong number of visible views');
  if (!eager) {
    assert(snapshot.name === 'NULL', 'runtime product name not renamed');
    assert(await page.evaluate('document.title==="NULL"'), 'window title not renamed');
    assert(await page.evaluate('document.querySelectorAll("[data-tab-id]").length===20'), 'background tab metadata missing');
    assert(await page.evaluate('document.querySelector("[data-tab-id=startup-19]").textContent.includes("Restored 19")'), 'saved background title lost');
  }
  const primary = `${win}.contentView.children.find(v=>v.webContents.getURL()==='${origin}/startup-0').webContents`;
  await main.evaluate(`${primary}.executeJavaScript('window.unsavedDraft="kept"')`);
  await page.evaluate('document.querySelector("[data-tab-id=startup-19]").click();true');
  await waitFor(() => main.evaluate(`${win}.contentView.children.some(v=>v.getVisible()&&v.webContents.getURL()==='${origin}/startup-19'&&!v.webContents.isLoading())`), 'first background selection');
  await page.evaluate('document.querySelector("[data-tab-id=startup-0]").click();true');
  assert(await main.evaluate(`${primary}.executeJavaScript('window.unsavedDraft==="kept"')`), 'loaded document state was discarded');
  const after = [...new Set(requests.filter(url => /^\/startup-\d+$/.test(url)))];
  assert(after.length === (eager ? 20 : 2), 'switch loaded unrelated background tabs');
  Object.assign(results, { startupRequests: startupRequests.length, requestedAfterSelection: after.length, snapshot, savedTitlePreserved: !eager, liveDraftPreserved: true });
  if (!eager) {
    await page.evaluate(`document.querySelector('button[title="홈으로 이동"]').click();true`);
    await waitFor(() => page.evaluate('!!document.querySelector(".null-newtab-logo")&&!document.querySelector(".null-wordmark-title")'), 'logo-only new tab');
    if (process.env.NULL_LOGO_QA) {
      await waitFor(() => page.evaluate('(()=>{const img=document.querySelector(".null-newtab-logo");return img?.complete&&img.naturalWidth===1024&&img.naturalHeight===1024})()'), 'new ribbon PNG loaded');
      assert(await page.evaluate('(async()=>{const img=document.querySelector(".null-newtab-logo"),bytes=new Uint8Array(await (await fetch(img.currentSrc)).arrayBuffer());return img.dataset.nullLogo==="null-monochrome"&&img.alt==="NULL"&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)})()'), 'old logo still in built New Tab');
      results.ribbonVLogoLoaded = true;
    }
    const image = await page.send('Page.captureScreenshot', {format:'png'});
    fs.writeFileSync(path.join(profile, 'null-newtab.png'), Buffer.from(image.data, 'base64'));
    results.newTabBranding = true;
  }
  fs.writeFileSync(path.join(profile, 'startup-result.json'), JSON.stringify(results, null, 2));
};
