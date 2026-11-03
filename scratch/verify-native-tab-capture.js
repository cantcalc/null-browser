// Owned, temporary fixture. Does not request desktop/screen capture or read
// any user's tabs. Probe the real tab-source API before claiming compatibility.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'null-tab-audio-'));
app.setPath('userData',profile);
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  const server=http.createServer((_q,r)=>r.end('<!doctype html><body>Owned audio capture fixture</body>'));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const ses=session.fromPartition('capture-fixture');
  ses.setPermissionRequestHandler((_w,p,cb)=>cb(p==='display-capture'));
  ses.setPermissionCheckHandler((_w,p)=>p==='display-capture');
  const source=new BrowserWindow({show:false,webPreferences:{session:ses,sandbox:true}});
  const consumer=new BrowserWindow({show:false,webPreferences:{session:ses,sandbox:true}});
  const result={profile,ok:false};
  try{
    const url=`http://127.0.0.1:${server.address().port}`;
    await Promise.all([source.loadURL(url),consumer.loadURL(url)]);
    await source.webContents.executeJavaScript(`(()=>{window.audio=new AudioContext();const o=audio.createOscillator(),g=audio.createGain();o.frequency.value=440;g.gain.value=0.001;o.connect(g).connect(audio.destination);o.start();return audio.resume().then(()=>true)})()`,true);
    const id=source.webContents.getMediaSourceId(consumer.webContents);
    result.capture=await Promise.race([
      consumer.webContents.executeJavaScript(`(async()=>{const stream=await navigator.mediaDevices.getUserMedia({audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:${JSON.stringify(id)}}}});const ac=new AudioContext();await ac.resume();const analyser=ac.createAnalyser();ac.createMediaStreamSource(stream).connect(analyser);await new Promise(r=>setTimeout(r,500));const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,n)=>sum+n*n,0)/samples.length);const tracks=stream.getAudioTracks().map(t=>({state:t.readyState,muted:t.muted}));stream.getTracks().forEach(t=>t.stop());await ac.close();return {tracks,rms}})()`,true),
      delay(8000).then(()=>{throw Error('tab audio capture timeout')})
    ]);
    result.ok=result.capture.tracks.length===1&&result.capture.rms>0.00001;
  }catch(e){result.error=String(e)}
  finally{source.destroy();consumer.destroy();server.close();fs.writeFileSync(path.join(profile,'result.json'),JSON.stringify(result,null,2));console.log('NULL_NATIVE_TAB_CAPTURE='+JSON.stringify(result));app.quit();}
});
