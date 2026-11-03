const fs=require('node:fs'),path=require('node:path');
exports.default=async context=>{
  const root=context.packager.projectDir;
  const resources=context.electronPlatformName==='darwin'?path.join(context.appOutDir,'NULL.app/Contents/Resources'):path.join(context.appOutDir,'resources');
  const target=path.join(resources,'licenses');fs.mkdirSync(target,{recursive:true});
  for(const [destination,names]of [['LICENSE.electron.txt',['LICENSE.electron.txt','LICENSE']],['LICENSES.chromium.html',['LICENSES.chromium.html']]]){
    // Windows builder may obtain Electron from its own archive cache rather
    // than node_modules/electron/dist. Prefer that exact packaged runtime.
    const candidates=names.flatMap(name=>[path.join(context.appOutDir,name),path.join(root,'node_modules/electron/dist',name)]);
    const source=candidates.find(name=>fs.existsSync(name)&&fs.statSync(name).isFile());
    if(!source)throw Error('Missing actual Electron runtime license: '+destination);
    fs.copyFileSync(source,path.join(target,destination));
  }
};
