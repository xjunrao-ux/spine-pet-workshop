import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const siteDirectory = path.join(root, '.local', 'website');
const repository = 'https://github.com/xjunrao-ux/spine-pet-workshop';
const siteUrl = 'https://xjunrao-ux.github.io/spine-pet-workshop/';
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const catalog = JSON.parse(await readFile(path.join(root, 'community/catalog.json'), 'utf8'));
const details = {
  'local.spine-weather': { icon: 'weather', setup: '安装后，在扩展设置中选择城市，即可查看当前天气、24 小时和 7 天预报。需要联网。' },
  'io.spine-workshop.deepseek': { icon: 'chat', setup: '在扩展设置中填写自己的 DeepSeek API Key，再配置人设与记忆。对话会发送给服务商，费用由你的账户承担。' },
  'io.spine-workshop.codex': { icon: 'code', setup: '需要本机已安装并使用 Codex。插件只读可用的本机额度和任务状态，不代替你执行任务。' },
  'io.spine-workshop.dsh-pet': { icon: 'terminal', setup: '需要已有兼容的 DSH 本机桥服务。按插件说明填写服务地址与连接凭据，授权后使用。' },
  'com.example.hello-counter': { icon: 'plus', setup: '无需配置。打开计数器即可加一或清零。这个学习示例不保存数据，重启后归零。' },
};
const preferredOrder = Object.keys(details);
const plugins = catalog.plugins.map(plugin => {
  for (const key of ['sourceUrl', 'downloadUrl']) {
    const url = new URL(plugin[key]);
    if (url.protocol !== 'https:') throw new Error(`Plugin ${plugin.id}: ${key} must use HTTPS`);
  }
  const descriptions = {
    'local.spine-weather': '出门前查看天气，安排接下来的一天。支持当前天气、24 小时和 7 天预报。',
    'io.spine-workshop.deepseek': '在桌面与角色对话，通过气泡查看回复。可配置人设与记忆，需要自己的 API Key。',
    'io.spine-workshop.codex': '不用切回工具窗口，也能查看本机 Codex 额度、重置时间和可读取的任务状态。',
    'io.spine-workshop.dsh-pet': '从桌宠查看已有 DSH 会话、接收任务摘要并继续对话。需要先配置本机桥服务。',
    'com.example.hello-counter': '想自己做插件？从加一和清零开始，了解插件如何安装与运行。不联网、不保存数据。',
  };
  return { ...plugin, description: descriptions[plugin.id] || plugin.description, ...(details[plugin.id] || { icon: 'puzzle', setup: '请阅读作者提供的源码与说明，按插件要求完成设置。' }) };
}).sort((a, b) => {
  const rank = id => preferredOrder.includes(id) ? preferredOrder.indexOf(id) : preferredOrder.length;
  return rank(a.id) - rank(b.id) || a.name.localeCompare(b.name, 'zh-CN');
});
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const categories = [...new Set(plugins.map(plugin => plugin.category))];
const cards = plugins.map(plugin => `<article class="plugin-card" data-plugin="${escapeHtml(plugin.id)}" data-icon="${plugin.icon}">
  <div class="plugin-top"><span class="plugin-icon"><svg aria-hidden="true"><use href="#i-${plugin.icon}"/></svg></span><span class="plugin-category">${escapeHtml(plugin.category)}</span></div>
  <h3>${escapeHtml(plugin.name)}<span class="plugin-version">v${escapeHtml(plugin.version)}</span></h3>
  <p class="plugin-description">${escapeHtml(plugin.description)}</p>
  <p class="plugin-author">by ${escapeHtml(plugin.author)} · 桌宠 ≥ ${escapeHtml(plugin.minHostVersion)}</p>
  <div class="plugin-bottom"><a href="${escapeHtml(plugin.downloadUrl)}" aria-label="下载${escapeHtml(plugin.name)} v${escapeHtml(plugin.version)} ZIP"><svg aria-hidden="true"><use href="#i-download"/></svg>下载 ZIP</a><button class="detail-button" type="button" data-details="${escapeHtml(plugin.id)}" aria-label="查看${escapeHtml(plugin.name)}的使用条件与权限" hidden>使用条件与权限 ↗</button><noscript><a href="${escapeHtml(plugin.sourceUrl)}">查看说明 ↗</a></noscript></div>
</article>`).join('\n') + `<article class="plugin-card plugin-contribute" id="contribute-card"><span aria-hidden="true">[ + ]</span><h3>分享你的插件</h3><p>已经做好了一个工具？<br>上传 ZIP 并申请收录，让更多用户找到它。</p><a class="text-link" href="#contribute">上传与投稿 ↗</a></article>`;

let html = await readFile(path.join(root, 'website/index.html'), 'utf8');
const replacements = {
  '__SITE_URL__': siteUrl,
  '__REPO__': repository,
  '__VERSION__': version,
  '__SETUP__': `${repository}/releases/download/v${version}/SpinePet-Setup-v${version}-x64.exe`,
  '__PORTABLE__': `${repository}/releases/download/v${version}/SpinePet-Portable-v${version}-x64.exe`,
  '__CATEGORY_BUTTONS__': categories.map(category => `<button class="filter" type="button" data-category="${escapeHtml(category)}" aria-pressed="false">${escapeHtml(category)}</button>`).join(''),
  '__PLUGIN_COUNT__': String(plugins.length),
  '__PLUGIN_CARDS__': cards,
  '__SITE_DATA__': JSON.stringify({ repository, version, plugins }).replace(/</g, '\\u003c'),
};
for (const [token, replacement] of Object.entries(replacements)) html = html.replaceAll(token, () => replacement);
if (/__[A-Z_]+__/.test(html)) throw new Error('Unresolved website template token');
await mkdir(path.join(siteDirectory, 'assets'), { recursive: true });
await writeFile(path.join(siteDirectory, 'index.html'), html);
await writeFile(path.join(siteDirectory, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${siteUrl}</loc></url></urlset>\n`);
for (const name of ['styles.css', 'app.js']) await cp(path.join(root, 'website', name), path.join(siteDirectory, name));
await cp(path.join(root, 'website/fonts'), path.join(siteDirectory, 'assets/fonts'), {recursive: true});
await cp(path.join(root, 'website/images'), path.join(siteDirectory, 'assets/images'), {recursive: true});
for (const [source, destination] of [
  ['docs/images/website-current/library.png', 'library.png'],
  ['docs/images/website-current/materials.png', 'materials.png'],
  ['docs/images/website-current/models.png', 'models.png'],
  ['docs/images/website-current/plugins.png', 'plugins.png'],
  ['docs/images/website-current/pet.png', 'pet.png'],
  ['assets/spinepet-icon.png', 'spinepet-icon.png'],
]) await cp(path.join(root, source), path.join(siteDirectory, 'assets', destination));
await cp(path.join(root, 'community/catalog.json'), path.join(siteDirectory, 'catalog.json'));
await writeFile(path.join(siteDirectory, '.nojekyll'), '');
console.log(`Website built: ${siteDirectory} (v${version}, ${plugins.length} plugins)`);
