import {spawn} from 'node:child_process';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--port','3100','--hostname','127.0.0.1'],{env:{...process.env,NEXT_DIST_DIR:'.next-preview'},stdio:'inherit',windowsHide:true});
process.on('SIGINT',()=>server.kill('SIGINT'));
process.on('SIGTERM',()=>server.kill('SIGTERM'));
server.on('exit',code=>process.exit(code??0));
