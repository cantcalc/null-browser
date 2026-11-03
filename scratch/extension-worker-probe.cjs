// Only registered by the isolated extension QA process.
const { contextBridge } = require('electron');
console.log('NULL_WORKER_PRELOAD', process.type, process.contextIsolated);
contextBridge.executeInMainWorld({ func: () => {
  console.log('NULL_WORKER_MAIN_WORLD', JSON.stringify({chrome:typeof globalThis.chrome,browser:typeof globalThis.browser,sameBrowser:globalThis.browser===globalThis.chrome,browserCommands:typeof globalThis.browser?.commands,runtimeId:globalThis.chrome?.runtime?.id,commands:typeof globalThis.chrome?.commands,action:typeof globalThis.chrome?.action,tabsQuery:String(globalThis.chrome?.tabs?.query).slice(0,100)}));
  const api=globalThis.chrome;
  const log=value=>console.log('NULL_MSG_TRACE '+JSON.stringify(value));
  if(api?.runtime?.onMessage)api.runtime.onMessage.addListener(message=>{log({received:message.action,target:message.target})});
  const send=api?.runtime?.sendMessage?.bind(api.runtime);
  if(send)api.runtime.sendMessage=(...args)=>{
    log({send:args[0]?.action,target:args[0]?.target});const result=send(...args);
    result?.then?.(value=>log({response:args[0]?.action,value}),error=>log({error:String(error)}));return result;
  };
  const capture=api?.tabCapture?.getMediaStreamId;
  if(capture)api.tabCapture.getMediaStreamId=(...args)=>{log({capture:'start'});const result=capture(...args);result.then(()=>log({capture:'complete'}),e=>log({captureError:String(e)}));return result;};
}});
