const data = JSON.parse(document.getElementById('site-data').textContent);
const repo = data.repository;
document.querySelectorAll('[data-details]').forEach(button => { button.hidden = false; });

const guides = {
  start: {
    title: '下载、打开，和它打个招呼。',
    steps: ['下载 Windows 安装版或免安装版，启动 SpinePet。', '首次启动自带阿米娅。左键拖动位置，短按互动，右键选择动作。', '右键桌宠打开「角色管理器」，在角色库选择你想使用的角色。'],
    tip: '关闭管理器后，桌宠会继续陪伴。要退出，请右键桌宠或系统托盘图标。',
    image: 'library.png', alt: '角色库与独立参数设置栏',
  },
  character: {
    title: '找到喜欢的角色，预览后再导入。',
    steps: ['打开「导入角色 → 搜索角色模型与语音」，输入角色名或模型编号。', '下载模型，按需选择语种、下载语音，确认角色 ID 后预览和试听。', '点击「导入并设为当前桌宠」。也可以选择本地模型文件夹导入。'],
    tip: '本地素材需兼容 Spine 3.8，骨骼、图集和贴图放在同一完整文件夹中；素材入口和教程就在导入页顶部。',
    image: 'materials.png', alt: '导入角色页：素材教程、模型与语音检索入口',
  },
  plugin: {
    title: '挑一个小工具，把 ZIP 交给桌宠。',
    steps: ['在下方插件社区找到需要的插件，先查看使用条件和权限，再下载 ZIP。', '进入「角色管理器 → 扩展 → 导入插件 ZIP」，核对信息后安装，不用解压。', '在扩展页填写城市、连接或 API 配置，然后悬停桌宠打开对应功能。'],
    tip: '插件有自己的版本。在「更新与开发」中检查已收录插件的更新，或重新导入同 ID 的新 ZIP，保留配置和数据。',
    image: 'plugins.png', alt: '扩展管理页：ZIP 导入、插件启用与设置',
  },
};

function setupTabs(selector, activate) {
  const tabs = [...document.querySelectorAll(selector)];
  function select(tab, moveFocus = false) {
    for (const candidate of tabs) {
      candidate.setAttribute('aria-selected', String(candidate === tab));
      candidate.tabIndex = candidate === tab ? 0 : -1;
    }
    activate(tab);
    if (moveFocus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      const vertical = getComputedStyle(tab.parentElement).flexDirection === 'column';
      const previous = vertical ? 'ArrowUp' : 'ArrowLeft';
      const next = vertical ? 'ArrowDown' : 'ArrowRight';
      let target;
      if (event.key === previous) target = (index - 1 + tabs.length) % tabs.length;
      if (event.key === next) target = (index + 1) % tabs.length;
      if (event.key === 'Home') target = 0;
      if (event.key === 'End') target = tabs.length - 1;
      if (target !== undefined) { event.preventDefault(); select(tabs[target], true); }
    });
  });
}

setupTabs('[data-guide]', tab => {
  const guide = guides[tab.dataset.guide];
  document.getElementById('guide-subtitle').textContent = guide.title;
  document.getElementById('guide-steps').replaceChildren(...guide.steps.map(text => {
    const item = document.createElement('li'); item.textContent = text; return item;
  }));
  document.getElementById('guide-tip').textContent = guide.tip;
  const image = document.getElementById('guide-image');
  image.src = `assets/${guide.image}`;
  image.alt = guide.alt;
  document.getElementById('guide-image-link').href = image.src;
  document.getElementById('guide-panel').setAttribute('aria-labelledby', tab.id);
});

let selectedCategory = '全部';
const search = document.getElementById('plugin-search');
const cards = [...document.querySelectorAll('[data-plugin]')];
const filters = [...document.querySelectorAll('[data-category]')];
function filterPlugins() {
  const query = search.value.trim().toLocaleLowerCase();
  let count = 0;
  for (const card of cards) {
    const plugin = data.plugins.find(item => item.id === card.dataset.plugin);
    const haystack = [plugin.name, plugin.description, plugin.author, plugin.category, plugin.id].join(' ').toLocaleLowerCase();
    const visible = (selectedCategory === '全部' || selectedCategory === plugin.category) && haystack.includes(query);
    card.hidden = !visible;
    if (visible) count++;
  }
  document.getElementById('plugin-count').textContent = query || selectedCategory !== '全部' ? `找到 ${count} 个插件` : `${count} 个已收录插件`;
  document.getElementById('empty-state').hidden = count > 0;
  document.getElementById('contribute-card').hidden = query !== '' || selectedCategory !== '全部';
}
filters.forEach(button => button.addEventListener('click', () => {
  selectedCategory = button.dataset.category;
  filters.forEach(item => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  filterPlugins();
}));
search.addEventListener('input', filterPlugins);
document.getElementById('clear-search').addEventListener('click', () => {
  search.value = '';
  filters[0].click();
  search.focus();
});

const permissionLabels = {
  'storage.own': '保存这个插件自己的设置和数据',
  'ui.reminders': '通过桌宠显示气泡与提醒',
  'weather.read': '查询城市和天气预报',
  'codex.read': '只读本机 Codex 额度与任务状态',
  'ai.deepseek': '调用你配置的 DeepSeek 对话服务',
  'net.local': '访问你明确授权的本机服务',
};
const dialog = document.getElementById('plugin-dialog');
let dialogTrigger;
document.querySelectorAll('[data-details]').forEach(button => button.addEventListener('click', () => {
  const plugin = data.plugins.find(item => item.id === button.dataset.details);
  if (!plugin) return;
  dialogTrigger = button;
  document.getElementById('dialog-title').textContent = plugin.name;
  document.getElementById('dialog-description').textContent = plugin.description;
  const fields = [['作者', plugin.author], ['插件版本', `v${plugin.version}`], ['最低桌宠版本', `v${plugin.minHostVersion}`], ['插件 ID', plugin.id]];
  document.getElementById('dialog-meta').replaceChildren(...fields.flatMap(([label, value]) => {
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = value;
    return [dt, dd];
  }));
  document.getElementById('dialog-setup').textContent = plugin.setup;
  const permissions = plugin.permissions.length ? plugin.permissions.map(permission => `${permissionLabels[permission] || permission}（${permission}）`) : ['无需额外权限，不联网、不保存数据。'];
  document.getElementById('dialog-permissions').replaceChildren(...permissions.map(text => {
    const li = document.createElement('li'); li.textContent = text; return li;
  }));
  document.getElementById('dialog-checksum').value = plugin.sha256;
  document.getElementById('dialog-download').href = plugin.downloadUrl;
  document.getElementById('dialog-source').href = plugin.sourceUrl;
  dialog.showModal();
}));
document.getElementById('close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  const box = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close();
});
dialog.addEventListener('close', () => dialogTrigger?.focus());

const commands = {
  plugin: {
    note: '先克隆项目，再从零权限计数器示例开始。',
    code: `git clone ${repo}.git\ncd spine-pet-workshop\n\n# 修改 examples/hello-counter-plugin 中的示例\n# 打包后，在「扩展」中导入生成的 ZIP\nnode scripts/package-plugin.mjs examples/hello-counter-plugin release/plugins/Hello-Counter-v1.0.0.zip`,
    requirement: '需要 Node.js 24 · 示例打包无需安装 Electron',
  },
  app: {
    note: '准备本地角色素材后，在 Windows 上运行。素材放置方法见源码开发文档。',
    code: `git clone ${repo}.git\ncd spine-pet-workshop\n\npnpm install --frozen-lockfile\npnpm dev\n\n# 构建与启动\npnpm build\npnpm start`,
    requirement: 'Windows x64 · Node.js 24 · pnpm 11',
  },
};
setupTabs('[data-terminal]', tab => {
  const command = commands[tab.dataset.terminal];
  document.getElementById('terminal-note').textContent = command.note;
  document.getElementById('terminal-code').textContent = command.code;
  document.getElementById('terminal-requirement').textContent = command.requirement;
  document.getElementById('terminal-panel').setAttribute('aria-labelledby', tab.id);
  document.getElementById('copy-feedback').textContent = '';
});
document.getElementById('copy-command').addEventListener('click', async () => {
  const code = document.getElementById('terminal-code');
  const feedback = document.getElementById('copy-feedback');
  try {
    await navigator.clipboard.writeText(code.textContent);
    feedback.textContent = '已复制，可以粘贴到 PowerShell。';
  } catch {
    const selection = window.getSelection();
    const range = document.createRange(); range.selectNodeContents(code);
    selection.removeAllRanges(); selection.addRange(range);
    feedback.textContent = '浏览器未允许自动复制，已选中命令，请按 Ctrl+C 复制。';
  }
});
