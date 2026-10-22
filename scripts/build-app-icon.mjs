import {app,nativeImage} from 'electron';
import {writeFile} from 'node:fs/promises';import path from 'node:path';
void app.whenReady().then(async()=>{
const source=nativeImage.createFromPath(path.resolve('assets/spinepet-icon.png'));
if(source.isEmpty())throw Error('Missing SpinePet icon');
const sizes=[16,24,32,48,64,128,256],images=sizes.map(size=>source.resize({width:size,height:size,quality:'best'}).toPNG());
const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
let offset=header.length;
images.forEach((bytes,i)=>{const at=6+i*16;header[at]=sizes[i]===256?0:sizes[i];header[at+1]=header[at];header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(bytes.length,at+8);header.writeUInt32LE(offset,at+12);offset+=bytes.length;});
await writeFile('assets/spinepet-icon.ico',Buffer.concat([header,...images]));console.log('SpinePet alpha PNG / multi-size ICO generated');app.exit();

});
