import { inflateRawSync, deflateRawSync } from 'node:zlib';
const table=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++) c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
export function crc32(bytes){let crc=0xffffffff;for(const byte of bytes) crc=table[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
export function safeZipPath(name){
  if(typeof name!=='string'||!name||name.length>180||name.includes('\\')||/[\x00-\x1f:<>"|?*]/.test(name)||name.startsWith('/')||name.endsWith('.')) throw new Error('插件 ZIP 包含不安全路径');
  const parts=name.replace(/\/$/,'').split('/');
  if(parts.some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('插件 ZIP 包含不安全路径');
  return name;
}
export function readZip(buffer,{maxArchive=8*1024*1024,maxTotal=16*1024*1024,maxEntries=64}={}){
  if(!Buffer.isBuffer(buffer)||buffer.length<22||buffer.length>maxArchive) throw new Error('插件 ZIP 为空、无效或超过 8 MB');
  let end=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--) if(buffer.readUInt32LE(i)===0x06054b50&&i+22+buffer.readUInt16LE(i+20)===buffer.length){end=i;break;}
  if(end<0) throw new Error('找不到 ZIP 目录');
  const count=buffer.readUInt16LE(end+10),size=buffer.readUInt32LE(end+12),offset=buffer.readUInt32LE(end+16);
  if(buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6)||buffer.readUInt16LE(end+8)!==count||count===65535||count>maxEntries||offset+size!==end) throw new Error('不支持分卷、ZIP64 或超大插件包');
  const entries=new Map(),names=new Set(),ranges=[];let cursor=offset,total=0;
  for(let i=0;i<count;i++){
    if(cursor+46>end||buffer.readUInt32LE(cursor)!==0x02014b50) throw new Error('ZIP 目录损坏');
    const flags=buffer.readUInt16LE(cursor+8),method=buffer.readUInt16LE(cursor+10),crc=buffer.readUInt32LE(cursor+16),compressed=buffer.readUInt32LE(cursor+20),length=buffer.readUInt32LE(cursor+24);
    const nameLength=buffer.readUInt16LE(cursor+28),extra=buffer.readUInt16LE(cursor+30),comment=buffer.readUInt16LE(cursor+32),attributes=buffer.readUInt32LE(cursor+38),local=buffer.readUInt32LE(cursor+42);
    if(cursor+46+nameLength+extra+comment>end||flags&1||![0,8].includes(method)||compressed===0xffffffff||length===0xffffffff||((attributes>>>16)&0xf000)===0xa000||attributes&0x400||buffer.readUInt16LE(cursor+34)) throw new Error('不支持加密、链接或损坏的 ZIP 条目');
    const name=safeZipPath(buffer.subarray(cursor+46,cursor+46+nameLength).toString('utf8')),lower=name.toLowerCase();
    if(names.has(lower)) throw new Error('ZIP 包含重名文件');names.add(lower);
    if(local+30>offset||buffer.readUInt32LE(local)!==0x04034b50) throw new Error('ZIP 文件头损坏');
    const localName=buffer.readUInt16LE(local+26),localExtra=buffer.readUInt16LE(local+28),start=local+30+localName+localExtra,finish=start+compressed;
    if(start>offset||finish>offset||buffer.subarray(local+30,local+30+localName).toString('utf8')!==name||buffer.readUInt16LE(local+8)!==method||buffer.readUInt16LE(local+6)!==flags) throw new Error('ZIP 文件头与目录不一致');
    if(ranges.some(([a,b])=>local<b&&finish>a)) throw new Error('ZIP 条目范围重叠');ranges.push([local,finish]);
    total+=length;if(total>maxTotal||length>4*1024*1024||(compressed&&length/compressed>200)) throw new Error('插件解压大小或压缩比例超限');
    const raw=buffer.subarray(start,finish);let content;
    try{content=method===0?Buffer.from(raw):inflateRawSync(raw,{maxOutputLength:Math.max(1,length)});}catch{throw new Error('插件 ZIP 解压失败');}
    if(content.length!==length||crc32(content)!==crc) throw new Error('插件 ZIP 校验失败');
    if(name.endsWith('/')){if(length) throw new Error('ZIP 目录包含数据');}else entries.set(name,content);
    cursor+=46+nameLength+extra+comment;
  }
  if(cursor!==end) throw new Error('ZIP 目录长度不一致');return entries;
}
export function createZip(files){
  const local=[],central=[];let offset=0;
  for(const [name,value] of Object.entries(files)){
    safeZipPath(name);const bytes=Buffer.isBuffer(value)?value:Buffer.from(value),filename=Buffer.from(name),compressed=deflateRawSync(bytes),crc=crc32(bytes);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(filename.length,26);
    const dosDate=((2026-1980)<<9)|(10<<5)|12;header.writeUInt16LE(dosDate,12);
    local.push(header,filename,compressed);const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt16LE(8,10);directory.writeUInt16LE(dosDate,14);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(compressed.length,20);directory.writeUInt32LE(bytes.length,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt32LE(offset,42);central.push(directory,filename);offset+=header.length+filename.length+compressed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}
