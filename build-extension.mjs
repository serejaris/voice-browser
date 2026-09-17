import {mkdir,copyFile} from 'node:fs/promises';
const files=['manifest.json','background.js','controller.html','app.js','core.js','style.css','sandbox.html','sandbox.js','README.md'];
const root=new URL('.',import.meta.url),destination=new URL('extension/',root);
await mkdir(destination,{recursive:true});
for(const file of files)await copyFile(new URL(file,root),new URL(file,destination));
console.log('Unpacked Chrome extension: '+destination.pathname);
