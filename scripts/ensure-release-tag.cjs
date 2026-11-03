const {execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const tag='v'+require('../package.json').version,repo=process.env.GITHUB_REPOSITORY,sha=process.env.GITHUB_SHA;
assert(repo&&sha,'Release tag must be created inside the verified workflow');
const api=(...args)=>JSON.parse(execFileSync('gh',['api',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
let ref;
try{ref=api(`repos/${repo}/git/ref/tags/${tag}`);}catch(e){if(!String(e.stderr).includes('404'))throw e;}
if(ref){let target=ref.object;while(target.type==='tag')target=api(`repos/${repo}/git/tags/${target.sha}`).object;assert.equal(target.sha,sha,'Existing tag points to another commit');}
else api('-X','POST',`repos/${repo}/git/refs`,'-f',`ref=refs/tags/${tag}`,'-f',`sha=${sha}`);
console.log('Verified release tag '+tag+' at '+sha);
